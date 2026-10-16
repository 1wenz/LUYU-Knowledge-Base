import { readFile } from "node:fs/promises";

export async function publicMetadata() {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const text = (key, fallback = null) => {
    const value = process.env[key]?.trim() || fallback;
    if (
      value &&
      (typeof value !== "string" ||
        value.length > (key === "ZHIYU_DEVELOPER_NAME" ? 120 : 200) ||
        /[\u0000-\u001f]/.test(value))
    )
      throw new Error("公开开发者信息格式不正确：" + key);
    return value || null;
  };
  const url = (key, fallback) => {
    const value = text(key, fallback);
    if (!value) return null;
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error("公开地址必须为无凭据 HTTPS：" + key);
    return parsed.href;
  };
  return {
    name: text("ZHIYU_DEVELOPER_NAME", pkg.author && pkg.author !== "未配置" ? pkg.author : null),
    homepage: url("ZHIYU_HOMEPAGE", pkg.homepage),
    repository: url("ZHIYU_REPOSITORY_URL"),
    support: text("ZHIYU_SUPPORT"),
    license: pkg.license,
    copyright: text("ZHIYU_COPYRIGHT"),
  };
}
