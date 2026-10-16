import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const directory = ".cache/branding";
await mkdir(directory, { recursive: true });
const source = await readFile("public/brand/brush.svg", "utf8");
const drawing = source
  .replace(/<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replaceAll("currentColor", "#202925");
const icon = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#F7F7F2"/><g transform="translate(8 8) scale(.75)">${drawing}</g></svg>`,
);
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const size of sizes) {
  const png = await sharp(icon, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(`${directory}/brush-${size}.png`, png);
  images.push(png);
}
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
await writeFile(`${directory}/app.ico`, Buffer.concat([header, ...images]));
await sharp({ create: { width: 1200, height: 630, channels: 4, background: "#F7F7F2" } })
  .composite([{ input: images.at(-1), gravity: "centre" }])
  .png()
  .toFile(`${directory}/opengraph-image.png`);
await writeFile(
  `${directory}/manifest.json`,
  JSON.stringify(
    {
      source: "public/brand/brush.svg",
      sha256: createHash("sha256").update(source).digest("hex"),
      sizes,
    },
    null,
    2,
  ) + "\n",
);
console.log("已从毛笔 SVG 生成 Windows 多尺寸 ICO、favicon 与 OG 位图。");
