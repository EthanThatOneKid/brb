import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { FakeObs } from "./fake_obs.ts";
import { connectLaunching, detachedCommand, isLocalUrl, readObsPassword, resolveLaunch } from "./launch.ts";
import { ObsUnreachableError } from "./obs.ts";

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
  const probe = await FakeObs.start({ scenes: ["Main"], current: "Main" });
  const port = probe.port;
  await probe[Symbol.asyncDispose]();
  return port;
}

Deno.test("resolveLaunch finds OBS per platform, and obsPath overrides it", () => {
  assertEquals(resolveLaunch("win32", { ProgramFiles: "D:\\Apps" }), {
    command: "D:\\Apps\\obs-studio\\bin\\64bit\\obs64.exe",
    args: ["--disable-shutdown-check"],
    cwd: "D:\\Apps\\obs-studio\\bin\\64bit",
  });
  assertEquals(resolveLaunch("win32", {}).command, "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe");
  assertEquals(resolveLaunch("win32", {}, "E:\\obs\\obs64.exe").cwd, "E:\\obs");
  assertEquals(resolveLaunch("darwin", {}).command, "open");
  assertEquals(resolveLaunch("darwin", {}).args.slice(0, 2), ["-a", "OBS"]);
  assertEquals(resolveLaunch("linux", {}).command, "obs");
  assertEquals(resolveLaunch("linux", {}, "/opt/obs/bin/obs").command, "/opt/obs/bin/obs");
});

Deno.test("isLocalUrl only accepts this machine", () => {
  for (const url of ["ws://127.0.0.1:4455", "ws://localhost:4455", "ws://[::1]:4455"]) {
    assertEquals(isLocalUrl(url), true, url);
  }
  for (const url of ["ws://192.168.1.20:4455", "ws://obs.example.com:4455", "not a url"]) {
    assertEquals(isLocalUrl(url), false, url);
  }
});

Deno.test("connectLaunching starts OBS when nothing is listening, then connects once it is up", async () => {
  const port = await freePort();
  let fake: FakeObs | undefined;
  let launched = 0;
  let announced = 0;
  try {
    const client = await connectLaunching({ url: `ws://127.0.0.1:${port}`, password: "hunter2" }, {
      launch: true,
      start: () => {
        launched++;
        // OBS takes a moment to open its WebSocket server after the process starts.
        setTimeout(async () => {
          const started = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main", port });
          fake = started;
          // ...and then keeps answering "not ready" while it loads its scenes.
          started.state.notReady = true;
          setTimeout(() => started.state.notReady = false, 1200);
        }, 700);
        return Promise.resolve();
      },
      onLaunch: () => announced++,
    });
    assertEquals(await client.request("GetCurrentProgramScene"), { currentProgramSceneName: "Main" });
    client.close();
    assertEquals([launched, announced], [1, 1]);
  } finally {
    await fake?.[Symbol.asyncDispose]();
  }
});

Deno.test("connectLaunching leaves OBS alone when launching is off, or when OBS is up but rejects us", async () => {
  const port = await freePort();
  let launched = 0;
  const start = () => {
    launched++;
    return Promise.resolve();
  };
  await assertRejects(
    () => connectLaunching({ url: `ws://127.0.0.1:${port}` }, { launch: false, start }),
    ObsUnreachableError,
  );

  await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
  await assertRejects(
    () => connectLaunching({ url: obs.url, password: "wrong" }, { launch: true, start }),
    Error,
    "Authentication failed",
  );
  assertEquals(launched, 0);
});

Deno.test("connectLaunching gives up with a useful message when OBS never opens its WebSocket", async () => {
  const port = await freePort();
  const error = await assertRejects(
    () =>
      connectLaunching({ url: `ws://127.0.0.1:${port}` }, {
        launch: true,
        start: () => Promise.resolve(),
        waitMs: 600,
      }),
    Error,
  );
  assertStringIncludes(error.message, "WebSocket Server Settings");
});

Deno.test("connectLaunching reports an OBS that opens its WebSocket but never finishes loading", async () => {
  await using obs = await FakeObs.start({ scenes: ["Main"], current: "Main" });
  obs.state.notReady = true;
  const port = obs.port;
  // OBS is "already running" (reachable), so start must not be needed: reachability alone isn't readiness.
  const error = await assertRejects(
    () =>
      connectLaunching({ url: `ws://127.0.0.1:${port}` }, {
        launch: true,
        start: () => Promise.resolve(),
        waitMs: 800,
      }),
    Error,
  );
  assertStringIncludes(error.message, "still wasn't ready");
});

Deno.test("readObsPassword reads OBS's own settings only when auth is on", () => {
  const config = (value: unknown) => () => JSON.stringify(value);
  const win = { APPDATA: "C:\\Users\\me\\AppData\\Roaming" };
  assertEquals(
    readObsPassword("win32", win, undefined, config({ auth_required: true, server_password: "s3cret" })),
    "s3cret",
  );
  assertEquals(
    readObsPassword("win32", win, undefined, config({ auth_required: false, server_password: "x" })),
    undefined,
  );
  assertEquals(readObsPassword("win32", win, undefined, config({ auth_required: true })), undefined);
  assertEquals(
    readObsPassword("win32", {}, undefined, config({ auth_required: true, server_password: "x" })),
    undefined,
  );

  const paths: string[] = [];
  const spy = (path: string) => {
    paths.push(path);
    return JSON.stringify({ auth_required: true, server_password: "pw" });
  };
  readObsPassword("linux", {}, "/home/me", spy);
  readObsPassword("darwin", {}, "/Users/me", spy);
  assertEquals(paths, [
    "/home/me/.config/obs-studio/plugin_config/obs-websocket/config.json",
    "/Users/me/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json",
  ]);

  // A missing or unreadable file means "no password", never a crash.
  assertEquals(
    readObsPassword("linux", {}, "/home/me", () => {
      throw new Error("ENOENT");
    }),
    undefined,
  );
});

Deno.test("detachedCommand starts OBS through Start-Process on Windows so it can't inherit brb's output pipe", () => {
  const win = detachedCommand(resolveLaunch("win32", { ProgramFiles: "C:\\Program Files" }), "win32");
  assertEquals(win.command, "powershell.exe");
  assertEquals(win.waitForExit, true);
  assertEquals(win.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assertEquals(
    win.args[3],
    "Start-Process -FilePath 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' " +
      "-WorkingDirectory 'C:\\Program Files\\obs-studio\\bin\\64bit' -ArgumentList '--disable-shutdown-check'",
  );

  // A quote in the path can't break out of the command.
  const odd = detachedCommand({ command: "C:\\it's\\obs64.exe", args: [], cwd: "C:\\it's" }, "win32");
  assertEquals(odd.args[3], "Start-Process -FilePath 'C:\\it''s\\obs64.exe' -WorkingDirectory 'C:\\it''s'");

  // Elsewhere OBS is spawned directly and detached.
  const linux = detachedCommand(resolveLaunch("linux", {}), "linux");
  assertEquals([linux.command, linux.waitForExit], ["obs", false]);
});
