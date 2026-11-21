#!/usr/bin/env -S deno run -A
import { parseArgs } from "node:util";
import { cam, hide, setup, show, status, type Target } from "./commands.ts";
import { buildMessage, parseDuration } from "./format.ts";
import { ObsClient } from "./obs.ts";

const HELP = `brb: put a message on your OBS camera from the terminal.

Usage:
  brb [message...]        show a message (default: "Be right back")
  brb "grabbing coffee" --in 5m   ...and append "Back at <time>"
  brb off                 take the message off camera (also: clear, hide)
  brb setup               add the text source to the current scene (once per scene)
  brb cam on|off          start/stop the OBS virtual camera
  brb status              what viewers see right now

Options:
  -i, --in <duration>     5, 5m, 90s, 1h30m (a bare number is minutes)
      --cam               also start the virtual camera
  -s, --scene <name>      scene to act on (default: current program scene)
      --source <name>     text source name (default: brb-status, env BRB_SOURCE)
      --url <ws-url>      OBS WebSocket URL (default: ws://127.0.0.1:4455, env OBS_WEBSOCKET_URL)
      --password <pw>     OBS WebSocket password (env OBS_WEBSOCKET_PASSWORD)
  -h, --help

Use \`brb -- off\` to show the literal message "off". A \\n in a message is a line break.
OBS needs Tools > WebSocket Server Settings > Enable WebSocket server.`;

const COMMANDS = new Set(["off", "clear", "hide", "setup", "cam", "status", "help"]);

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      in: { type: "string", short: "i" },
      cam: { type: "boolean" },
      scene: { type: "string", short: "s" },
      source: { type: "string" },
      url: { type: "string" },
      password: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  // `--` forces everything after it to be a message, even if it looks like a command.
  const forcedMessage = Deno.args.includes("--");
  const [first, ...rest] = positionals;
  const command = !forcedMessage && first && COMMANDS.has(first) ? first : undefined;

  if (values.help || command === "help") {
    console.log(HELP);
    return;
  }

  // Validate before touching the network.
  const backInMs = values.in === undefined ? undefined : parseDuration(values.in);
  if (command === "cam" && rest[0] !== "on" && rest[0] !== "off") throw new Error("Usage: brb cam on|off");
  const message = command ? undefined : buildMessage(positionals, backInMs);

  const target: Target = {
    source: values.source ?? Deno.env.get("BRB_SOURCE") ?? "brb-status",
    scene: values.scene,
  };
  const obs = await ObsClient.connect({
    url: values.url ?? Deno.env.get("OBS_WEBSOCKET_URL") ?? "ws://127.0.0.1:4455",
    password: values.password ?? Deno.env.get("OBS_WEBSOCKET_PASSWORD"),
  });
  try {
    let result: string;
    switch (command) {
      case "off":
      case "clear":
      case "hide":
        result = await hide(obs, target);
        break;
      case "setup":
        result = await setup(obs, target);
        break;
      case "cam":
        result = await cam(obs, rest[0] as "on" | "off");
        break;
      case "status":
        result = await status(obs, target);
        break;
      default:
        result = await show(obs, target, message!, values.cam);
    }
    console.log(result);
  } finally {
    obs.close();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`brb: ${(error as Error).message}`);
    Deno.exit(1);
  }
}
