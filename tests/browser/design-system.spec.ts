import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/design-preview");
  await expect(page.getByRole("heading", { name: "让知识，有迹可循" })).toBeVisible();
});

test("输入样例遵守 IME、换行与发送规则，装饰不拦截操作", async ({ page }) => {
  const question = page.getByRole("textbox", { name: "问题输入样例" });
  await question.fill("中文组合输入");
  await question.dispatchEvent("compositionstart");
  await question.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.getByText("已发送 0 条样例", { exact: true })).toBeVisible();
  await expect(question).toHaveValue("中文组合输入");
  await question.dispatchEvent("compositionend");
  await question.press("Shift+Enter");
  await expect(question).toHaveValue("中文组合输入\n");
  await question.press("Enter");
  await expect(page.getByText("已发送 1 条样例", { exact: true })).toBeVisible();
  await expect(question).toBeEmpty();
  await question.fill("边框不阻挡按钮");
  await page.getByRole("button", { name: "发送样例" }).click();
  await expect(page.getByText("已发送 2 条样例", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "你的问题" }).last()).toContainText(
    "边框不阻挡按钮",
  );
  await expect(page.locator("[data-slot=border-beam]")).toHaveCSS("pointer-events", "none");
});

test("抽屉和弹窗约束焦点并恢复入口，快捷键可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const navigation = page.getByRole("button", { name: "打开导航" });
  await navigation.click();
  await expect(page.getByRole("dialog", { name: "工作区导航" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("searchbox", { name: "搜索输入样例" })).toBeFocused();
  await page.getByRole("button", { name: "外观样例" }).click();
  await expect(page.getByRole("dialog", { name: "外观与动态效果样例" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "外观样例" })).toBeFocused();
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("dialog", { name: "外观与动态效果样例" })).toBeVisible();
});

test("深色、应用和系统减少动态效果保留可见焦点", async ({ page }) => {
  await page.getByRole("button", { name: "外观样例" }).click();
  await page.getByLabel("主题样例", { exact: true }).selectOption("dark");
  await page.getByLabel("减少动态效果样例", { exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("textbox", { name: "问题输入样例" }).focus();
  await expect(page.locator("[data-slot=border-beam]")).toHaveCSS("animation-name", "none");
  await expect(page.locator("[data-slot=input-message]")).toHaveCSS("outline-style", "solid");
  await page.getByRole("button", { name: "外观样例" }).click();
  await page.getByLabel("减少动态效果样例", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("textbox", { name: "问题输入样例" }).focus();
  await expect(page.locator("[data-slot=border-beam]")).toHaveCSS("animation-name", "none");
});

for (const [width, height] of [
  [1380, 900],
  [960, 640],
  [390, 844],
]) {
  test(`${width}×${height} 展示布局没有水平溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.getByRole("textbox", { name: "问题输入样例" }).fill("长文本".repeat(150));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "发送样例" })).toBeInViewport();
  });
}

test("200% CSS 缩放仍可访问正文与操作", async ({ page }) => {
  await page.setViewportSize({ width: 1380, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("textbox", { name: "问题输入样例" }).fill("缩放输入");
  await page.getByRole("button", { name: "发送样例" }).click();
  await expect(page.getByText("已发送 1 条样例", { exact: true })).toBeVisible();
});

test("字体与品牌均从本地加载，工作区不被索引", async ({ page }) => {
  await expect(page.locator("body")).not.toContainText(/\?{2,}/);
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
  );
  expect(fonts).toContain("Geist");
  expect(fonts).toContain("LXGW WenKai Screen");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
  const remoteResources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => new URL(url).origin !== location.origin),
  );
  expect(remoteResources).toEqual([]);
});
