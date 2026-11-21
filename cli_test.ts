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
