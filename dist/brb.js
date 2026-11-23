#!/usr/bin/env node

// main.ts
import process3 from "node:process";
import { parseArgs } from "node:util";

// package.json
var package_default = {
  name: "brb",
  version: "0.1.0",
  description: "Put a message on your OBS camera from the terminal.",
  license: "MIT",
  type: "module",
  bin: { brb: "dist/brb.js" },
  files: ["dist/brb.js"],
  engines: { node: ">=22" },
  repository: { type: "git", url: "git+https://github.com/EthanThatOneKid/brb.git" },
  keywords: ["obs", "obs-studio", "virtual-camera", "cli", "websocket"]
};

// obs.ts
var ObsRequestError = class extends Error {
  requestType;
  code;
  constructor(requestType, code, comment) {
    super(`${requestType} failed (${code}): ${comment}`), this.requestType = requestType, this.code = code;
    this.name = "ObsRequestError";
  }
};
var ObsUnreachableError = class extends Error {
  constructor(url) {
    super(`Could not connect to OBS at ${url}.`);
    this.name = "ObsUnreachableError";
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
      socket.onerror = () => fail(new ObsUnreachableError(url));
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
var CAMERA_KINDS = [
  "dshow_input",
  "av_capture_input",
  "av_capture_input_v2",
  "v4l2_input"
];
async function setCameras(obs, active) {
  const { inputs } = await obs.request("GetInputList");
  let changed = 0;
  for (const { inputName, inputKind } of inputs) {
    if (!CAMERA_KINDS.includes(inputKind)) continue;
    const { inputSettings } = await obs.request("GetInputSettings", {
      inputName
    });
    if ((inputSettings.active ?? true) === active) continue;
    await obs.request("SetInputSettings", {
      inputName,
      inputSettings: {
        active
      },
      overlay: true
    });
    changed++;
  }
  return changed;
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function darkCameras(obs, scene) {
  const { sceneItems } = await obs.request("GetSceneItemList", {
    sceneName: scene
  });
  return sceneItems.filter((item) => item.inputKind && CAMERA_KINDS.includes(item.inputKind)).filter((item) => !item.sceneItemTransform?.sourceWidth || !item.sceneItemTransform?.sourceHeight).map((item) => ({
    name: item.sourceName,
    kind: item.inputKind
  }));
}
async function wakeCameras(obs, scene, options = {}) {
  const { waitMs = 3e3 } = options;
  let dark = await darkCameras(obs, scene);
  if (dark.length === 0) return [];
  for (const { name, kind } of dark) {
    if (kind !== "dshow_input") continue;
    try {
      await obs.request("PressInputPropertiesButton", {
        inputName: name,
        propertyName: "activate"
      });
    } catch (error) {
      if (!(error instanceof ObsRequestError && error.code === ResourceNotFound)) throw error;
    }
  }
  for (let waited = 0; waited < waitMs && dark.length > 0; waited += 250) {
    await sleep(250);
    dark = await darkCameras(obs, scene);
  }
  return dark.map(({ name }) => name);
}
var noVideoWarning = (names) => `warning: ${names.map((n) => `"${n}"`).join(", ")} still ${names.length === 1 ? "has" : "have"} no video (is another app using the webcam?)`;
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
  let woke = 0;
  let dark = [];
  if (startCamera) {
    woke = await setCameras(obs, true);
    const { outputActive } = await obs.request("GetVirtualCamStatus");
    if (!outputActive) {
      await obs.request("StartVirtualCam");
      started = true;
    }
    dark = await wakeCameras(obs, scene);
  }
  return `Showing on "${scene}": ${text.replaceAll("\n", " / ")}${started ? " (started virtual camera)" : ""}${woke ? " (reactivated camera)" : ""}${dark.length ? `
${noVideoWarning(dark)}` : ""}`;
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
async function hideIfShowing(obs, target, expected) {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId === void 0) return `Timer done; "${target.source}" is no longer in scene "${scene}".`;
  const { sceneItemEnabled } = await obs.request("GetSceneItemEnabled", {
    sceneName: scene,
    sceneItemId
  });
  const { inputSettings } = await obs.request("GetInputSettings", {
    inputName: target.source
  });
  if (!sceneItemEnabled || inputSettings.text !== expected) {
    return `Timer done; left "${scene}" alone because the message had already changed.`;
  }
  await obs.request("SetSceneItemEnabled", {
    sceneName: scene,
    sceneItemId,
    sceneItemEnabled: false
  });
  return `Timer done; cleared "${scene}".`;
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
async function cam(obs, state, target) {
  const { outputActive } = await obs.request("GetVirtualCamStatus");
  if (state === "on") await setCameras(obs, true);
  if (state === "on" && !outputActive) await obs.request("StartVirtualCam");
  if (state === "off" && outputActive) await obs.request("StopVirtualCam");
  if (state === "on" && target) {
    const dark = await wakeCameras(obs, await sceneOf(obs, target));
    if (dark.length) return `Virtual camera on.
${noVideoWarning(dark)}`;
  }
  return `Virtual camera ${state}.`;
}
async function stop(obs, target) {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId !== void 0) {
    await obs.request("SetSceneItemEnabled", {
      sceneName: scene,
      sceneItemId,
      sceneItemEnabled: false
    });
  }
  const { outputActive } = await obs.request("GetVirtualCamStatus");
  if (outputActive) await obs.request("StopVirtualCam");
  const released = await setCameras(obs, false);
  return `Stopped: message hidden, virtual camera off, ${released} camera source${released === 1 ? "" : "s"} released.`;
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
  "url",
  "obsPath"
];
var BOOLEAN_KEYS = [
  "cam",
  "launch",
  "readObsPassword"
];
var KEYS = [
  ...STRING_KEYS,
  ...BOOLEAN_KEYS,
  "bgOpacity"
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
  for (const key of BOOLEAN_KEYS) {
    if (key in object && typeof object[key] !== "boolean") throw new Error(`${where}: "${key}" must be true or false.`);
  }
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

// launch.ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync as readFileSync2 } from "node:fs";
import { posix, win32 } from "node:path";
var OBS_ARGS = [
  "--disable-shutdown-check"
];
function resolveLaunch(platform, env, obsPath) {
  switch (platform) {
    case "win32": {
      const exe = obsPath ?? win32.join(env.ProgramFiles ?? "C:\\Program Files", "obs-studio", "bin", "64bit", "obs64.exe");
      return {
        command: exe,
        args: OBS_ARGS,
        cwd: win32.dirname(exe)
      };
    }
    case "darwin":
      return {
        command: "open",
        args: [
          "-a",
          obsPath ?? "OBS",
          "--args",
          ...OBS_ARGS
        ]
      };
    default:
      return {
        command: obsPath ?? "obs",
        args: OBS_ARGS
      };
  }
}
function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}
function spawnObs(launch) {
  return new Promise((resolve, reject) => {
    if (launch.cwd && !existsSync(launch.command)) {
      reject(new Error(`Can't find OBS at ${launch.command}. Set "obsPath" in brb.json or BRB_OBS_PATH, or start it yourself.`));
      return;
    }
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      detached: true,
      stdio: "ignore"
    });
    child.once("error", (error) => reject(new Error(`Couldn't start OBS (${launch.command}): ${error.message}. Set "obsPath" in brb.json or BRB_OBS_PATH.`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
var sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connectLaunching(connect, options) {
  try {
    return await ObsClient.connect(connect);
  } catch (error) {
    if (!(error instanceof ObsUnreachableError) || !options.launch || !isLocalUrl(connect.url)) throw error;
  }
  options.onLaunch?.();
  await (options.start ?? (() => spawnObs(resolveLaunch(process.platform, process.env))))();
  const { waitMs = 3e4 } = options;
  const deadline = Date.now() + waitMs;
  for (; ; ) {
    await sleep2(500);
    try {
      return await ObsClient.connect(connect);
    } catch (error) {
      if (!(error instanceof ObsUnreachableError)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Started OBS, but its WebSocket server didn't come up within ${Math.round(waitMs / 1e3)}s. Enable it under Tools > WebSocket Server Settings.`);
      }
    }
  }
}
function readObsPassword(platform, env, home, read = (path) => readFileSync2(path, "utf8")) {
  const rel = [
    "obs-studio",
    "plugin_config",
    "obs-websocket",
    "config.json"
  ];
  let path;
  if (platform === "win32") {
    if (env.APPDATA) path = win32.join(env.APPDATA, ...rel);
  } else if (home) {
    path = platform === "darwin" ? posix.join(home, "Library", "Application Support", ...rel) : posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), ...rel);
  }
  if (!path) return void 0;
  try {
    const parsed = JSON.parse(read(path));
    return parsed.auth_required && parsed.server_password ? parsed.server_password : void 0;
  } catch {
    return void 0;
  }
}

// quit.ts
import { execFile } from "node:child_process";
import process2 from "node:process";
import { promisify } from "node:util";
var run = promisify(execFile);
var LOCAL_HOSTS = /* @__PURE__ */ new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "0.0.0.0"
]);
var prefix = "Not quitting OBS:";
function parseNetstatPid(output, port) {
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    const [, local, foreign] = cols;
    if (!local.endsWith(`:${port}`) || !/^(0\.0\.0\.0:0|\[::\]:0|\*:\*)$/.test(foreign)) continue;
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return void 0;
}
function parseTasklistName(output) {
  const match = /^"([^"]+)","\d+"/m.exec(output);
  return match?.[1];
}
var windowsHost = {
  async listeningPid(port) {
    const { stdout } = await run("netstat", [
      "-ano",
      "-p",
      "tcp"
    ]);
    return parseNetstatPid(stdout, port);
  },
  async processName(pid) {
    const { stdout } = await run("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH"
    ]);
    return parseTasklistName(stdout);
  },
  async requestClose(pid) {
    await run("taskkill", [
      "/PID",
      String(pid)
    ]);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};
