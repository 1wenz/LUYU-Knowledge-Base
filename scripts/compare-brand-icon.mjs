import sharp from "sharp";

export async function compareBrandIcon(actualFile) {
  const actualImage = sharp(actualFile);
  const { width, height } = await actualImage.metadata();
  const actual = await actualImage.ensureAlpha().raw().toBuffer();
  const expected = await sharp(".cache/branding/brush-256.png")
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer();
  let intersection = 0,
    union = 0;
  const ink = (bytes, index) =>
    bytes[index + 3] > 100 &&
    bytes[index] < 140 &&
    bytes[index + 1] < 140 &&
    bytes[index + 2] < 140;
  for (let index = 0; index < expected.length; index += 4) {
    const a = ink(actual, index),
      b = ink(expected, index);
    if (a || b) union++;
    if (a && b) intersection++;
  }
  const overlap = union ? intersection / union : 0;
  if (overlap < 0.8)
    throw new Error("Windows 原生图标与毛笔源不一致，轮廓交并比 " + overlap.toFixed(3));
  return { width, height, overlap };
}
