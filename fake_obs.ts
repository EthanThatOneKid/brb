import { computeAuth } from "./obs.ts";

type Json = Record<string, unknown>;

interface Item {
  id: number;
  scene: string;
  source: string;
  enabled: boolean;
  transform?: Json;
}

/** Just enough of obs-websocket v5 to exercise `brb` without OBS. Test-only. */
export class FakeObs implements AsyncDisposable {
  readonly state = {
    inputs: {} as Record<string, Json>,
    items: [] as Item[],
    virtualCam: false,
    current: "",
  };
  #server: Deno.HttpServer;
  readonly url: string;

  private constructor(readonly options: { password?: string }, server: Deno.HttpServer, port: number) {
    this.#server = server;
    this.url = `ws://127.0.0.1:${port}`;
  }

  static start(options: { password?: string; scenes: string[]; current: string }): Promise<FakeObs> {
    // deno-lint-ignore prefer-const
    let fake: FakeObs;
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (req) => {
      const { socket, response } = Deno.upgradeWebSocket(req, { protocol: "obswebsocket.json" });
      socket.onopen = () => fake.#hello(socket);
      return response;
    });
    fake = new FakeObs(options, server, (server.addr as Deno.NetAddr).port);
    fake.state.current = options.current;
    return Promise.resolve(fake);
  }

  #hello(socket: WebSocket) {
    const challenge = "test-challenge", salt = "test-salt";
    const d: Json = { obsWebSocketVersion: "5.0.0", rpcVersion: 1 };
    if (this.options.password) d.authentication = { challenge, salt };
    socket.send(JSON.stringify({ op: 0, d }));
    socket.onmessage = async (event) => {
      const { op, d } = JSON.parse(event.data);
      if (op === 1) {
        if (this.options.password) {
          const expected = await computeAuth(this.options.password, salt, challenge);
          if (d.authentication !== expected) return socket.close(4009, "Authentication failed.");
        }
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      } else if (op === 6) {
        const { requestType, requestId, requestData = {} } = d;
        let result = true, code = 100, comment: string | undefined, responseData: Json | undefined;
        try {
          responseData = this.#handle(requestType, requestData);
        } catch (error) {
          result = false;
          code = (error as { code?: number }).code ?? 600;
          comment = (error as Error).message;
        }
        socket.send(JSON.stringify({
          op: 7,
          d: { requestType, requestId, requestStatus: { result, code, comment }, responseData },
        }));
      }
    };
  }

  #item(sceneName: string, id: number): Item {
    const item = this.state.items.find((i) => i.scene === sceneName && i.id === id);
    if (!item) throw new Error("No scene items were found.");
    return item;
  }

  #handle(type: string, data: Json): Json | undefined {
    const s = this.state;
    switch (type) {
      case "GetCurrentProgramScene":
        return { currentProgramSceneName: s.current };
      case "GetSceneItemId": {
        const item = s.items.find((i) => i.scene === data.sceneName && i.source === data.sourceName);
        if (!item) throw new Error("No scene items were found.");
        return { sceneItemId: item.id };
      }
      case "GetInputKindList":
        return { inputKinds: ["text_gdiplus_v3", "color_source_v3"] };
      case "GetInputSettings": {
        const input = s.inputs[data.inputName as string];
        if (!input) throw new Error("No input was found.");
        return { inputSettings: input, inputKind: "text_gdiplus_v3" };
      }
      case "SetInputSettings": {
        const input = s.inputs[data.inputName as string];
        if (!input) throw new Error("No input was found.");
        Object.assign(input, data.inputSettings);
        return;
      }
      case "CreateInput": {
        s.inputs[data.inputName as string] = { ...(data.inputSettings as Json) };
        const id = s.items.length + 1;
        s.items.push({
          id,
          scene: data.sceneName as string,
          source: data.inputName as string,
          enabled: !!data.sceneItemEnabled,
        });
        return { sceneItemId: id };
      }
      case "CreateSceneItem": {
        const id = s.items.length + 1;
        s.items.push({
          id,
          scene: data.sceneName as string,
          source: data.sourceName as string,
          enabled: !!data.sceneItemEnabled,
        });
        return { sceneItemId: id };
      }
      case "GetVideoSettings":
        return { baseWidth: 1920, baseHeight: 1080 };
      case "SetSceneItemTransform":
        this.#item(data.sceneName as string, data.sceneItemId as number).transform = data.sceneItemTransform as Json;
        return;
      case "SetSceneItemEnabled":
        this.#item(data.sceneName as string, data.sceneItemId as number).enabled = data.sceneItemEnabled as boolean;
        return;
      case "GetSceneItemEnabled":
        return { sceneItemEnabled: this.#item(data.sceneName as string, data.sceneItemId as number).enabled };
      case "GetVirtualCamStatus":
        return { outputActive: s.virtualCam };
      case "StartVirtualCam":
        s.virtualCam = true;
        return;
      case "StopVirtualCam":
        s.virtualCam = false;
        return;
      default:
        throw Object.assign(new Error(`Unknown request ${type}`), { code: 204 });
    }
  }

  async [Symbol.asyncDispose]() {
    await this.#server.shutdown();
  }
}
