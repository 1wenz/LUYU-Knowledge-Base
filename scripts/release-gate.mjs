import { publicMetadata } from "./public-metadata.mjs";
const metadata = await publicMetadata();
const missing = ["name", "homepage", "repository", "support", "copyright"].filter(
  (key) => !metadata[key],
);
if (missing.length) {
  console.error("正式发布未就绪，缺少真实开发者资料：" + missing.join("、"));
  process.exitCode = 2;
} else console.log("公开开发者资料已配置；签名与完整产品验收仍以验证报告为准。");
