/** Text colors for the on-camera message. Colors are OBS ABGR integers (0xAABBGGRR). */
export interface Style {
  /** Text color. */
  color?: number;
  /** Background box color. */
  bg?: number;
  /** Background box opacity, 0-100. 0 means no background. */
  bgOpacity?: number;
}

/** Opacity used when `--bg <color>` is given without `--bg-opacity`. Matches `brb setup`. */
export const DEFAULT_BG_OPACITY = 70;

const NAMED: Record<string, string> = {
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
  grey: "808080",
};

/** Parses a color name, `#rgb`, or `#rrggbb` (the `#` is optional, since shells treat it as a comment). */
export function parseColor(input: string): number {
  const text = input.trim().toLowerCase();
  let hex = NAMED[text] ?? (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1]);
  if (!hex) {
    throw new Error(
      `Can't parse color "${input}". Use a name (${Object.keys(NAMED).join(", ")}) or hex like "#ff8800" or ff8800.`,
    );
  }
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
}

function parseOpacity(input: string): number {
  const value = Number(input);
  if (input.trim() === "" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`Can't parse opacity "${input}". Use a whole number from 0 to 100.`);
  }
  return value;
}

/** Builds a Style from the CLI flag values. `--bg none` removes the background. */
export function styleFromFlags(flags: { color?: string; bg?: string; "bg-opacity"?: string }): Style {
  const style: Style = {};
  if (flags.color !== undefined) style.color = parseColor(flags.color);
  const opacity = flags["bg-opacity"] === undefined ? undefined : parseOpacity(flags["bg-opacity"]);
  if (flags.bg !== undefined) {
    if (["none", "transparent"].includes(flags.bg.trim().toLowerCase())) {
      style.bgOpacity = 0;
    } else {
      style.bg = parseColor(flags.bg);
      style.bgOpacity = opacity ?? DEFAULT_BG_OPACITY;
    }
  } else if (opacity !== undefined) {
    style.bgOpacity = opacity;
  }
  return style;
}

export function isEmptyStyle(style: Style): boolean {
  return style.color === undefined && style.bg === undefined && style.bgOpacity === undefined;
}

/** Translates a Style into OBS input settings for the given text source kind. */
export function styleSettings(kind: string, style: Style): Record<string, unknown> {
  if (kind.startsWith("text_gdiplus")) {
    const settings: Record<string, unknown> = {};
    if (style.color !== undefined) settings.color = style.color;
    if (style.bg !== undefined) settings.bk_color = style.bg;
    if (style.bgOpacity !== undefined) settings.bk_opacity = style.bgOpacity;
    return settings;
  }
  if (kind === "text_ft2_source_v2") {
    if (style.bg !== undefined || style.bgOpacity !== undefined) {
      throw new Error(
        "This text source (FreeType2) has no background box, so --bg/--bg-opacity can't be used. " +
          "Only --color works with it.",
      );
    }
    return style.color === undefined ? {} : { color1: style.color, color2: style.color };
  }
  if (isEmptyStyle(style)) return {};
  throw new Error(`Don't know how to style a "${kind}" source.`);
}
