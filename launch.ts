import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { type ConnectOptions, NotReady, ObsClient, ObsRequestError, ObsUnreachableError } from "./obs.ts";

/** How to start OBS on this machine. */
export interface LaunchCommand {
  command: string;
  args: string[];
  /** OBS on Windows must start from its own folder, or it can't find its locale files. */
  cwd?: string;
}

/** Flags OBS accepts that we always pass: skip the "OBS crashed last time, run in safe mode?" prompt. */
const OBS_ARGS = ["--disable-shutdown-check"];

/** Where OBS lives by default, per platform. `obsPath` (brb.json / BRB_OBS_PATH) overrides it. */
export function resolveLaunch(
  platform: string,
  env: Record<string, string | undefined>,
  obsPath?: string,
): LaunchCommand {
  switch (platform) {
    case "win32": {
      const exe = obsPath ??
        win32.join(env.ProgramFiles ?? "C:\\Program Files", "obs-studio", "bin", "64bit", "obs64.exe");
      return { command: exe, args: OBS_ARGS, cwd: win32.dirname(exe) };
    }
    case "darwin":
      return { command: "open", args: ["-a", obsPath ?? "OBS", "--args", ...OBS_ARGS] };
    default:
      return { command: obsPath ?? "obs", args: OBS_ARGS };
  }
}

/** True for a URL that points at this machine, the only place `brb` will try to start OBS. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/** Starts OBS detached from this process, so it outlives `brb`. Rejects when the program can't be started. */
export function spawnObs(launch: LaunchCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    if (launch.cwd && !existsSync(launch.command)) {
      reject(
        new Error(
          `Can't find OBS at ${launch.command}. Set "obsPath" in brb.json or BRB_OBS_PATH, or start it yourself.`,
        ),
      );
      return;
    }
    const run = detachedCommand(launch, process.platform);
    // Not detached when going through PowerShell: without a console, `Start-Process` silently starts nothing.
    const child = spawn(run.command, run.args, {
      cwd: run.cwd,
      detached: !run.waitForExit,
      stdio: "ignore",
      windowsHide: true,
    });
    const fail = (why: string) =>
      reject(new Error(`Couldn't start OBS (${launch.command}): ${why}. Set "obsPath" in brb.json or BRB_OBS_PATH.`));
    child.once("error", (error) => fail(error.message));
    if (run.waitForExit) {
      child.once("exit", (code) => code === 0 ? resolve() : fail(`${run.command} exited with code ${code}`));
    } else {
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    }
  });
}

/** A PowerShell single-quoted string literal. */
const psQuote = (text: string) => `'${text.replaceAll("'", "''")}'`;

/**
 * What to actually run so OBS outlives `brb` and never holds `brb`'s output open.
 *
 * On Windows, a child started with CreateProcess inherits the parent's stdout/stderr pipe handles, so anything
 * capturing `brb`'s output (a script, an agent, `$(brb ...)`) hangs until OBS exits. `Start-Process` launches through
 * the shell without inheriting handles, so PowerShell starts OBS and exits straight away.
 */
export function detachedCommand(
  launch: LaunchCommand,
  platform: string,
): LaunchCommand & { waitForExit: boolean } {
  if (platform !== "win32") return { ...launch, waitForExit: false };
  const parts = [`Start-Process -FilePath ${psQuote(launch.command)}`];
  if (launch.cwd) parts.push(`-WorkingDirectory ${psQuote(launch.cwd)}`);
  if (launch.args.length) parts.push(`-ArgumentList ${launch.args.map(psQuote).join(",")}`);
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", parts.join(" ")],
    waitForExit: true,
  };
}

export interface LaunchOptions {
  /** Start OBS when nothing is listening. */
  launch: boolean;
  /** Starts OBS. Defaults to spawning the platform's usual command. Tests pass their own. */
  start?: () => Promise<void>;
  /** How long to wait for OBS's WebSocket server after starting it. Default 30000. */
  waitMs?: number;
  /** Called once when OBS is being started, so the CLI can say so. */
  onLaunch?: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The WebSocket opens before OBS finishes loading its scenes; until then every request fails with "not ready".
 * Waits up to `waitMs` for the first real answer, and closes the client if it never comes.
 */
async function awaitReady(client: ObsClient, waitMs: number): Promise<ObsClient> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await client.request("GetCurrentProgramScene");
      return client;
    } catch (error) {
      const notReady = error instanceof ObsRequestError && error.code === NotReady;
      if (!notReady || Date.now() >= deadline) {
        client.close();
        throw notReady ? new Error(`OBS is up but still wasn't ready after ${Math.round(waitMs / 1000)}s.`) : error;
      }
      await sleep(500);
    }
  }
}

/**
 * Connects to OBS. When nothing is listening and launching is allowed, starts OBS and keeps retrying until its
 * WebSocket server answers, then waits for OBS to finish loading. Auth and timeout errors are never retried: they
 * mean OBS is up but unhappy.
 */
export async function connectLaunching(connect: ConnectOptions, options: LaunchOptions): Promise<ObsClient> {
  const { waitMs = 30_000 } = options;
  try {
    const client = await ObsClient.connect(connect);
    // Already running: only wait out a still-loading OBS when we're the kind of command that needs it.
    return options.launch ? await awaitReady(client, waitMs) : client;
  } catch (error) {
    if (!(error instanceof ObsUnreachableError) || !options.launch || !isLocalUrl(connect.url)) throw error;
  }
  options.onLaunch?.();
  await (options.start ?? (() => spawnObs(resolveLaunch(process.platform, process.env))))();
  const deadline = Date.now() + waitMs;
  for (;;) {
    await sleep(500);
    try {
      return await awaitReady(await ObsClient.connect(connect), Math.max(deadline - Date.now(), 0));
    } catch (error) {
      if (!(error instanceof ObsUnreachableError)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `Started OBS, but its WebSocket server didn't come up within ${
            Math.round(waitMs / 1000)
          }s. Enable it under Tools > WebSocket Server Settings.`,
        );
      }
    }
  }
}

/**
 * The WebSocket password from OBS's own settings file, or undefined when auth is off or the file is missing.
 * Opt-in only (--read-obs-password / "readObsPassword"): it reads another app's secret.
 */
export function readObsPassword(
  platform: string,
  env: Record<string, string | undefined>,
  home: string | undefined,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const rel = ["obs-studio", "plugin_config", "obs-websocket", "config.json"];
  let path: string | undefined;
  if (platform === "win32") {
    if (env.APPDATA) path = win32.join(env.APPDATA, ...rel);
  } else if (home) {
    path = platform === "darwin"
      ? posix.join(home, "Library", "Application Support", ...rel)
      : posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), ...rel);
  }
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(read(path)) as { auth_required?: boolean; server_password?: string };
    return parsed.auth_required && parsed.server_password ? parsed.server_password : undefined;
  } catch {
    return undefined;
  }
}
