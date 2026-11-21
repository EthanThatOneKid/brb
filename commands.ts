import { ObsRequestError, ResourceNotFound } from "./obs.ts";
import { isEmptyStyle, type Style, styleSettings } from "./style.ts";

/** The slice of ObsClient the commands use (lets tests pass a fake). */
export interface Obs {
  request<T = Record<string, unknown>>(type: string, data?: Record<string, unknown>): Promise<T>;
}

export interface Target {
  /** Name of the OBS text input that carries the message. */
  source: string;
  /** Scene to act on; defaults to the current program scene. */
  scene?: string;
}

/** Text source kinds, best first. GDI+ is Windows-only; FreeType2 is the cross-platform one. */
const TEXT_KINDS = ["text_gdiplus_v3", "text_gdiplus_v2", "text_ft2_source_v2"];

const SETUP_HINT = (target: Target, scene: string) =>
  `Source "${target.source}" isn't in scene "${scene}". Run \`brb setup\` (once per scene) to add it.`;

async function sceneOf(obs: Obs, target: Target): Promise<string> {
  if (target.scene) return target.scene;
  const { currentProgramSceneName } = await obs.request<{ currentProgramSceneName: string }>("GetCurrentProgramScene");
  return currentProgramSceneName;
}

/** Item id of the source in the scene, or undefined when it isn't there. */
async function findItem(obs: Obs, scene: string, source: string): Promise<number | undefined> {
  try {
    const { sceneItemId } = await obs.request<{ sceneItemId: number }>("GetSceneItemId", {
      sceneName: scene,
      sourceName: source,
    });
    return sceneItemId;
  } catch (error) {
    if (error instanceof ObsRequestError && error.code === ResourceNotFound) return undefined;
    throw error;
  }
}

export interface ShowOptions {
  /** Start the virtual camera if it is off. Defaults to true. */
  startCamera?: boolean;
  /** Text/background colors. They stick in OBS until changed again. */
  style?: Style;
}

/** Camera capture source kinds (Windows, macOS, macOS, Linux). Only DirectShow has the `active` toggle we use. */
const CAMERA_KINDS = ["dshow_input", "av_capture_input", "av_capture_input_v2", "v4l2_input"];

/**
 * Activates or deactivates (releases) every webcam source, which is what turns the camera light off or on.
 * Only writes when the state actually differs, since re-applying settings can make the device blink.
 * Returns how many sources changed.
 */
async function setCameras(obs: Obs, active: boolean): Promise<number> {
  const { inputs } = await obs.request<{ inputs: { inputName: string; inputKind: string }[] }>("GetInputList");
  let changed = 0;
  for (const { inputName, inputKind } of inputs) {
    if (!CAMERA_KINDS.includes(inputKind)) continue;
    const { inputSettings } = await obs.request<{ inputSettings: { active?: boolean } }>("GetInputSettings", {
      inputName,
    });
    if ((inputSettings.active ?? true) === active) continue;
    await obs.request("SetInputSettings", { inputName, inputSettings: { active }, overlay: true });
    changed++;
  }
  return changed;
}

/** Puts `text` on camera, starting the virtual camera first unless `options.startCamera` is false. */
export async function show(obs: Obs, target: Target, text: string, options: ShowOptions = {}): Promise<string> {
  const { startCamera = true, style = {} } = options;
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId === undefined) throw new Error(SETUP_HINT(target, scene));
  let inputSettings: Record<string, unknown> = { text };
  if (!isEmptyStyle(style)) {
    const { inputKind } = await obs.request<{ inputKind: string }>("GetInputSettings", { inputName: target.source });
    inputSettings = { text, ...styleSettings(inputKind, style) };
  }
  await obs.request("SetInputSettings", { inputName: target.source, inputSettings, overlay: true });
  await obs.request("SetSceneItemEnabled", { sceneName: scene, sceneItemId, sceneItemEnabled: true });
  let started = false;
  let woke = 0;
  if (startCamera) {
    woke = await setCameras(obs, true);
    const { outputActive } = await obs.request<{ outputActive: boolean }>("GetVirtualCamStatus");
    if (!outputActive) {
      await obs.request("StartVirtualCam");
      started = true;
    }
  }
  return `Showing on "${scene}": ${text.replaceAll("\n", " / ")}${started ? " (started virtual camera)" : ""}${
    woke ? " (reactivated camera)" : ""
  }`;
}

/** Takes the message off camera. */
export async function hide(obs: Obs, target: Target): Promise<string> {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId === undefined) throw new Error(SETUP_HINT(target, scene));
  await obs.request("SetSceneItemEnabled", { sceneName: scene, sceneItemId, sceneItemEnabled: false });
  return `Cleared "${scene}".`;
}

