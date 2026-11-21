import { assertEquals, assertStringIncludes } from "@std/assert";
import { FakeObs } from "./fake_obs.ts";

/** Runs the real CLI (main.ts) as a subprocess against the fake OBS. */
async function brb(obs: FakeObs, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "main.ts", "--url", obs.url, "--password", "hunter2", ...args],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code, out: decode(stdout), err: decode(stderr) };
}

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
