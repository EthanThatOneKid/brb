import { assertEquals, assertStringIncludes } from "@std/assert";
import { FakeObs } from "./fake_obs.ts";

const MAIN = new URL("./main.ts", import.meta.url).href;
/** An empty home, so a developer's real ~/.config/brb/brb.json can't leak into the tests. */
const EMPTY_HOME = Deno.makeTempDirSync();

/** Runs the real CLI (main.ts) as a subprocess against the fake OBS. */
async function brbIn(
  cwd: string | undefined,
  obs: FakeObs,
  ...args: string[]
): Promise<{ code: number; out: string; err: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", MAIN, "--url", obs.url, "--password", "hunter2", ...args],
    cwd,
    env: { HOME: EMPTY_HOME, USERPROFILE: EMPTY_HOME },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code, out: decode(stdout), err: decode(stderr) };
}

const brb = (obs: FakeObs, ...args: string[]) => brbIn(undefined, obs, ...args);

Deno.test("showing a message starts the virtual camera by default; --no-cam opts out", async () => {
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

Deno.test("--color / --bg / --bg-opacity restyle the source and stick", async () => {
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

Deno.test("brb.json in the working directory sets defaults; flags override it", async () => {
  await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
  const dir = Deno.makeTempDirSync();
  Deno.writeTextFileSync(
    `${dir}/brb.json`,
    JSON.stringify({ message: "Back soon", color: "lime", bg: "#000000", bgOpacity: 55, cam: false, source: "status" }),
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

Deno.test("brb.json with a password is rejected before touching OBS", async () => {
  await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
  const dir = Deno.makeTempDirSync();
  Deno.writeTextFileSync(`${dir}/brb.json`, JSON.stringify({ password: "hunter2" }));
  const result = await brbIn(dir, obs, "setup");
  assertEquals(result.code, 1);
  assertStringIncludes(result.err, "OBS_WEBSOCKET_PASSWORD");
  assertEquals(Object.keys(obs.state.inputs), []);
});
