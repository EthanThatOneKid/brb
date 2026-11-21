import { assertEquals, assertRejects } from "@std/assert";
import { cam, hide, setup, show, status } from "./commands.ts";
import { computeAuth, ObsClient } from "./obs.ts";
import { FakeObs } from "./fake_obs.ts";

const target = { source: "brb-status" };

Deno.test("computeAuth matches the protocol's two-step SHA256/base64", async () => {
  // Independently computed with: openssl, per the obs-websocket v5 spec.
  assertEquals(
    await computeAuth(
      "supersecretpassword",
      "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
      "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=",
    ),
    "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=",
  );
});

Deno.test("end to end against a fake OBS with authentication", async () => {
  await using obs = await FakeObs.start({ password: "hunter2", scenes: ["Main"], current: "Main" });
  await assertRejects(() => ObsClient.connect({ url: obs.url }), Error, "requires a password");
  await assertRejects(() => ObsClient.connect({ url: obs.url, password: "wrong" }), Error, "Authentication failed");

  const client = await ObsClient.connect({ url: obs.url, password: "hunter2" });
  try {
    await assertRejects(() => show(client, target, "hi"), Error, "brb setup");
    assertEquals((await setup(client, target)).includes("Added"), true);
    assertEquals((await setup(client, target)).includes("already"), true);
    assertEquals(obs.state.items.length, 1);
    assertEquals(obs.state.items[0].enabled, false);
    assertEquals(obs.state.items[0].transform, { positionX: 960, positionY: 918, alignment: 0 });

    await show(client, target, "grabbing coffee\nBack at 2:35 PM", { startCamera: true });
    assertEquals(obs.state.inputs["brb-status"].text, "grabbing coffee\nBack at 2:35 PM");
    assertEquals(obs.state.items[0].enabled, true);
    assertEquals(obs.state.virtualCam, true);
    assertEquals((await status(client, target)).includes("grabbing coffee / Back at 2:35 PM"), true);

    await hide(client, target);
    assertEquals(obs.state.items[0].enabled, false);
    assertEquals((await status(client, target)).includes("message hidden"), true);

    await cam(client, "off");
    assertEquals(obs.state.virtualCam, false);
  } finally {
    client.close();
  }
});
