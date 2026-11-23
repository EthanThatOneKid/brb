import { assertEquals, assertThrows } from "@std/assert";
import { defaultConfigPaths, parseConfig } from "./config.ts";

Deno.test("parseConfig accepts every documented key", () => {
  const config = {
    message: "Be right back",
    color: "white",
    bg: "none",
    bgOpacity: 70,
    cam: true,
    source: "brb-status",
    scene: "Camera",
    url: "ws://127.0.0.1:4455",
    launch: false,
    obsPath: "C:\Apps\obs64.exe",
    readObsPassword: true,
  };
  assertEquals(parseConfig(JSON.stringify(config), "brb.json"), config);
  assertEquals(parseConfig("{}", "brb.json"), {});
});

Deno.test("parseConfig rejects bad input with the file name in the message", () => {
  assertThrows(() => parseConfig("{nope", "x.json"), Error, "x.json isn't valid JSON");
  assertThrows(() => parseConfig("[]", "x.json"), Error, "must be a JSON object");
  assertThrows(() => parseConfig('{"colour":"red"}', "x.json"), Error, 'unknown key "colour"');
  assertThrows(() => parseConfig('{"password":"x"}', "x.json"), Error, "OBS_WEBSOCKET_PASSWORD");
  assertThrows(() => parseConfig('{"color":1}', "x.json"), Error, '"color" must be a string');
  assertThrows(() => parseConfig('{"cam":"yes"}', "x.json"), Error, '"cam" must be true or false');
  assertThrows(() => parseConfig('{"launch":"yes"}', "x.json"), Error, '"launch" must be true or false');
  assertThrows(() => parseConfig('{"readObsPassword":1}', "x.json"), Error, '"readObsPassword" must be true or false');
  assertThrows(() => parseConfig('{"obsPath":true}', "x.json"), Error, '"obsPath" must be a string');
  assertThrows(() => parseConfig('{"bgOpacity":"70"}', "x.json"), Error, '"bgOpacity" must be a number');
});

Deno.test("defaultConfigPaths looks in the working directory first", () => {
  assertEquals(defaultConfigPaths("/work", "/home/me"), ["/work/brb.json", "/home/me/.config/brb/brb.json"]);
  assertEquals(defaultConfigPaths("/work", undefined), ["/work/brb.json"]);
});
