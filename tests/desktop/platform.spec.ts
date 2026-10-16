import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopFixture } from "./fixtures";
import type { KnowledgeClient } from "../../src/lib/contracts";
import "../../src/lib/desktop";

test("真实 preload 固定 API、参数攻击和未接服务状态", async () => {
  const { application, page } = await desktopFixture();
  try {
    await page.waitForFunction(() => !!window.desktop?.system);
    const results = await page.evaluate(async () => {
      const desktop = window.desktop!;
      const command = <T>(payload: T) => ({ requestId: crypto.randomUUID(), payload });
      return {
        info: await desktop.system.getInfo(command({})),
        settings: await desktop.settings.get(command({})),
        badUrl: await desktop.system.openExternal(
          command({ url: "file:///C:/Windows/system.ini" }),
        ),
        badEnum: await desktop.connections.test(
          command({ target: "arbitrary" } as unknown as { target: "database" }),
        ),
        unavailable: await desktop.documents.list(command({ view: "all", offset: 0, limit: 50 })),
        arbitraryInvoke: "invoke" in desktop,
        node: "require" in window || "process" in window,
      };
    });
    expect(results.info.ok && results.info.value.apiVersion).toBe(1);
    if (results.info.ok)
      await writeFile(".cache/desktop-runtime.json", JSON.stringify(results.info.value, null, 2));
    expect(results.settings.ok && results.settings.value.settings.database.sslMode).toBe("disable");
    expect(!results.badUrl.ok && results.badUrl.error.code).toBe("INVALID_INPUT");
    expect(!results.badEnum.ok && results.badEnum.error.code).toBe("INVALID_INPUT");
    expect(!results.unavailable.ok && results.unavailable.error.code).toBe("CONFIG_REQUIRED");
    expect(results.arbitraryInvoke).toBe(false);
    expect(results.node).toBe(false);
    const security = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { frame: window.hasShadow(), prefs: window.webContents.getLastWebPreferences() };
    });
    expect(security.prefs.webSecurity).toBe(true);
    expect(security.prefs.sandbox).toBe(true);
    expect(security.prefs.contextIsolation).toBe(true);
    expect(security.prefs.nodeIntegration).toBe(false);
    expect(security.prefs.webviewTag).toBe(false);
    const status = await page.evaluate(async () => ({
      missing: (await fetch("knowledge://app/does-not-exist.txt")).status,
      post: (await fetch("knowledge://app/", { method: "POST" })).status,
      csp: (await fetch("knowledge://app/")).headers.get("Content-Security-Policy"),
    }));
    expect(status.missing).toBe(404);
    expect(status.post).toBe(403);
    expect(status.csp).toContain("connect-src 'self'");
    expect(status.csp).toContain("frame-src 'none'");
  } finally {
    await application.close();
  }
});

test("safeStorage 保存/删除与设置跨真实重启保留，秘密不回读", async () => {
  const first = await desktopFixture();
  const secret = "synthetic-safeStorage-integration-secret";
  try {
    const result = await first.page.evaluate(async (value) => {
      const desktop = window.desktop!;
      const settings = await desktop.settings.get({ requestId: crypto.randomUUID(), payload: {} });
      if (!settings.ok) return { settings, secret: null };
      const updated = await desktop.settings.update({
        requestId: crypto.randomUUID(),
        payload: {
          expectedRevision: settings.value.settings.revision,
          patch: { appearance: { theme: "dark", reduceMotion: true } },
        },
      });
      const saved = await desktop.secrets.set({
        requestId: crypto.randomUUID(),
        payload: { kind: "openrouter-api-key", value, persistence: "encrypted" },
      });
      return { settings: updated, secret: saved };
    }, secret);
    expect(result.settings.ok).toBe(true);
    expect(result.secret?.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(await readFile(join(first.userData, "credentials.json"), "utf8")).not.toContain(secret);
  } finally {
    await first.application.close();
  }
  const second = await desktopFixture(first.userData);
  try {
    const state = await second.page.evaluate(async () => {
      const desktop = window.desktop!;
      const settings = await desktop.settings.get({ requestId: crypto.randomUUID(), payload: {} });
      const deleted = await desktop.secrets.delete({
        requestId: crypto.randomUUID(),
        payload: { kind: "openrouter-api-key" },
      });
      return { settings, deleted, hasRead: "get" in desktop.secrets || "read" in desktop.secrets };
    });
    expect(state.settings.ok && state.settings.value.settings.appearance.theme).toBe("dark");
    expect(
      state.settings.ok && state.settings.value.secrets["openrouter-api-key"].persistence,
    ).toBe("encrypted");
    expect(state.deleted.ok && state.deleted.value["openrouter-api-key"].configured).toBe(false);
    expect(state.hasRead).toBe(false);
  } finally {
    await second.application.close();
  }
  const third = await desktopFixture(first.userData);
  try {
    const state = await third.page.evaluate(() =>
      window.desktop!.settings.get({ requestId: crypto.randomUUID(), payload: {} }),
    );
    expect(state.ok && state.value.secrets["openrouter-api-key"].configured).toBe(false);
  } finally {
    await third.application.close();
  }
});

test("同源但未注册的窗口无法调用 IPC，外部导航与弹窗被阻止", async () => {
  const { application, page } = await desktopFixture();
  try {
    const [untrusted] = await Promise.all([
      application.waitForEvent("window"),
      application.evaluate(async ({ BrowserWindow, app }) => {
        const preload = app.getAppPath() + "/dist-electron/preload.js";
        const window = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        await window.loadURL("knowledge://app/");
      }),
    ]);
    await untrusted.waitForFunction(() => !!window.desktop?.system);
    const result = await untrusted.evaluate(() =>
      (window.desktop as KnowledgeClient).system.getInfo({
        requestId: crypto.randomUUID(),
        payload: {},
      }),
    );
    expect(!result.ok && result.error.code).toBe("UNAUTHORIZED");
    await untrusted.close();
    await page.evaluate(() => {
      window.open("https://example.org/");
      const link = document.createElement("a");
      link.href = "https://example.org/";
      document.body.append(link);
      link.click();
    });
    expect(page.url()).toBe("knowledge://app/");
    expect(application.windows()).toHaveLength(1);
  } finally {
    await application.close();
  }
});
