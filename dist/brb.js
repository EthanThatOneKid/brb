#!/usr/bin/env node

// main.ts
import process from "node:process";
import { parseArgs } from "node:util";

// obs.ts
var ObsRequestError = class extends Error {
  requestType;
  code;
  constructor(requestType, code, comment) {
    super(`${requestType} failed (${code}): ${comment}`), this.requestType = requestType, this.code = code;
    this.name = "ObsRequestError";
  }
};
var ResourceNotFound = 600;
function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
async function sha256Base64(text) {
  return toBase64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
async function computeAuth(password, salt, challenge) {
  const secret = await sha256Base64(password + salt);
  return await sha256Base64(secret + challenge);
}
var OP = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Request: 6,
  RequestResponse: 7
};
var ObsClient = class _ObsClient {
  #socket;
  #pending = /* @__PURE__ */ new Map();
  #nextId = 0;
  constructor(socket) {
    this.#socket = socket;
  }
  static connect(options) {
    const { url, password, timeoutMs = 5e3 } = options;
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(url, [
          "obswebsocket.json"
        ]);
      } catch (error) {
        reject(new Error(`Invalid OBS WebSocket URL ${url}: ${error.message}`));
        return;
      }
      const client = new _ObsClient(socket);
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
        }
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error(`Timed out connecting to OBS at ${url}.`)), timeoutMs);
      socket.onerror = () => fail(new Error(`Could not connect to OBS at ${url}.`));
      socket.onclose = (event) => {
        const reason = event.code === 4009 ? "Authentication failed (wrong OBS_WEBSOCKET_PASSWORD?)." : `Connection to OBS closed (${event.code}${event.reason ? `: ${event.reason}` : ""}).`;
        fail(new Error(reason));
        client.#rejectAll(new Error(reason));
      };
      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        try {
          switch (message.op) {
            case OP.Hello: {
              const identify = {
                rpcVersion: 1
              };
              const auth = message.d.authentication;
              if (auth) {
                if (!password) {
                  fail(new Error("OBS requires a password. Set OBS_WEBSOCKET_PASSWORD or pass --password."));
                  return;
                }
                identify.authentication = await computeAuth(password, auth.salt, auth.challenge);
              }
              socket.send(JSON.stringify({
                op: OP.Identify,
                d: identify
              }));
              break;
            }
            case OP.Identified:
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(client);
              }
              break;
            case OP.RequestResponse:
              client.#settle(message.d);
              break;
          }
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  #settle(d) {
    const pending = this.#pending.get(d.requestId);
    if (!pending) return;
    this.#pending.delete(d.requestId);
    const status2 = d.requestStatus;
    if (status2.result) pending.resolve(d.responseData ?? {});
    else pending.reject(new ObsRequestError(pending.type, status2.code, status2.comment ?? "no comment"));
  }
  #rejectAll(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
  request(type, data) {
    return new Promise((resolve, reject) => {
      const requestId = String(this.#nextId++);
      this.#pending.set(requestId, {
        type,
        resolve,
        reject
      });
      this.#socket.send(JSON.stringify({
        op: OP.Request,
        d: {
          requestType: type,
          requestId,
          requestData: data
        }
      }));
    });
  }
  close() {
    this.#socket.onclose = null;
    this.#socket.close();
  }
};

