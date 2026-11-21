import { readFileSync } from "node:fs";

/**
 * `brb.json`: flag defaults you can commit and share. Flags and env vars always win over it.
 * The OBS password is deliberately not allowed here, since the file is meant to be shared.
 */
export interface Config {
  /** Message shown when you run `brb` with no words. */
  message?: string;
  /** Text color: a name or hex. */
  color?: string;
  /** Background color, or "none". */
  bg?: string;
  /** Background opacity, 0-100. */
  bgOpacity?: number;
  /** Start the virtual camera when showing a message. Defaults to true. */
  cam?: boolean;
  /** Name of the OBS text source. */
  source?: string;
  /** Scene to act on. */
  scene?: string;
  /** OBS WebSocket URL. */
  url?: string;
}

const STRING_KEYS = ["message", "color", "bg", "source", "scene", "url"] as const;
const KEYS = [...STRING_KEYS, "bgOpacity", "cam"];

export function parseConfig(text: string, where: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} isn't valid JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${where} must be a JSON object.`);
  }
  const object = raw as Record<string, unknown>;
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
  return object as Config;
}

/** Where `brb` looks, in order, when `--config` isn't given. */
export function defaultConfigPaths(cwd: string, home: string | undefined): string[] {
  const paths = [`${cwd}/brb.json`];
  if (home) paths.push(`${home}/.config/brb/brb.json`);
  return paths;
}

/** Loads `--config <path>` (which must exist), else the first default path that exists, else `{}`. */
export function loadConfig(explicitPath: string | undefined, cwd: string, home: string | undefined): Config {
  const candidates = explicitPath ? [explicitPath] : defaultConfigPaths(cwd, home);
  for (const path of candidates) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT" && !explicitPath) continue;
      throw new Error(`Can't read config ${path}: ${(error as Error).message}`);
    }
    return parseConfig(text, path);
  }
  return {};
}