var unixHost = {
  async listeningPid(port) {
    try {
      const { stdout } = await run("lsof", [
        "-nP",
        `-iTCP:${port}`,
        "-sTCP:LISTEN",
        "-t"
      ]);
      const pid = Number(stdout.trim().split(/\s+/)[0]);
      return Number.isInteger(pid) && pid > 0 ? pid : void 0;
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("needs `lsof` to find the OBS process");
      return void 0;
    }
  },
  async processName(pid) {
    try {
      const { stdout } = await run("ps", [
        "-p",
        String(pid),
        "-o",
        "comm="
      ]);
      const name = stdout.trim().split("/").pop();
      return name || void 0;
    } catch {
      return void 0;
    }
  },
  requestClose(pid) {
    process2.kill(pid, "SIGTERM");
    return Promise.resolve();
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};
var realHost = process2.platform === "win32" ? windowsHost : unixHost;
async function busyOutputs(obs) {
  const busy = [];
  const active = async (type) => {
    try {
      return (await obs.request(type)).outputActive;
    } catch (error) {
      if (error instanceof ObsRequestError) return false;
      throw error;
    }
  };
  if (await active("GetStreamStatus")) busy.push("streaming");
  if (await active("GetRecordStatus")) busy.push("recording");
  if (await active("GetReplayBufferStatus")) busy.push("running the replay buffer");
  return busy;
}
async function prepareQuit(obs, wsUrl, host = realHost) {
  const url = new URL(wsUrl);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${prefix} ${url.hostname} isn't this machine, and brb can only close a local OBS.`);
  }
  const busy = await busyOutputs(obs);
  if (busy.length) {
    throw new Error(`${prefix} OBS is ${busy.join(" and ")}. Stop that first, or run \`brb stop\` without --quit-obs.`);
  }
  const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
  let pid;
  try {
    pid = await host.listeningPid(port);
  } catch (error) {
    throw new Error(`${prefix} ${error.message}.`);
  }
  if (pid === void 0) throw new Error(`${prefix} couldn't find the process listening on port ${port}.`);
  const name = await host.processName(pid);
  if (!name || !/^obs/i.test(name)) {
    throw new Error(`${prefix} the process on port ${port} is "${name ?? "unknown"}" (pid ${pid}), which isn't OBS.`);
  }
  return pid;
}
async function closeObs(pid, host = realHost, timeoutMs = 1e4) {
  try {
    await host.requestClose(pid);
  } catch (error) {
    throw new Error(`Couldn't ask OBS to close: ${error.message.split("\n")[0]}`);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await host.processName(pid) === void 0) return "OBS closed.";
    await host.sleep(250);
  }
  throw new Error(`Asked OBS to close, but it's still running after ${timeoutMs / 1e3}s. It may be showing a dialog; check its window.`);
}

