import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import { FakeObs } from "./fake_obs.ts";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const BUNDLE = fileURLToPath(new URL("./dist/brb.js", import.meta.url));
/** An empty home, so a developer's real ~/.config/brb/brb.json can't leak into the tests. */
const EMPTY_HOME = Deno.makeTempDirSync();

interface Runtime {
  name: string;
  command: string;
  args: string[];
}

/** The same tests run against the TypeScript source on Deno and the shipped bundle on Node. */
const RUNTIMES: Runtime[] = [
  { name: "deno", command: Deno.execPath(), args: ["run", "-A", MAIN] },
  { name: "node", command: "node", args: [BUNDLE] },
];

if (!new Deno.Command("node", { args: ["--version"], stdout: "null" }).outputSync().success) {
  throw new Error("Node is required: the tests run the shipped dist/brb.js on it.");
}

function defineTests(runtime: Runtime) {
  /** Runs the real CLI as a subprocess against the fake OBS. */
  async function brbIn(
    cwd: string | undefined,
    obs: FakeObs,
    ...args: string[]
  ): Promise<{ code: number; out: string; err: string }> {
    const command = new Deno.Command(runtime.command, {
      args: [...runtime.args, "--url", obs.url, "--password", "hunter2", ...args],
      cwd,
      env: { HOME: EMPTY_HOME }, // brb prefers HOME; overriding USERPROFILE breaks version-manager shims like Volta
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    return { code, out: decode(stdout), err: decode(stderr) };
  }

  const brb = (obs: FakeObs, ...args: string[]) => brbIn(undefined, obs, ...args);

  Deno.test(`${runtime.name}: showing a message starts the virtual camera by default; --no-cam opts out`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    assertEquals((await brb(obs, "setup")).code, 0);
    assertEquals(obs.state.virtualCam, false);

    const first = await brb(obs, "grabbing coffee");
    assertEquals(first.code, 0);
    assertStringIncludes(first.out, "started virtual camera");
    assertEquals(obs.state.virtualCam, true);
    assertEquals(obs.state.inputs["brb-status"].text, "grabbing coffee");

    // Already on: stays on and doesn't claim to have started it.
    const second = await brb(obs, "still here");
    assertEquals(second.out.includes("started virtual camera"), false);
    assertEquals(obs.state.virtualCam, true);

    await brb(obs, "cam", "off");
    assertEquals(obs.state.virtualCam, false);
    assertEquals((await brb(obs, "quietly", "--no-cam")).code, 0);
    assertEquals(obs.state.virtualCam, false);
    assertEquals(obs.state.items[0].enabled, true);

    // `off` hides the message and leaves the camera alone.
    await brb(obs, "cam", "on");
    assertEquals((await brb(obs, "off")).code, 0);
    assertEquals(obs.state.items[0].enabled, false);
    assertEquals(obs.state.virtualCam, true);

    // `--` forces a literal message even when it looks like a command.
    await brb(obs, "--", "off");
    assertEquals(obs.state.inputs["brb-status"].text, "off");
    assertEquals(obs.state.items[0].enabled, true);
  });

  Deno.test(`${runtime.name}: --in waits out the clock, then clears the message`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    await brb(obs, "setup");
    const result = await brb(obs, "back soon", "--in", "1s", "--no-cam");
    assertEquals(result.code, 0);
    assertStringIncludes(result.out, "Showing");
    assertStringIncludes(result.out, "cleared");
    assertEquals(obs.state.items[0].enabled, false);
  });

  Deno.test(`${runtime.name}: an expired --in timer leaves a newer message alone`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    await brb(obs, "setup");
    const timed = new Deno.Command(runtime.command, {
      args: [...runtime.args, "--url", obs.url, "--password", "hunter2", "old news", "--in", "2s", "--no-cam"],
      env: { HOME: EMPTY_HOME },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    // Wait until the timed message is on camera, then replace it before the timer fires.
    while (!obs.state.items[0]?.enabled) await new Promise((resolve) => setTimeout(resolve, 50));
    await brb(obs, "newer message", "--no-cam");
    const { code, stdout } = await timed.output();
    assertEquals(code, 0);
    assertStringIncludes(new TextDecoder().decode(stdout), "already changed");
    assertEquals(obs.state.items[0].enabled, true);
    assertEquals(obs.state.inputs["brb-status"].text, "newer message");
  });

  Deno.test(`${runtime.name}: --color / --bg / --bg-opacity restyle the source and stick`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    await brb(obs, "setup", "--color", "yellow", "--bg", "#000000", "--bg-opacity", "90");
    assertEquals(obs.state.inputs["brb-status"].color, 0xFF00FFFF);
    assertEquals(obs.state.inputs["brb-status"].bk_color, 0xFF000000);
    assertEquals(obs.state.inputs["brb-status"].bk_opacity, 90);

    const result = await brb(obs, "hello", "--color", "red", "--bg", "white", "--no-cam");
    assertEquals(result.code, 0);
    assertEquals(obs.state.inputs["brb-status"].color, 0xFF0000FF);
    assertEquals(obs.state.inputs["brb-status"].bk_color, 0xFFFFFFFF);
    assertEquals(obs.state.inputs["brb-status"].bk_opacity, 70);

    await brb(obs, "no box", "--bg", "none", "--no-cam");
    assertEquals(obs.state.inputs["brb-status"].bk_opacity, 0);
    assertEquals(obs.state.inputs["brb-status"].color, 0xFF0000FF); // untouched

    // Bad colors fail before anything changes.
    const bad = await brb(obs, "oops", "--color", "chartreuse-ish", "--no-cam");
    assertEquals(bad.code, 1);
    assertStringIncludes(bad.err, "Can't parse color");
    assertEquals(obs.state.inputs["brb-status"].text, "no box");
  });

  Deno.test(`${runtime.name}: brb.json in the working directory sets defaults; flags override it`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    const dir = Deno.makeTempDirSync();
    Deno.writeTextFileSync(
      `${dir}/brb.json`,
      JSON.stringify({
        message: "Back soon",
        color: "lime",
        bg: "#000000",
        bgOpacity: 55,
        cam: false,
        source: "status",
      }),
    );
    assertEquals((await brbIn(dir, obs, "setup")).code, 0);
    assertEquals(Object.keys(obs.state.inputs), ["status"]); // `source` came from the config

    // No words: the configured message. `cam: false`: the camera stays off.
    assertEquals((await brbIn(dir, obs)).code, 0);
    assertEquals(obs.state.inputs.status.text, "Back soon");
    assertEquals(obs.state.inputs.status.color, 0xFF00FF00);
    assertEquals(obs.state.inputs.status.bk_opacity, 55);
    assertEquals(obs.state.virtualCam, false);

    // Flags win over the file.
    await brbIn(dir, obs, "hi", "--color", "red", "--bg-opacity", "10");
    assertEquals(obs.state.inputs.status.text, "hi");
    assertEquals(obs.state.inputs.status.color, 0xFF0000FF);
    assertEquals(obs.state.inputs.status.bk_opacity, 10);
    assertEquals(obs.state.inputs.status.bk_color, 0xFF000000); // still from the file

    // --config points at another file explicitly, and a missing one is an error.
    Deno.writeTextFileSync(`${dir}/other.json`, JSON.stringify({ source: "status", message: "From other" }));
    await brbIn(dir, obs, "--config", `${dir}/other.json`);
    assertEquals(obs.state.inputs.status.text, "From other");
    const missing = await brbIn(dir, obs, "--config", `${dir}/nope.json`);
    assertEquals(missing.code, 1);
    assertStringIncludes(missing.err, "Can't read config");
  });

  Deno.test(`${runtime.name}: brb.json with a password is rejected before touching OBS`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    const dir = Deno.makeTempDirSync();
    Deno.writeTextFileSync(`${dir}/brb.json`, JSON.stringify({ password: "hunter2" }));
    const result = await brbIn(dir, obs, "setup");
    assertEquals(result.code, 1);
    assertStringIncludes(result.err, "OBS_WEBSOCKET_PASSWORD");
    assertEquals(Object.keys(obs.state.inputs), []);
  });
  Deno.test(`${runtime.name}: stop releases the webcam, and showing a message wakes it again`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    await brb(obs, "setup");
    obs.state.inputs["Webcam"] = {}; // a DirectShow webcam that has never been toggled
    obs.state.kinds["Webcam"] = "dshow_input";

    // Showing a message with a healthy camera must not rewrite the camera's settings (it could blink the light).
    await brb(obs, "hi");
    assertEquals(obs.state.virtualCam, true);
    assertEquals("active" in obs.state.inputs["Webcam"], false);

    const stopped = await brb(obs, "stop");
    assertEquals(stopped.code, 0);
    assertStringIncludes(stopped.out, "1 camera source released");
    assertEquals(obs.state.items[0].enabled, false);
    assertEquals(obs.state.virtualCam, false);
    assertEquals(obs.state.inputs["Webcam"].active, false);

    // Already stopped: nothing left to release.
    assertStringIncludes((await brb(obs, "stop")).out, "0 camera sources released");

    // --no-cam leaves the webcam released; a normal message reactivates it and says so.
    await brb(obs, "quiet", "--no-cam");
    assertEquals(obs.state.inputs["Webcam"].active, false);
    const woke = await brb(obs, "back");
    assertStringIncludes(woke.out, "reactivated camera");
    assertEquals(obs.state.inputs["Webcam"].active, true);
    assertEquals(obs.state.virtualCam, true);

    // `cam on` wakes it too.
    await brb(obs, "stop");
    await brb(obs, "cam", "on");
    assertEquals(obs.state.inputs["Webcam"].active, true);
    assertEquals(obs.state.virtualCam, true);
  });

  Deno.test(`${runtime.name}: --version prints the package version without needing OBS`, async () => {
    const { version } = JSON.parse(Deno.readTextFileSync(new URL("./package.json", import.meta.url)));
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    for (const flag of ["--version", "-v"]) {
      const result = await brb(obs, flag);
      assertEquals(result.code, 0);
      assertEquals(result.out.trim(), version);
    }
    assertEquals(Object.keys(obs.state.inputs), []);
  });

  Deno.test(`${runtime.name}: stop --quit-obs refuses before changing anything`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    await brb(obs, "setup");
    await brb(obs, "on air");
    assertEquals(obs.state.virtualCam, true);

    // Recording: refused, and the message and virtual camera are untouched.
    obs.state.recording = true;
    const busy = await brb(obs, "stop", "--quit-obs");
    assertEquals(busy.code, 1);
    assertStringIncludes(busy.err, "Not quitting OBS: OBS is recording");
    assertEquals(obs.state.virtualCam, true);
    assertEquals(obs.state.items[0].enabled, true);

    // Not recording, but whatever listens on the port is this test runner, not OBS: refused again.
    obs.state.recording = false;
    const impostor = await brb(obs, "stop", "--quit-obs");
    assertEquals(impostor.code, 1);
    assertStringIncludes(impostor.err, "Not quitting OBS:");
    assertEquals(obs.state.virtualCam, true);
    assertEquals(obs.state.items[0].enabled, true);

    // Without the flag, stop still works as before.
    assertEquals((await brb(obs, "stop")).code, 0);
    assertEquals(obs.state.virtualCam, false);
  });

  Deno.test(`${runtime.name}: --quit-obs only works with stop`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    const result = await brb(obs, "hello", "--quit-obs");
    assertEquals(result.code, 1);
    assertStringIncludes(result.err, "--quit-obs only works with the stop command");
    assertEquals(Object.keys(obs.state.inputs), []);
  });

  Deno.test(`${runtime.name}: stop works in a scene that was never set up`, async () => {
    await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
    const result = await brb(obs, "stop");
    assertEquals(result.code, 0);
    assertStringIncludes(result.out, "virtual camera off");
  });
}

for (const runtime of RUNTIMES) defineTests(runtime);
