import { assertEquals, assertRejects } from "@std/assert";
import { closeObs, type Host, parseNetstatPid, parseTasklistName, prepareQuit } from "./quit.ts";
import type { Obs } from "./commands.ts";
import { ObsRequestError } from "./obs.ts";

/** A scripted OBS: `outputs` says which status requests report active. Anything else throws like OBS would. */
function fakeObs(outputs: { stream?: boolean; record?: boolean; replay?: boolean | "disabled" } = {}): Obs {
  return {
    request<T>(type: string): Promise<T> {
      const reply = (outputActive: boolean) => Promise.resolve({ outputActive } as T);
      switch (type) {
        case "GetStreamStatus":
          return reply(!!outputs.stream);
        case "GetRecordStatus":
          return reply(!!outputs.record);
        case "GetReplayBufferStatus":
          return outputs.replay === "disabled" || outputs.replay === undefined
            ? Promise.reject(new ObsRequestError(type, 604, "The replay buffer is not enabled."))
            : reply(outputs.replay);
        default:
          return Promise.reject(new Error(`unexpected ${type}`));
      }
    },
  };
}

function fakeHost(overrides: Partial<Host> = {}): Host & { closed: number[] } {
  const closed: number[] = [];
  return {
    listeningPid: () => Promise.resolve(26456),
    processName: () => Promise.resolve("obs64.exe"),
    requestClose: (pid) => {
      closed.push(pid);
      return Promise.resolve();
    },
    sleep: () => Promise.resolve(),
    ...overrides,
    closed,
  };
}

Deno.test("parseNetstatPid finds the listener regardless of the state's language", () => {
  const output = [
    "Active Connections",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:4455           0.0.0.0:0              LISTENING       26456",
    "  TCP    [::]:4455              [::]:0                 LISTENING       26456",
    "  TCP    127.0.0.1:50000        127.0.0.1:4455         ESTABLISHED     999",
    "  TCP    0.0.0.0:44550          0.0.0.0:0              ABHÖREN         777",
  ].join("\r\n");
  assertEquals(parseNetstatPid(output, 4455), 26456);
  assertEquals(parseNetstatPid(output, 44550), 777); // a localized state name still matches
  assertEquals(parseNetstatPid(output, 9999), undefined);
  assertEquals(parseNetstatPid("", 4455), undefined);
});

Deno.test("parseTasklistName", () => {
  assertEquals(parseTasklistName('"obs64.exe","26456","Console","3","279,544 K"\r\n'), "obs64.exe");
  assertEquals(parseTasklistName("INFO: No tasks are running which match the specified criteria."), undefined);
});

Deno.test("prepareQuit returns the OBS pid when everything is safe", async () => {
  const host = fakeHost();
  assertEquals(await prepareQuit(fakeObs(), "ws://127.0.0.1:4455", host), 26456);
  assertEquals(host.closed, []); // preparing never closes anything
});

Deno.test("prepareQuit refuses while OBS is busy, naming what", async () => {
  await assertRejects(
    () => prepareQuit(fakeObs({ record: true }), "ws://127.0.0.1:4455", fakeHost()),
    Error,
    "recording",
  );
  await assertRejects(
    () => prepareQuit(fakeObs({ stream: true }), "ws://127.0.0.1:4455", fakeHost()),
    Error,
    "streaming",
  );
  await assertRejects(
    () => prepareQuit(fakeObs({ stream: true, record: true }), "ws://127.0.0.1:4455", fakeHost()),
    Error,
    "streaming and recording",
  );
  await assertRejects(
    () => prepareQuit(fakeObs({ replay: true }), "ws://127.0.0.1:4455", fakeHost()),
    Error,
    "replay buffer",
  );
});

Deno.test("prepareQuit refuses a remote OBS", async () => {
  await assertRejects(
    () => prepareQuit(fakeObs(), "ws://192.168.1.20:4455", fakeHost()),
    Error,
    "can only close a local OBS",
  );
});

Deno.test("prepareQuit refuses anything that isn't OBS on that port", async () => {
  const notObs = fakeHost({ processName: () => Promise.resolve("node.exe") });
  await assertRejects(() => prepareQuit(fakeObs(), "ws://localhost:4455", notObs), Error, "isn't OBS");
  const nobody = fakeHost({ listeningPid: () => Promise.resolve(undefined) });
  await assertRejects(() => prepareQuit(fakeObs(), "ws://localhost:4455", nobody), Error, "couldn't find the process");
  const noLsof = fakeHost({ listeningPid: () => Promise.reject(new Error("needs `lsof` to find the OBS process")) });
  await assertRejects(() => prepareQuit(fakeObs(), "ws://localhost:4455", noLsof), Error, "lsof");
  // Names seen on each platform all count as OBS.
  for (const name of ["obs64.exe", "obs", "OBS"]) {
    assertEquals(
      await prepareQuit(fakeObs(), "ws://localhost:4455", fakeHost({ processName: () => Promise.resolve(name) })),
      26456,
    );
  }
});

Deno.test("closeObs asks once, then waits until the process is gone", async () => {
  let polls = 0;
  const host = fakeHost({ processName: () => Promise.resolve(++polls < 3 ? "obs64.exe" : undefined) });
  assertEquals(await closeObs(26456, host), "OBS closed.");
  assertEquals(host.closed, [26456]);
  assertEquals(polls, 3);
});

Deno.test("closeObs reports a process that won't exit, and a close request that fails", async () => {
  const stuck = fakeHost({ processName: () => Promise.resolve("obs64.exe") });
  await assertRejects(() => closeObs(1, stuck, 50), Error, "still running");
  const denied = fakeHost({ requestClose: () => Promise.reject(new Error("Access is denied.\nmore")) });
  await assertRejects(() => closeObs(1, denied), Error, "Couldn't ask OBS to close: Access is denied.");
});
