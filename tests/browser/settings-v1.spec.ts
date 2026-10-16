import { expect, test } from "@playwright/test";
import { installClient } from "./client-fixture";

test("设置复用范围和跨字段约束，更新按组提交并检测 revision 冲突", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("tab", { name: "向量索引", exact: true }).click();
  await page.getByLabel("片段长度（tokens）", { exact: true }).fill("200");
  await page.getByLabel("重叠长度（tokens）", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存向量索引设置", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "小于片段长度的一半" })).toBeVisible();
  await page.getByLabel("重叠长度（tokens）", { exact: true }).fill("50");
  await page.getByRole("button", { name: "保存向量索引设置", exact: true }).click();
  await expect(page.getByText("向量索引设置已保存。", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("zhiyu:demo:v1")!).settings.indexing),
  ).toEqual({ chunkTokens: 200, overlapTokens: 50 });
  await page.getByRole("tab", { name: "生成", exact: true }).click();
  await page.getByLabel("温度", { exact: true }).fill("0.8");
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("zhiyu:demo:v1")!);
    state.settings.revision++;
    state.settings.retrieval.resultCount = 9;
    localStorage.setItem("zhiyu:demo:v1", JSON.stringify(state));
  });
  await page.getByRole("button", { name: "保存生成设置", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "其他窗口" })).toBeVisible();
  await expect(page.getByLabel("温度", { exact: true })).toHaveValue("0.8");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("zhiyu:demo:v1")!).settings.generation.temperature,
    ),
  ).toBe(0.2);
  await page.getByRole("button", { name: "重新加载设置", exact: true }).click();
  await expect(page.getByLabel("温度", { exact: true })).toHaveValue("0.2");
  await page.getByLabel("温度", { exact: true }).fill("0.8");
  await page.getByRole("button", { name: "保存生成设置", exact: true }).click();
  await expect(page.getByText("生成设置已保存。", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("zhiyu:demo:v1")!).settings.retrieval.resultCount,
    ),
  ).toBe(9);
});

test("密钥提交后清空，关闭清空，状态只显示会话标记且不持久化密钥", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("tab", { name: "模型与 API", exact: true }).click();
  const key = page.getByLabel("新 OpenRouter API key", { exact: true });
  await key.fill("synthetic-ui-secret");
  await page.getByRole("button", { name: "保存 OpenRouter API key", exact: true }).click();
  await expect(key).toHaveValue("");
  await expect(
    page.getByText("OpenRouter API key：已配置（当前会话）", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.values(localStorage).join(" "))).not.toContain(
    "synthetic-ui-secret",
  );
  await key.fill("unsaved-ui-value");
  await page.getByRole("tab", { name: "关于", exact: true }).click();
  await page.getByRole("tab", { name: "模型与 API", exact: true }).click();
  await expect(key).toHaveValue("");
  await page.getByRole("button", { name: "删除 OpenRouter API key", exact: true }).click();
  await expect(page.getByText("OpenRouter API key：未配置", { exact: true })).toBeVisible();
});

test("保存维度只提示重建，明确开始后有进度且可取消", async ({ page }) => {
  await installClient(page, { assistantReady: true });
  await page.goto("/");
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("tab", { name: "模型与 API", exact: true }).click();
  await page.getByRole("combobox", { name: "Embedding 维度", exact: true }).selectOption("1536");
  await page.getByRole("button", { name: "保存模型与 API设置", exact: true }).click();
  await expect(page.getByText("需要重建索引", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "fixtureStats").rebuilds)).toBe(0);
  await page.getByRole("tab", { name: "向量索引", exact: true }).click();
  await page.getByRole("button", { name: "重建索引", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "确认重建索引", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始重建", exact: true }).click();
  await expect(page.getByText("已处理 0 / 1 篇，失败 0 篇", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消重建", exact: true }).click();
  await expect(page.getByText("重建已取消，当前可用索引已保留。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "fixtureStats").rebuilds)).toBe(1);
});

test("外观应用和关于元数据来自客户端，模型列表和连接探测需点击", async ({ page }) => {
  await installClient(page);
  await page.goto("/");
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "fixtureStats").modelLists)).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, "fixtureStats").probes)).toBe(0);
  await page.getByRole("tab", { name: "模型与 API", exact: true }).click();
  await page.getByRole("button", { name: "刷新模型列表并验证", exact: true }).click();
  await page.getByLabel("聊天模型 ID", { exact: true }).fill("demo/preview");
  await page.getByRole("button", { name: "保存模型与 API设置", exact: true }).click();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  await page.getByRole("combobox", { name: "主题", exact: true }).selectOption("dark");
  await page.getByLabel("减少动态效果", { exact: true }).check();
  await page.getByRole("button", { name: "保存外观设置", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
  await page.getByRole("tab", { name: "关于", exact: true }).click();
  await expect(page.getByText("0.1.0-demo", { exact: true })).toBeVisible();
  await expect(page.getByText("开发者：未配置", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fluid Functionalism · MIT 许可", exact: true }),
  ).toBeVisible();
});
