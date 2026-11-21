// Bundles the CLI into dist/brb.js, a single dependency-free file Node 22+ can run.
// `npx github:EthanThatOneKid/brb` serves this committed file, so users never need Deno or a build step.
const bundle = new Deno.Command(Deno.execPath(), {
  args: ["bundle", "--platform=deno", "--format=esm", "--no-check", "--output=dist/brb.js", "main.ts"],
  stderr: "inherit",
}).outputSync();
if (!bundle.success) Deno.exit(1);

const source = Deno.readTextFileSync("dist/brb.js").replace(/^#!.*\n/, "");
Deno.writeTextFileSync("dist/brb.js", `#!/usr/bin/env node\n${source}`);
console.log(`dist/brb.js: ${new TextEncoder().encode(source).length} bytes`);
