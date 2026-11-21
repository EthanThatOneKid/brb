/**
 * `brb stop --quit-obs`: ask a local OBS to close. OBS's WebSocket API has no quit request, so this goes through the
 * OS: find the process listening on the WebSocket port, confirm it is OBS, ask it to close (never force-kill), and
 * wait for it to exit. It refuses up front if OBS is recording or streaming.
 */
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import type { Obs } from "./commands.ts";
import { ObsRequestError } from "./obs.ts";

const run = promisify(execFile);

/** The OS operations `--quit-obs` needs. Injected so the logic can be tested without touching real processes. */
export interface Host {
  /** PID of the process listening on a local TCP port. */
  listeningPid(port: number): Promise<number | undefined>;
  /** Executable name of a process, or undefined if it isn't running. */
  processName(pid: number): Promise<string | undefined>;
  /** Asks the process to close gracefully (WM_CLOSE on Windows, SIGTERM elsewhere). Never forces. */
  requestClose(pid: number): Promise<void>;
  sleep(ms: number): Promise<void>;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);
const prefix = "Not quitting OBS:";

/** Parses `netstat -ano -p tcp` for the listener on `port`. Language-independent: it keys on the 0.0.0.0:0 peer. */
export function parseNetstatPid(output: string, port: number): number | undefined {
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    const [, local, foreign] = cols;
    if (!local.endsWith(`:${port}`) || !/^(0\.0\.0\.0:0|\[::\]:0|\*:\*)$/.test(foreign)) continue;
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return undefined;
}

/** First CSV field of `tasklist /FO CSV /NH` output, e.g. `"obs64.exe","26456",...` -> `obs64.exe`. */
export function parseTasklistName(output: string): string | undefined {
  const match = /^"([^"]+)","\d+"/m.exec(output);
  return match?.[1];
}

const windowsHost: Host = {
  async listeningPid(port) {
    const { stdout } = await run("netstat", ["-ano", "-p", "tcp"]);
    return parseNetstatPid(stdout, port);
  },
  async processName(pid) {
    const { stdout } = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    return parseTasklistName(stdout);
  },
  async requestClose(pid) {
    // No /F: this asks the app's windows to close, like clicking the X. It fails (rather than forcing) if it can't.
    await run("taskkill", ["/PID", String(pid)]);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const unixHost: Host = {
  async listeningPid(port) {
    try {
      const { stdout } = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
      const pid = Number(stdout.trim().split(/\s+/)[0]);
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") throw new Error("needs `lsof` to find the OBS process");
      return undefined; // lsof exits 1 when nothing matches
    }
  },
  async processName(pid) {
    try {
      const { stdout } = await run("ps", ["-p", String(pid), "-o", "comm="]);
      const name = stdout.trim().split("/").pop();
      return name || undefined;
    } catch {
      return undefined;
    }
  },
  requestClose(pid) {
    process.kill(pid, "SIGTERM");
    return Promise.resolve();
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const realHost: Host = process.platform === "win32" ? windowsHost : unixHost;

/** Names of OBS outputs that closing OBS would interrupt. Empty when it is safe to quit. */
export async function busyOutputs(obs: Obs): Promise<string[]> {
  const busy: string[] = [];
  const active = async (type: string): Promise<boolean> => {
    try {
      return (await obs.request<{ outputActive: boolean }>(type)).outputActive;
    } catch (error) {
      // The replay buffer reports an error when it isn't enabled; that just means it isn't running.
      if (error instanceof ObsRequestError) return false;
      throw error;
    }
  };
  if (await active("GetStreamStatus")) busy.push("streaming");
  if (await active("GetRecordStatus")) busy.push("recording");
  if (await active("GetReplayBufferStatus")) busy.push("running the replay buffer");
  return busy;
}

/**
 * Checks everything that can be checked before `stop` changes anything, and returns the OBS PID to close.
 * Throws (with a "Not quitting OBS:" message) if quitting wouldn't be safe or possible.
 */
export async function prepareQuit(obs: Obs, wsUrl: string, host: Host = realHost): Promise<number> {
  const url = new URL(wsUrl);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${prefix} ${url.hostname} isn't this machine, and brb can only close a local OBS.`);
  }
  const busy = await busyOutputs(obs);
  if (busy.length) {
    throw new Error(`${prefix} OBS is ${busy.join(" and ")}. Stop that first, or run \`brb stop\` without --quit-obs.`);
  }
  const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
  let pid: number | undefined;
  try {
    pid = await host.listeningPid(port);
  } catch (error) {
    throw new Error(`${prefix} ${(error as Error).message}.`);
  }
  if (pid === undefined) throw new Error(`${prefix} couldn't find the process listening on port ${port}.`);
  const name = await host.processName(pid);
  if (!name || !/^obs/i.test(name)) {
    throw new Error(`${prefix} the process on port ${port} is "${name ?? "unknown"}" (pid ${pid}), which isn't OBS.`);
  }
  return pid;
}

/** Asks OBS (by PID, already vetted by `prepareQuit`) to close and waits for it to exit. */
export async function closeObs(pid: number, host: Host = realHost, timeoutMs = 10_000): Promise<string> {
  try {
    await host.requestClose(pid);
  } catch (error) {
    throw new Error(`Couldn't ask OBS to close: ${(error as Error).message.split("\n")[0]}`);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await host.processName(pid) === undefined) return "OBS closed.";
    await host.sleep(250);
  }
  throw new Error(
    `Asked OBS to close, but it's still running after ${
      timeoutMs / 1000
    }s. It may be showing a dialog; check its window.`,
  );
}
