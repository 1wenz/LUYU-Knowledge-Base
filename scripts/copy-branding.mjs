import { copyFile, mkdir } from "node:fs/promises";
await mkdir("out/brand", { recursive: true });
for (const [source, target] of [
  ["app.ico", "favicon.ico"],
  ["brush-32.png", "favicon.png"],
  ["opengraph-image.png", "opengraph-image.png"],
  ["app.ico", "brand/app.ico"],
  ["brush-256.png", "brand/brush-256.png"],
])
  await copyFile(".cache/branding/" + source, "out/" + target);
