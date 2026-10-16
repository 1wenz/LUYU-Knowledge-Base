import { expect, test } from "@playwright/test";
import { installClient } from "./client-fixture";

test("流式回答先展示来源，过滤旧事件、重复序号和伪造引用", async ({ page }) => {
  await installClient(page, { assistantReady: true, noiseEvents: true });
  await page.goto("/");
  await page.getByRole("button", { name: "知识助手", exact: true }).click();
  await page.getByLabel("问题", { exact: true }).fill("山湖");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "来源 1：助手资料，第 1–1 行", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  const answer = page.getByRole("article", { name: "助手回复", exact: true });
  await expect(answer).toContainText("这是浏览器演示回复");
  await expect(answer).not.toContainText("污染");
  await expect(page.getByText("伪造来源", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "来源 1：助手资料，第 1–1 行", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "来源原文", exact: true })).toBeVisible();
  await expect(page.locator('[data-source-line="1"]')).toContainText("山湖资料的原始来源");
  await page.keyboard.press("Escape");
  await page.getByLabel("问题", { exact: true }).fill("不存在的关键词");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(page.getByRole("article", { name: "助手回复", exact: true })).toContainText(
    "没有找到可以引用的资料",
  );
  await expect(page.getByRole("button", { name: /^来源 \d+：/ })).toHaveCount(0);
});

test("助手遵守 IME 与换行，双次发送只启动一次，停止后可重发", async ({ page }) => {
  await installClient(page, { assistantReady: true });
  await page.goto("/");
  await page.getByRole("button", { name: "知识助手", exact: true }).click();
  const input = page.getByLabel("问题", { exact: true });
  await input.fill("山湖");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await page.evaluate(() => Reflect.get(window, "fixtureStats").starts)).toBe(0);
  await input.dispatchEvent("compositionend");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("山湖\n");
  await input.fill("山湖");
  await input.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "fixtureStats").starts)).toBe(1);
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.getByText("已停止生成", { exact: true })).toBeVisible();
  await input.fill("山湖");
  await input.press("Enter");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "fixtureStats").starts)).toBe(2);
});

test("助手启动失败能重试，切换视图取消任务并移除订阅", async ({ page }) => {
  await installClient(page, { assistantReady: true, failStartOnce: true });
  await page.goto("/");
  await page.getByRole("button", { name: "知识助手", exact: true }).click();
  await page.getByLabel("问题", { exact: true }).fill("山湖");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "模拟服务暂时不可用" })).toBeVisible();
  await page.getByRole("button", { name: "重试回答", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "fixtureStats").listeners))
    .toBe(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "fixtureStats").cancellations),
  ).toBeGreaterThan(0);
});

test("未配置模型时给出设置入口，空问题不会发送", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "知识助手", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送问题", exact: true })).toBeDisabled();
  await page.getByLabel("问题", { exact: true }).fill("山湖");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "聊天模型" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "前往模型与 API 设置", exact: true }),
  ).toBeVisible();
});
