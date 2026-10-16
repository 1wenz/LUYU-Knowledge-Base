import { expect, test, type Page } from "@playwright/test";
import { installClient } from "./client-fixture";

async function createNote(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill(title);
  await page.getByLabel("Markdown 正文", { exact: true }).fill(content);
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}

test("浏览器必须明确选择演示，空库不自动插入示例", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "打开你的知识工作区" })).toBeVisible();
  await page.getByRole("link", { name: "进入浏览器演示" }).click();
  await expect(page.getByText("浏览器演示", { exact: true })).toBeVisible();
  await expect(page.getByText("0 篇笔记", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "你的知识，从这里开始" })).toBeVisible();
});

test("契约客户端支持保存、收藏、删除与恢复，刷新保留数据", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "新建笔记", exact: true }).first().click();
  await page.getByLabel("标题", { exact: true }).fill("本地优先研究");
  await page
    .getByLabel("Markdown 正文", { exact: true })
    .fill("# 本地优先\n\n资料由自己管理。\n山湖 mountain-lake");
  await page.getByLabel("标签", { exact: true }).fill("研究，离线");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("heading", { name: "本地优先研究", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开笔记：本地优先研究", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收藏笔记", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /打开笔记：本地优先研究/ }).click();
  await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移到回收站", exact: true }).click();
  await page
    .getByRole("dialog", { name: "移到回收站" })
    .getByRole("button", { name: "确认移入" })
    .click();
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await page.getByRole("button", { name: /打开笔记：本地优先研究/ }).click();
  await page.getByRole("button", { name: "恢复笔记", exact: true }).click();
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await expect(page.getByText("1 篇笔记", { exact: true })).toBeVisible();
});

test("缺失的桌面 bridge 显示错误，不能静默切成演示", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "desktop", {
      value: { getInfo: async () => ({ name: "prototype", version: "0", platform: "win32" }) },
    });
  });
  await page.goto("/?demo=1");
  await expect(page.getByRole("alert").filter({ hasText: "桌面接口" })).toBeVisible();
  await expect(page.getByText("浏览器演示", { exact: true })).toHaveCount(0);
});

test("来源按片段计数、定位原文行并返回原查询", async ({ page }) => {
  await page.goto("/?demo=1");
  await createNote(
    page,
    "长文资料",
    Array.from({ length: 24 }, (_, index) =>
      index === 22 ? "山湖 mountain-lake" : `原文第 ${index + 1} 行`,
    ).join("\n"),
  );
  await page.keyboard.press("Control+k");
  await expect(page.getByLabel("检索知识库", { exact: true })).toBeFocused();
  await page.getByLabel("检索知识库", { exact: true }).fill("mountain-lake");
  await expect(page.getByText("1 个来源片段 · 关键词检索", { exact: true })).toBeVisible();
  await expect(
    page.getByText("浏览器演示使用本地关键词检索，未调用云端向量模型。", { exact: true }),
  ).toBeVisible();
  const source = page.getByRole("button", { name: "打开来源：长文资料，第 21–24 行" });
  await source.click();
  await expect(page.getByRole("dialog", { name: "来源原文" })).toBeVisible();
  await expect(page.locator('[data-source-line="23"]')).toHaveAttribute("data-highlighted", "true");
  await page.getByRole("button", { name: "返回来源列表", exact: true }).click();
  await expect(source).toBeFocused();
  await expect(page.getByLabel("检索知识库", { exact: true })).toHaveValue("mountain-lake");
  await page.getByLabel("检索知识库", { exact: true }).fill("不存在的来源");
  await expect(page.getByRole("heading", { name: "没有匹配的来源片段" })).toBeVisible();
});

test("并发修改提示冲突，保存失败保留草稿", async ({ page }) => {
  await page.goto("/?demo=1");
  await createNote(page, "原始标题", "原文");
  await page.getByRole("button", { name: "编辑笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("当前草稿");
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("zhiyu:demo:v1")!);
    state.documents[0].revision++;
    state.documents[0].title = "其他窗口的新标题";
    localStorage.setItem("zhiyu:demo:v1", JSON.stringify(state));
  });
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "其他窗口" })).toBeVisible();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("当前草稿");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("zhiyu:demo:v1")!).documents[0].title,
    ),
  ).toBe("其他窗口的新标题");
  await page.getByRole("button", { name: "读取最新版本并保留草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存笔记", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("heading", { name: "当前草稿", exact: true })).toBeVisible();
});

