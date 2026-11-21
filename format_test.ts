import { assertEquals, assertThrows } from "@std/assert";
import { buildMessage, DEFAULT_MESSAGE, parseDuration } from "./format.ts";

Deno.test("parseDuration", () => {
  assertEquals(parseDuration("5"), 300_000);
  assertEquals(parseDuration("5m"), 300_000);
  assertEquals(parseDuration("90s"), 90_000);
  assertEquals(parseDuration("1h30m"), 5_400_000);
  assertEquals(parseDuration("0.5"), 30_000);
  assertThrows(() => parseDuration("soon"), Error, "Can't parse duration");
  assertThrows(() => parseDuration(""), Error, "Can't parse duration");
});

Deno.test("buildMessage", () => {
  assertEquals(buildMessage([]), DEFAULT_MESSAGE);
  assertEquals(buildMessage(["grabbing", "coffee"]), "grabbing coffee");
  assertEquals(buildMessage(["one\ntwo"]), "one\ntwo");
  const now = new Date(2026, 10, 20, 14, 30);
  assertEquals(buildMessage(["brb"], 5 * 60_000, now), "brb\nBack at 2:35 PM");
});