// style.ts
var DEFAULT_BG_OPACITY = 70;
var NAMED = {
  white: "ffffff",
  black: "000000",
  red: "ff0000",
  green: "008000",
  lime: "00ff00",
  blue: "0000ff",
  yellow: "ffff00",
  orange: "ffa500",
  purple: "800080",
  pink: "ffc0cb",
  cyan: "00ffff",
  magenta: "ff00ff",
  gray: "808080",
  grey: "808080"
};
function parseColor(input) {
  const text = input.trim().toLowerCase();
  let hex = NAMED[text] ?? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (!hex) {
    throw new Error(`Can't parse color "${input}". Use a name (${Object.keys(NAMED).join(", ")}) or hex like "#ff8800" or ff8800.`);
  }
  if (hex.length === 3) hex = [
    ...hex
  ].map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (4278190080 | b << 16 | g << 8 | r) >>> 0;
}
function parseOpacity(input) {
  const value = Number(input);
  if (input.trim() === "" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`Can't parse opacity "${input}". Use a whole number from 0 to 100.`);
  }
  return value;
}
function styleFromFlags(flags) {
  const style = {};
  if (flags.color !== void 0) style.color = parseColor(flags.color);
  const opacity = flags["bg-opacity"] === void 0 ? void 0 : parseOpacity(flags["bg-opacity"]);
  if (flags.bg !== void 0) {
    if ([
      "none",
      "transparent"
    ].includes(flags.bg.trim().toLowerCase())) {
      style.bgOpacity = 0;
    } else {
      style.bg = parseColor(flags.bg);
      style.bgOpacity = opacity ?? DEFAULT_BG_OPACITY;
    }
  } else if (opacity !== void 0) {
    style.bgOpacity = opacity;
  }
  return style;
}
function isEmptyStyle(style) {
  return style.color === void 0 && style.bg === void 0 && style.bgOpacity === void 0;
}
function styleSettings(kind, style) {
  if (kind.startsWith("text_gdiplus")) {
    const settings = {};
    if (style.color !== void 0) settings.color = style.color;
    if (style.bg !== void 0) settings.bk_color = style.bg;
    if (style.bgOpacity !== void 0) settings.bk_opacity = style.bgOpacity;
    return settings;
  }
  if (kind === "text_ft2_source_v2") {
    if (style.bg !== void 0 || style.bgOpacity !== void 0) {
      throw new Error("This text source (FreeType2) has no background box, so --bg/--bg-opacity can't be used. Only --color works with it.");
    }
    return style.color === void 0 ? {} : {
      color1: style.color,
      color2: style.color
    };
  }
  if (isEmptyStyle(style)) return {};
  throw new Error(`Don't know how to style a "${kind}" source.`);
}

