import { ObsRequestError, ResourceNotFound } from "./obs.ts";

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

/** Puts `text` on camera, starting the virtual camera first unless `startCamera` is false. */
export async function show(obs: Obs, target: Target, text: string, startCamera = true): Promise<string> {
  const scene = await sceneOf(obs, target);
  const sceneItemId = await findItem(obs, scene, target.source);
  if (sceneItemId === undefined) throw new Error(SETUP_HINT(target, scene));
  await obs.request("SetInputSettings", { inputName: target.source, inputSettings: { text }, overlay: true });
  await obs.request("SetSceneItemEnabled", { sceneName: scene, sceneItemId, sceneItemEnabled: true });
  let started = false;
  if (startCamera) {
    const { outputActive } = await obs.request<{ outputActive: boolean }>("GetVirtualCamStatus");
    if (!outputActive) {
      await obs.request("StartVirtualCam");
      started = true;
    }
  }
  return `Showing on "${scene}": ${text.replaceAll("\n", " / ")}${started ? " (started virtual camera)" : ""}`;
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
export async function setup(obs: Obs, target: Target): Promise<string> {
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

  let sceneItemId: number;
  let exists = true;
  try {
    await obs.request("GetInputSettings", { inputName: target.source });
  } catch (error) {
    if (!(error instanceof ObsRequestError && error.code === ResourceNotFound)) throw error;
    exists = false;
  }
  if (exists) {
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
  if (state === "on" && !outputActive) await obs.request("StartVirtualCam");
  if (state === "off" && outputActive) await obs.request("StopVirtualCam");
  return `Virtual camera ${state}.`;
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