test("文件导入可审核，重复导入不创建副本", async ({ page }) => {
  await page.goto("/?demo=1");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "导入资料", exact: true }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "选择文本文件", exact: true }).click();
    await (
      await chooserPromise
    ).setFiles({
      name: "导入研究.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 安全导入\n山湖资料", "utf8"),
    });
    await expect(page.getByText("待导入 1 篇笔记", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(
      page.getByText(
        attempt ? "导入 0 篇，跳过 1 篇重复笔记。" : "导入 1 篇，跳过 0 篇重复笔记。",
        { exact: true },
      ),
    ).toBeVisible();
  }
  await expect(page.getByText("1 篇笔记", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开笔记：导入研究", exact: true }).click();
  await expect(page.getByText("山湖资料", { exact: true })).toBeVisible();
});

test("安全 Markdown 保留原始 HTML 为文字且不发起图片请求", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://tracking.invalid/")) remoteRequests.push(request.url());
  });
  await page.goto("/?demo=1");
  await createNote(
    page,
    "安全预览",
    "<script>window.PWNED = true</script>\n![追踪图](https://tracking.invalid/pixel)\n[危险链接](javascript:alert(1))\n**加粗文字**",
  );
  const detail = page.getByRole("region", { name: "笔记详情", exact: true });
  await expect(
    detail.getByText("<script>window.PWNED = true</script>", { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText("[图片：追踪图，未自动加载]", { exact: true })).toBeVisible();
  await expect(detail.getByText("危险链接（链接不可用）", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "PWNED"))).toBeUndefined();
  expect(remoteRequests).toEqual([]);
});

test("演示存储损坏时阻止打开，保留损坏内容", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("zhiyu:demo:v1", "{broken"));
  await page.goto("/?demo=1");
  await expect(page.getByRole("alert").filter({ hasText: "演示存储无法读取" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("zhiyu:demo:v1"))).toBe("{broken");
});

test("来源版本变化时不继续高亮旧行号", async ({ page }) => {
  await page.goto("/?demo=1");
  await createNote(page, "版本资料", "version-source");
  await page.keyboard.press("Control+k");
  await page.getByLabel("检索知识库", { exact: true }).fill("version-source");
  const source = page.getByRole("button", { name: "打开来源：版本资料，第 1–1 行", exact: true });
  await expect(source).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("zhiyu:demo:v1")!);
    state.documents[0].revision++;
    state.documents[0].contentMarkdown = "已改写的原文";
    localStorage.setItem("zhiyu:demo:v1", JSON.stringify(state));
  });
  await source.click();
  await expect(page.getByRole("alert").filter({ hasText: "版本已变化" })).toBeVisible();
  await expect(page.locator('[data-highlighted="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "查看最新原文（不沿用旧行号）", exact: true }).click();
  await expect(page.getByText("已改写的原文", { exact: true })).toBeVisible();
  await expect(page.locator('[data-highlighted="true"]')).toHaveCount(0);
});

test("迟到的旧查询不覆盖新结果，取消后不接纳返回值", async ({ page }) => {
  await installClient(page, { slowQuery: "slow" });
  await page.goto("/");
  await createNote(page, "慢结果", "slow");
  await createNote(page, "新结果", "fast");
  await page.keyboard.press("Control+k");
  await page.getByLabel("检索知识库", { exact: true }).fill("slow");
  await expect(page.getByText("正在检索来源…", { exact: true })).toBeVisible();
  await page.getByLabel("检索知识库", { exact: true }).fill("fast");
  await expect(
    page.getByRole("button", { name: "打开来源：新结果，第 1–1 行", exact: true }),
  ).toBeVisible();
  // Wait for the deliberately non-cancellable response from the adapter.
  await page.waitForTimeout(1700);
  await expect(page.getByRole("button", { name: /打开来源：慢结果/ })).toHaveCount(0);
  await page.getByLabel("检索知识库", { exact: true }).fill("slow");
  await page.getByRole("button", { name: "取消检索", exact: true }).click();
  await expect(page.getByText("检索已取消", { exact: true })).toBeVisible();
  await page.waitForTimeout(1700);
  await expect(page.getByRole("button", { name: /打开来源：/ })).toHaveCount(0);
});

test("数据库离线显示可重试错误，Rerank 失败保留实际模式", async ({ browser, baseURL }) => {
  const offline = await browser.newPage({ baseURL });
  await installClient(offline, { searchError: "DATABASE_UNAVAILABLE" });
  await offline.goto("/");
  await expect(offline.getByRole("heading", { name: "全部笔记", exact: true })).toBeVisible();
  await offline.keyboard.press("Control+k");
  await offline.getByLabel("检索知识库", { exact: true }).fill("任意关键词");
  await expect(offline.getByRole("alert").filter({ hasText: "数据库暂时无法连接" })).toBeVisible();
  await expect(offline.getByRole("button", { name: "重新检索", exact: true })).toBeVisible();
  await offline.close();
  const degraded = await browser.newPage({ baseURL });
  await installClient(degraded, { rerankFailure: true });
  await degraded.goto("/");
  await expect(degraded.getByRole("heading", { name: "全部笔记", exact: true })).toBeVisible();
  await degraded.keyboard.press("Control+k");
  await degraded.getByLabel("检索知识库", { exact: true }).fill("任意关键词");
  await expect(
    degraded.getByText("重排暂时不可用，已保留召回顺序。", { exact: true }),
  ).toBeVisible();
  await expect(degraded.getByText("0 个来源片段 · 关键词检索", { exact: true })).toBeVisible();
  await degraded.close();
});
