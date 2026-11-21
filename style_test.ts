import { assertEquals, assertThrows } from "@std/assert";
import { parseColor, styleFromFlags, styleSettings } from "./style.ts";

Deno.test("parseColor: names and hex, as OBS ABGR", () => {
  assertEquals(parseColor("white"), 0xFFFFFFFF);
  assertEquals(parseColor("Red"), 0xFF0000FF); // R is the low byte
  assertEquals(parseColor("#00ff00"), 0xFF00FF00);
  assertEquals(parseColor("0000ff"), 0xFFFF0000); // B is the high color byte; "#" is optional
  assertEquals(parseColor("#fa0"), 0xFF00AAFF); // shorthand expands to ffaa00
  assertThrows(() => parseColor("reddish"), Error, "Can't parse color");
  assertThrows(() => parseColor("#12345"), Error, "Can't parse color");
});

Deno.test("styleFromFlags", () => {
  assertEquals(styleFromFlags({}), {});
  assertEquals(styleFromFlags({ color: "black", bg: "yellow" }), { color: 0xFF000000, bg: 0xFF00FFFF, bgOpacity: 70 });
  assertEquals(styleFromFlags({ bg: "red", "bg-opacity": "100" }), { bg: 0xFF0000FF, bgOpacity: 100 });
  assertEquals(styleFromFlags({ bg: "none" }), { bgOpacity: 0 });
  assertEquals(styleFromFlags({ "bg-opacity": "40" }), { bgOpacity: 40 });
  assertThrows(() => styleFromFlags({ "bg-opacity": "101" }), Error, "0 to 100");
  assertThrows(() => styleFromFlags({ "bg-opacity": "half" }), Error, "0 to 100");
});

Deno.test("styleSettings per source kind", () => {
  const style = { color: 1, bg: 2, bgOpacity: 3 };
  assertEquals(styleSettings("text_gdiplus_v3", style), { color: 1, bk_color: 2, bk_opacity: 3 });
  assertEquals(styleSettings("text_ft2_source_v2", { color: 1 }), { color1: 1, color2: 1 });
  assertEquals(styleSettings("text_ft2_source_v2", {}), {});
  assertThrows(() => styleSettings("text_ft2_source_v2", { bg: 2 }), Error, "no background");
  assertThrows(() => styleSettings("image_source", { color: 1 }), Error, "Don't know how to style");
});
