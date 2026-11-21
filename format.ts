/** Parses "5", "5m", "90s", "1h30m" into milliseconds. A bare number means minutes. */
export function parseDuration(input: string): number {
  const text = input.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 60_000);
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!text || !match) throw new Error(`Can't parse duration "${input}". Try 5, 5m, 90s, or 1h30m.`);
  const [, h = "0", m = "0", s = "0"] = match;
  return ((+h * 60 + +m) * 60 + +s) * 1000;
}

/** "2:35 PM" in the machine's locale. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export const DEFAULT_MESSAGE = "Be right back";

/** Turns CLI words into the text shown on camera. A literal `\n` becomes a line break. */
export function buildMessage(words: string[], backInMs?: number, now = new Date()): string {
  const base = (words.join(" ").trim() || DEFAULT_MESSAGE).replaceAll("\\n", "\n");
  if (backInMs === undefined) return base;
  return `${base}\nBack at ${formatClock(new Date(now.getTime() + backInMs))}`;
}