// commands.ts
var TEXT_KINDS = [
  "text_gdiplus_v3",
  "text_gdiplus_v2",
  "text_ft2_source_v2"
];
var SETUP_HINT = (target, scene) => `Source "${target.source}" isn't in scene "${scene}". Run \`brb setup\` (once per scene) to add it.`;
async function sceneOf(obs, target) {
  if (target.scene) return target.scene;
  const { currentProgramSceneName } = await obs.request("GetCurrentProgramScene");
  return currentProgramSceneName;
}
async function findItem(obs, scene, source) {
  try {
    const { sceneItemId } = await obs.request("GetSceneItemId", {
      sceneName: scene,
      sourceName: source
    });
    return sceneItemId;
  } catch (error) {
    if (error instanceof ObsRequestError && error.code === ResourceNotFound) return void 0;
    throw error;
  }
}
async function show(obs, target, text, options = {}) {
  const { startCamera = true, style = {} } = options;
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId === void 0) throw new Error(SETUP_HINT(target, scene));
  let inputSettings = {
    text
  };
  if (!isEmptyStyle(style)) {
    const { inputKind } = await obs.request("GetInputSettings", {
      inputName: target.source
    });
    inputSettings = {
      text,
      ...styleSettings(inputKind, style)
    };
  }
  await obs.request("SetInputSettings", {
    inputName: target.source,
    inputSettings,
    overlay: true
  });
  await obs.request("SetSceneItemEnabled", {
    sceneName: scene,
    sceneItemId,
    sceneItemEnabled: true
  });
  let started = false;
  if (startCamera) {
    const { outputActive } = await obs.request("GetVirtualCamStatus");
    if (!outputActive) {
      await obs.request("StartVirtualCam");
      started = true;
    }
  }
  return `Showing on "${scene}": ${text.replaceAll("\n", " / ")}${started ? " (started virtual camera)" : ""}`;
}
async function hide(obs, target) {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId === void 0) throw new Error(SETUP_HINT(target, scene));
  await obs.request("SetSceneItemEnabled", {
    sceneName: scene,
    sceneItemId,
    sceneItemEnabled: false
  });
  return `Cleared "${scene}".`;
}
async function setup(obs, target, style = {}) {
  const scene = await sceneOf(obs, target);
  if (await findItem(obs, scene, target.source) !== void 0) {
    return `"${target.source}" is already in scene "${scene}". Nothing to do.`;
  }
  const { inputKinds } = await obs.request("GetInputKindList", {
    unversioned: false
  });
  const kind = TEXT_KINDS.find((candidate) => inputKinds.includes(candidate));
  if (!kind) throw new Error(`This OBS has no text source kind (looked for ${TEXT_KINDS.join(", ")}).`);
  const settings = kind.startsWith("text_gdiplus") ? {
    text: "Be right back",
    font: {
      face: "Segoe UI",
      style: "Bold",
      size: 64,
      flags: 1
    },
    color: 4294967295,
    align: "center",
    bk_color: 4278190080,
    bk_opacity: 70
  } : {
    text: "Be right back",
    font: {
      face: "Sans Serif",
      style: "Bold",
      size: 64,
      flags: 1
    }
  };
  Object.assign(settings, styleSettings(kind, style));
  let sceneItemId;
  let exists = true;
  try {
    await obs.request("GetInputSettings", {
      inputName: target.source
    });
  } catch (error) {
    if (!(error instanceof ObsRequestError && error.code === ResourceNotFound)) throw error;
    exists = false;
  }
  if (exists) {
    if (!isEmptyStyle(style)) {
      await obs.request("SetInputSettings", {
        inputName: target.source,
        inputSettings: styleSettings(kind, style),
        overlay: true
      });
    }
    ({ sceneItemId } = await obs.request("CreateSceneItem", {
      sceneName: scene,
      sourceName: target.source,
      sceneItemEnabled: false
    }));
  } else {
    ({ sceneItemId } = await obs.request("CreateInput", {
      sceneName: scene,
      inputName: target.source,
      inputKind: kind,
      inputSettings: settings,
      sceneItemEnabled: false
    }));
  }
  const { baseWidth, baseHeight } = await obs.request("GetVideoSettings");
  await obs.request("SetSceneItemTransform", {
    sceneName: scene,
    sceneItemId,
    sceneItemTransform: {
      positionX: baseWidth / 2,
      positionY: baseHeight * 0.85,
      alignment: 0
    }
  });
  return `Added "${target.source}" (${kind}) to scene "${scene}", hidden. Try: brb "back in 5"`;
}
async function cam(obs, state) {
  const { outputActive } = await obs.request("GetVirtualCamStatus");
  if (state === "on" && !outputActive) await obs.request("StartVirtualCam");
  if (state === "off" && outputActive) await obs.request("StopVirtualCam");
  return `Virtual camera ${state}.`;
}
async function status(obs, target) {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  const { outputActive } = await obs.request("GetVirtualCamStatus");
  const camera = `virtual camera ${outputActive ? "on" : "off"}`;
  if (sceneItemId === void 0) {
    return `Scene "${scene}": no "${target.source}" source (run \`brb setup\`); ${camera}.`;
  }
  const { sceneItemEnabled } = await obs.request("GetSceneItemEnabled", {
    sceneName: scene,
    sceneItemId
  });
  if (!sceneItemEnabled) return `Scene "${scene}": message hidden; ${camera}.`;
  const { inputSettings } = await obs.request("GetInputSettings", {
    inputName: target.source
  });
  return `Scene "${scene}": showing "${(inputSettings.text ?? "").replaceAll("\n", " / ")}"; ${camera}.`;
}

// config.ts
import { readFileSync } from "node:fs";
var STRING_KEYS = [
  "message",
  "color",
  "bg",
  "source",
  "scene",
  "url"
];
var KEYS = [
  ...STRING_KEYS,
  "bgOpacity",
  "cam"
];
function parseConfig(text, where) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} isn't valid JSON: ${error.message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${where} must be a JSON object.`);
  }
  const object = raw;
  if ("password" in object) {
    throw new Error(`${where} can't hold "password" (it's meant to be shared). Use OBS_WEBSOCKET_PASSWORD instead.`);
  }
  for (const key of Object.keys(object)) {
    if (!KEYS.includes(key)) throw new Error(`${where}: unknown key "${key}". Allowed: ${KEYS.join(", ")}.`);
  }
  for (const key of STRING_KEYS) {
    if (key in object && typeof object[key] !== "string") throw new Error(`${where}: "${key}" must be a string.`);
  }
  if ("cam" in object && typeof object.cam !== "boolean") throw new Error(`${where}: "cam" must be true or false.`);
  if ("bgOpacity" in object && typeof object.bgOpacity !== "number") {
    throw new Error(`${where}: "bgOpacity" must be a number from 0 to 100.`);
  }
  return object;
}
function defaultConfigPaths(cwd, home) {
  const paths = [
    `${cwd}/brb.json`
  ];
  if (home) paths.push(`${home}/.config/brb/brb.json`);
  return paths;
}
function loadConfig(explicitPath, cwd, home) {
  const candidates = explicitPath ? [
    explicitPath
  ] : defaultConfigPaths(cwd, home);
  for (const path of candidates) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" && !explicitPath) continue;
      throw new Error(`Can't read config ${path}: ${error.message}`);
    }
    return parseConfig(text, path);
  }
  return {};
}