// main.ts
var HELP = `brb: put a message on your OBS camera from the terminal.

Usage:
  brb [message...]        show a message (default: "Be right back")
  brb "grabbing coffee" --in 5m   ...append "Back at <time>", then clear it when the time is up (stays running; Ctrl-C leaves it up)
  brb off                 take the message off camera (also: clear, hide)
  brb setup               add the text source to the current scene (once per scene)
  brb cam on|off          start/stop the OBS virtual camera (on also wakes a webcam that has no video)
  brb stop                hide the message, stop the virtual camera, and release the webcam (light off)
  brb stop --quit-obs     ...and then close OBS (local only; refuses while recording or streaming)
  brb status              what viewers see right now

Options:
  -i, --in <duration>     5, 5m, 90s, 1h30m (a bare number is minutes); shows "Back at <time>" and auto-clears then
      --quit-obs          with the stop command: also close OBS, after checking it is not recording or streaming
      --no-cam            don't auto-start the virtual camera (showing a message starts it by default)
      --no-launch         don't start OBS when it isn't running (message, setup, and cam on start it by default)
      --read-obs-password take the WebSocket password from OBS's own settings when none is given
      --color <color>     text color: a name (white, red, ...) or hex ("#ff8800" or ff8800)
      --bg <color|none>   background box color, or "none" for no box
      --bg-opacity <0-100>  background box opacity (default 70 when --bg is set)
  -s, --scene <name>      scene to act on (default: current program scene)
      --source <name>     text source name (default: brb-status, env BRB_SOURCE)
      --url <ws-url>      OBS WebSocket URL (default: ws://127.0.0.1:4455, env OBS_WEBSOCKET_URL)
      --password <pw>     OBS WebSocket password (env OBS_WEBSOCKET_PASSWORD)
      --config <path>     JSON file of flag defaults (default: ./brb.json, then ~/.config/brb/brb.json)
  -v, --version
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
  "stop",
  "help"
]);
async function main() {
  const args = process3.argv.slice(2);
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
      "no-launch": {
        type: "boolean"
      },
      "read-obs-password": {
        type: "boolean"
      },
      "quit-obs": {
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
      },
      version: {
        type: "boolean",
        short: "v"
      }
    }
  });
  const forcedMessage = args.includes("--");
  const [first, ...rest] = positionals;
  const command = !forcedMessage && first && COMMANDS.has(first) ? first : void 0;
  if (values.version) {
    console.log(package_default.version);
    return;
  }
  if (values.help || command === "help") {
    console.log(HELP);
    return;
  }
  const home = process3.env.HOME ?? process3.env.USERPROFILE;
  const config = loadConfig(values.config, process3.cwd().replaceAll("\\", "/"), home?.replaceAll("\\", "/"));
  const backInMs = values.in === void 0 ? void 0 : parseDuration(values.in);
  if (command === "cam" && rest[0] !== "on" && rest[0] !== "off") throw new Error("Usage: brb cam on|off");
  if (values["quit-obs"] && command !== "stop") {
    throw new Error("--quit-obs only works with the stop command: brb stop --quit-obs.");
  }
  const style = styleFromFlags({
    color: values.color ?? config.color,
    bg: values.bg ?? config.bg,
    "bg-opacity": values["bg-opacity"] ?? (config.bgOpacity === void 0 ? void 0 : String(config.bgOpacity))
  });
  const message = command ? void 0 : buildMessage(positionals, backInMs, /* @__PURE__ */ new Date(), config.message);
  const target = {
    source: values.source ?? process3.env.BRB_SOURCE ?? config.source ?? "brb-status",
    scene: values.scene ?? config.scene
  };
  const obsUrl = values.url ?? process3.env.OBS_WEBSOCKET_URL ?? config.url ?? "ws://127.0.0.1:4455";
  const password = values.password ?? process3.env.OBS_WEBSOCKET_PASSWORD ?? (values["read-obs-password"] || config.readObsPassword ? readObsPassword(process3.platform, process3.env, home) : void 0);
  const needsObs = !command || command === "setup" || command === "cam" && rest[0] === "on";
  const obsPath = process3.env.BRB_OBS_PATH ?? config.obsPath;
  const obs = await connectLaunching({
    url: obsUrl,
    password
  }, {
    launch: needsObs && !values["no-launch"] && config.launch !== false,
    start: () => spawnObs(resolveLaunch(process3.platform, process3.env, obsPath)),
    onLaunch: () => console.log("OBS isn't running; starting it...")
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
        result = await cam(obs, rest[0], target);
        break;
      case "status":
        result = await status(obs, target);
        break;
      case "stop": {
        const obsPid = values["quit-obs"] ? await prepareQuit(obs, obsUrl) : void 0;
        result = await stop(obs, target);
        if (obsPid !== void 0) {
          obs.close();
          result += `
${await closeObs(obsPid)}`;
        }
        break;
      }
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
  if (!command && backInMs !== void 0) {
    console.log("Waiting to clear it (Ctrl-C to leave it up; `brb off` clears it any time)...");
    await new Promise((resolve) => setTimeout(resolve, backInMs));
    const later = await ObsClient.connect({
      url: obsUrl,
      password
    });
    try {
      console.log(await hideIfShowing(later, target, message));
    } finally {
      later.close();
    }
  }
}
try {
  await main();
} catch (error) {
  console.error(`brb: ${error.message}`);
  process3.exitCode = 1;
}
