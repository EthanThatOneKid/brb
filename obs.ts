/**
 * Minimal obs-websocket v5 client (https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).
 * Only what `brb` needs: connect, authenticate, send requests.
 */

export interface ConnectOptions {
  url: string;
  password?: string;
  /** Milliseconds to wait for the socket to open and identify. */
  timeoutMs?: number;
}

/** An OBS request that came back with `result: false`. */
export class ObsRequestError extends Error {
  constructor(readonly requestType: string, readonly code: number, comment: string) {
    super(`${requestType} failed (${code}): ${comment}`);
    this.name = "ObsRequestError";
  }
}

/** Error codes from the protocol that `brb` reacts to. */
export const ResourceNotFound = 600;

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function sha256Base64(text: string): Promise<string> {
  return toBase64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Builds the `authentication` string for the Identify message. */
export async function computeAuth(password: string, salt: string, challenge: string): Promise<string> {
  const secret = await sha256Base64(password + salt);
  return await sha256Base64(secret + challenge);
}

interface Pending {
  type: string;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

const OP = { Hello: 0, Identify: 1, Identified: 2, Request: 6, RequestResponse: 7 } as const;

export class ObsClient {
  #socket: WebSocket;
  #pending = new Map<string, Pending>();
  #nextId = 0;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  static connect(options: ConnectOptions): Promise<ObsClient> {
    const { url, password, timeoutMs = 5000 } = options;
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url, ["obswebsocket.json"]);
      } catch (error) {
        reject(new Error(`Invalid OBS WebSocket URL ${url}: ${(error as Error).message}`));
        return;
      }
      const client = new ObsClient(socket);
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch { /* already closed */ }
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error(`Timed out connecting to OBS at ${url}.`)), timeoutMs);

      socket.onerror = () => fail(new Error(`Could not connect to OBS at ${url}.`));
      socket.onclose = (event) => {
        const reason = event.code === 4009
          ? "Authentication failed (wrong OBS_WEBSOCKET_PASSWORD?)."
          : `Connection to OBS closed (${event.code}${event.reason ? `: ${event.reason}` : ""}).`;
        fail(new Error(reason));
        client.#rejectAll(new Error(reason));
      };
      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data as string) as { op: number; d: Record<string, unknown> };
        try {
          switch (message.op) {
            case OP.Hello: {
              const identify: Record<string, unknown> = { rpcVersion: 1 };
              const auth = message.d.authentication as { challenge: string; salt: string } | undefined;
              if (auth) {
                if (!password) {
                  fail(new Error("OBS requires a password. Set OBS_WEBSOCKET_PASSWORD or pass --password."));
                  return;
                }
                identify.authentication = await computeAuth(password, auth.salt, auth.challenge);
              }
              socket.send(JSON.stringify({ op: OP.Identify, d: identify }));
              break;
            }
            case OP.Identified:
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(client);
              }
              break;
            case OP.RequestResponse:
              client.#settle(message.d);
              break;
          }
        } catch (error) {
          fail(error as Error);
        }
      };
    });
  }

  #settle(d: Record<string, unknown>) {
    const pending = this.#pending.get(d.requestId as string);
    if (!pending) return;
    this.#pending.delete(d.requestId as string);
    const status = d.requestStatus as { result: boolean; code: number; comment?: string };
    if (status.result) pending.resolve(d.responseData ?? {});
    else pending.reject(new ObsRequestError(pending.type, status.code, status.comment ?? "no comment"));
  }

  #rejectAll(error: Error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  request<T = Record<string, unknown>>(type: string, data?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = String(this.#nextId++);
      this.#pending.set(requestId, { type, resolve: resolve as (data: unknown) => void, reject });
      this.#socket.send(JSON.stringify({ op: OP.Request, d: { requestType: type, requestId, requestData: data } }));
    });
  }

  close() {
    this.#socket.onclose = null;
    this.#socket.close();
  }
}