// format.ts
function parseDuration(input) {
  const text = input.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 6e4);
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!text || !match) throw new Error(`Can't parse duration "${input}". Try 5, 5m, 90s, or 1h30m.`);
  const [, h = "0", m = "0", s = "0"] = match;
  return ((+h * 60 + +m) * 60 + +s) * 1e3;
}
function formatClock(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}
var DEFAULT_MESSAGE = "Be right back";
function buildMessage(words, backInMs, now = /* @__PURE__ */ new Date(), fallback = DEFAULT_MESSAGE) {
  const base = (words.join(" ").trim() || fallback).replaceAll("\\n", "\n");
  if (backInMs === void 0) return base;
  return `${base}
Back at ${formatClock(new Date(now.getTime() + backInMs))}`;
}

// main.ts
var HELP = `brb: put a message on your OBS camera from the terminal.

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
var COMMANDS = /* @__PURE__ */ new Set([
  "off",
  "clear",
  "hide",
  "setup",
  "cam",
  "status",
  "help"
]);
async function main() {
  const args = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      in: {
        type: "string",
        short: "i"
      },
      "no-cam": {
        type: "boolean"
      },
      cam: {
        type: "boolean"
      },
      color: {
        type: "string"
      },
      bg: {
        type: "string"
      },
      "bg-opacity": {
        type: "string"
      },
      scene: {
        type: "string",
        short: "s"
      },
      source: {
        type: "string"
      },
      url: {
        type: "string"
      },
      password: {
        type: "string"
      },
      config: {
        type: "string"
      },
      help: {
        type: "boolean",
        short: "h"
      }
    }
  });
  const forcedMessage = args.includes("--");
  const [first, ...rest] = positionals;
  const command = !forcedMessage && first && COMMANDS.has(first) ? first : void 0;
  if (values.help || command === "help") {
    console.log(HELP);
    return;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const config = loadConfig(values.config, process.cwd().replaceAll("\\", "/"), home?.replaceAll("\\", "/"));
  const backInMs = values.in === void 0 ? void 0 : parseDuration(values.in);
  if (command === "cam" && rest[0] !== "on" && rest[0] !== "off") throw new Error("Usage: brb cam on|off");
  const style = styleFromFlags({
    color: values.color ?? config.color,
    bg: values.bg ?? config.bg,
    "bg-opacity": values["bg-opacity"] ?? (config.bgOpacity === void 0 ? void 0 : String(config.bgOpacity))
  });
  const message = command ? void 0 : buildMessage(positionals, backInMs, /* @__PURE__ */ new Date(), config.message);
  const target = {
    source: values.source ?? process.env.BRB_SOURCE ?? config.source ?? "brb-status",
    scene: values.scene ?? config.scene
  };
  const obs = await ObsClient.connect({
    url: values.url ?? process.env.OBS_WEBSOCKET_URL ?? config.url ?? "ws://127.0.0.1:4455",
    password: values.password ?? process.env.OBS_WEBSOCKET_PASSWORD
  });
  try {
    let result;
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
        result = await cam(obs, rest[0]);
        break;
      case "status":
        result = await status(obs, target);
        break;
      default:
        result = await show(obs, target, message, {
          startCamera: !values["no-cam"] && config.cam !== false,
          style
        });
    }
    console.log(result);
  } finally {
    obs.close();
  }
}
try {
  await main();
} catch (error) {
  console.error(`brb: ${error.message}`);
  process.exitCode = 1;
}