/** Creates the text source (if needed) and adds it, hidden and centered low, to the scene. */
export async function setup(obs: Obs, target: Target, style: Style = {}): Promise<string> {
  const scene = await sceneOf(obs, target);
  if (await findItem(obs, scene, target.source) !== undefined) {
    return `"${target.source}" is already in scene "${scene}". Nothing to do.`;
  }

  const { inputKinds } = await obs.request<{ inputKinds: string[] }>("GetInputKindList", { unversioned: false });
  const kind = TEXT_KINDS.find((candidate) => inputKinds.includes(candidate));
  if (!kind) throw new Error(`This OBS has no text source kind (looked for ${TEXT_KINDS.join(", ")}).`);

  const settings = kind.startsWith("text_gdiplus")
    ? {
      text: "Be right back",
      font: { face: "Segoe UI", style: "Bold", size: 64, flags: 1 },
      color: 0xFFFFFFFF,
      align: "center",
      bk_color: 0xFF000000,
      bk_opacity: 70,
    }
    : { text: "Be right back", font: { face: "Sans Serif", style: "Bold", size: 64, flags: 1 } };
  Object.assign(settings, styleSettings(kind, style));

  let sceneItemId: number;
  let exists = true;
  try {
    await obs.request("GetInputSettings", { inputName: target.source });
  } catch (error) {
    if (!(error instanceof ObsRequestError && error.code === ResourceNotFound)) throw error;
    exists = false;
  }
  if (exists) {
    if (!isEmptyStyle(style)) {
      await obs.request("SetInputSettings", {
        inputName: target.source,
        inputSettings: styleSettings(kind, style),
        overlay: true,
      });
    }
    ({ sceneItemId } = await obs.request<{ sceneItemId: number }>("CreateSceneItem", {
      sceneName: scene,
      sourceName: target.source,
      sceneItemEnabled: false,
    }));
  } else {
    ({ sceneItemId } = await obs.request<{ sceneItemId: number }>("CreateInput", {
      sceneName: scene,
      inputName: target.source,
      inputKind: kind,
      inputSettings: settings,
      sceneItemEnabled: false,
    }));
  }

  const { baseWidth, baseHeight } = await obs.request<{ baseWidth: number; baseHeight: number }>("GetVideoSettings");
  await obs.request("SetSceneItemTransform", {
    sceneName: scene,
    sceneItemId,
    sceneItemTransform: { positionX: baseWidth / 2, positionY: baseHeight * 0.85, alignment: 0 },
  });
  return `Added "${target.source}" (${kind}) to scene "${scene}", hidden. Try: brb "back in 5"`;
}

/** Starts or stops the OBS virtual camera. */
export async function cam(obs: Obs, state: "on" | "off"): Promise<string> {
  const { outputActive } = await obs.request<{ outputActive: boolean }>("GetVirtualCamStatus");
  if (state === "on") await setCameras(obs, true);
  if (state === "on" && !outputActive) await obs.request("StartVirtualCam");
  if (state === "off" && outputActive) await obs.request("StopVirtualCam");
  return `Virtual camera ${state}.`;
}

/** Hides the message, stops the virtual camera, and releases the webcam so its light goes off. */
export async function stop(obs: Obs, target: Target): Promise<string> {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId !== undefined) {
    await obs.request("SetSceneItemEnabled", { sceneName: scene, sceneItemId, sceneItemEnabled: false });
  }
  const { outputActive } = await obs.request<{ outputActive: boolean }>("GetVirtualCamStatus");
  if (outputActive) await obs.request("StopVirtualCam");
  const released = await setCameras(obs, false);
  return `Stopped: message hidden, virtual camera off, ${released} camera source${released === 1 ? "" : "s"} released.`;
}

/** One-line summary of what viewers see right now. */
export async function status(obs: Obs, target: Target): Promise<string> {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  const { outputActive } = await obs.request<{ outputActive: boolean }>("GetVirtualCamStatus");
  const camera = `virtual camera ${outputActive ? "on" : "off"}`;
  if (sceneItemId === undefined) {
    return `Scene "${scene}": no "${target.source}" source (run \`brb setup\`); ${camera}.`;
  }
  const { sceneItemEnabled } = await obs.request<{ sceneItemEnabled: boolean }>("GetSceneItemEnabled", {
    sceneName: scene,
    sceneItemId,
  });
  if (!sceneItemEnabled) return `Scene "${scene}": message hidden; ${camera}.`;
  const { inputSettings } = await obs.request<{ inputSettings: { text?: string } }>("GetInputSettings", {
    inputName: target.source,
  });
  return `Scene "${scene}": showing "${(inputSettings.text ?? "").replaceAll("\n", " / ")}"; ${camera}.`;
}
