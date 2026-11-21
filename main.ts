#!/usr/bin/env node
import process from "node:process";
import { parseArgs } from "node:util";
import { cam, hide, setup, show, status, type Target } from "./commands.ts";
import { loadConfig } from "./config.ts";
import { buildMessage, parseDuration } from "./format.ts";
import { ObsClient } from "./obs.ts";
import { styleFromFlags } from "./style.ts";

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
      --no-cam            don't auto-start the virtual camera (showing a message starts it by default)
      --color <color>     text color: a name (white, red, ...) or hex ("#ff8800" or ff8800)
      --bg <color|none>   background box color, or "none" for no box
      --bg-opacity <0-100>  background box opacity (default 70 when --bg is set)
  -s, --scene <name>      scene to act on (default: current program scene)
      --source <name>     text source name (default: brb-status, env BRB_SOURCE)
      --url <ws-url>      OBS WebSocket URL (default: ws://127.0.0.1:4455, env OBS_WEBSOCKET_URL)
      --password <pw>     OBS WebSocket password (env OBS_WEBSOCKET_PASSWORD)
      --config <path>     JSON file of flag defaults (default: ./brb.json, then ~/.config/brb/brb.json)
  -h, --help

Flags beat env vars, which beat the config file. The password is never read from the config file.
Colors stick in OBS until you change them again (e.g. brb --color white --bg black).
Use \`brb -- off\` to show the literal message "off". A \\n in a message is a line break.
OBS needs Tools > WebSocket Server Settings > Enable WebSocket server.`;

const COMMANDS = new Set(["off", "clear", "hide", "setup", "cam", "status", "help"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      in: { type: "string", short: "i" },
      "no-cam": { type: "boolean" },
      cam: { type: "boolean" }, // accepted for compatibility; starting the camera is now the default
      color: { type: "string" },
      bg: { type: "string" },
      "bg-opacity": { type: "string" },
      scene: { type: "string", short: "s" },
      source: { type: "string" },
      url: { type: "string" },
      password: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  // `--` forces everything after it to be a message, even if it looks like a command.
  const forcedMessage = args.includes("--");
  const [first, ...rest] = positionals;
  const command = !forcedMessage && first && COMMANDS.has(first) ? first : undefined;

  if (values.help || command === "help") {
    console.log(HELP);
    return;
  }

  // Validate before touching the network.
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const config = loadConfig(values.config, process.cwd().replaceAll("\\", "/"), home?.replaceAll("\\", "/"));
  const backInMs = values.in === undefined ? undefined : parseDuration(values.in);
  if (command === "cam" && rest[0] !== "on" && rest[0] !== "off") throw new Error("Usage: brb cam on|off");
  const style = styleFromFlags({
    color: values.color ?? config.color,
    bg: values.bg ?? config.bg,
    "bg-opacity": values["bg-opacity"] ?? (config.bgOpacity === undefined ? undefined : String(config.bgOpacity)),
  });
  const message = command ? undefined : buildMessage(positionals, backInMs, new Date(), config.message);

  const target: Target = {
    source: values.source ?? process.env.BRB_SOURCE ?? config.source ?? "brb-status",
    scene: values.scene ?? config.scene,
  };
  const obs = await ObsClient.connect({
    url: values.url ?? process.env.OBS_WEBSOCKET_URL ?? config.url ?? "ws://127.0.0.1:4455",
    password: values.password ?? process.env.OBS_WEBSOCKET_PASSWORD,
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
        result = await setup(obs, target, style);
        break;
      case "cam":
        result = await cam(obs, rest[0] as "on" | "off");
        break;
      case "status":
        result = await status(obs, target);
        break;
      default:
        result = await show(obs, target, message!, { startCamera: !values["no-cam"] && config.cam !== false, style });
    }
    console.log(result);
  } finally {
    obs.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`brb: ${(error as Error).message}`);
  process.exitCode = 1;
}
