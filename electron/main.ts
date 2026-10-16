import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from "electron";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { requestSchemas, type AppInfo } from "../src/lib/contracts";
import { createPlatform } from "./composition";
import { createKnowledgeService } from "./services/knowledge";
import { knowledgeMigrations } from "./platform/migration-resources";
import { IpcDispatcher } from "./ipc/dispatcher";
import { SenderGate } from "./ipc/sender";
import { createSafeLogger, PlatformError } from "./platform/errors";
import { isWithin, rendererOrigin, trustedOrigin } from "./platform/security";
import { registerStaticProtocol } from "./platform/protocol";
import { readPickedTextFiles } from "./platform/text-files";

protocol.registerSchemesAsPrivileged([
  { scheme: "knowledge", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const logger = createSafeLogger();
process.env.LANGCHAIN_TRACING_V2 = "false";
process.env.LANGSMITH_TRACING = "false";
const origin = rendererOrigin(app.isPackaged, process.env.ELECTRON_RENDERER_URL);
const gate = new SenderGate(origin);
const windows = new Map<string, BrowserWindow>();
let platform: Awaited<ReturnType<typeof createPlatform>> | undefined;
let quitting = false;

if (process.env.ZHIYU_TEST_MODE === "1" && process.env.ZHIYU_TEST_USER_DATA) {
  const target = resolve(process.env.ZHIYU_TEST_USER_DATA);
  if (!isWithin(resolve(process.cwd(), ".cache"), target)) throw new PlatformError("INVALID_INPUT");
  app.setPath("userData", target);
}
if (process.platform === "win32") app.setAppUserModelId("com.zhiyu.knowledgebase");
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      registerStaticProtocol(resolve(app.getAppPath(), "out"));
      const info: AppInfo = {
        apiVersion: 1,
        name: app.getName(),
        productName: "Zhiyu",
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        versions: {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
        developer: ZHIYU_PUBLIC_METADATA,
        mode: "desktop",
      };
      platform = await createPlatform({
        userData: app.getPath("userData"),
        info,
        encryption: {
          isAvailable: () => safeStorage.isEncryptionAvailable(),
          encrypt: (value) => safeStorage.encryptString(value),
          decrypt: (value) => safeStorage.decryptString(Buffer.from(value)),
        },
        send: (owner, event) => {
          const window = windows.get(owner);
          if (window && !window.isDestroyed() && trustedOrigin(window.webContents.getURL(), origin))
            window.webContents.send("operation:event", event);
        },
        openExternal: (url) => shell.openExternal(url),
        pickTextFiles: async (owner) => {
          const window = windows.get(owner);
          if (!window || window.isDestroyed()) throw new PlatformError("UNAUTHORIZED");
          const selection = await dialog.showOpenDialog(window, {
            title: "导入 UTF-8 Markdown / TXT",
            properties: ["openFile", "multiSelections"],
            filters: [{ name: "文本资料", extensions: ["md", "markdown", "txt"] }],
          });
          return selection.canceled ? { files: [] } : readPickedTextFiles(selection.filePaths);
        },
        createKnowledgeService: (deps) =>
          createKnowledgeService(deps, { migrations: knowledgeMigrations }),
      });
      const dispatcher = new IpcDispatcher(gate, platform.handlers, platform.logger);
      for (const channel of Object.keys(requestSchemas))
        ipcMain.handle(channel, (event, request: unknown) =>
          dispatcher.invoke(channel, event, request),
        );
      ipcMain.handle("app:get-info", (event) => {
        gate.authorize(event);
        return { name: info.name, version: info.version, platform: info.platform };
      });
      function createWindow() {
        const window = new BrowserWindow({
          width: 1380,
          height: 900,
          minWidth: 960,
          minHeight: 640,
          frame: true,
          icon: existsSync(join(app.getAppPath(), "out/brand/brush-256.png"))
            ? join(app.getAppPath(), "out/brand/brush-256.png")
            : join(app.getAppPath(), ".cache/branding/brush-256.png"),
          title: "知屿 · Knowledge Base",
          backgroundColor: "#F7F7F2",
          show: false,
          autoHideMenuBar: true,
          webPreferences: {
            preload: join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
          },
        });
        const contents = window.webContents;
        const owner = gate.register(contents);
        windows.set(owner, window);
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event, url) => {
          if (!trustedOrigin(url, origin)) event.preventDefault();
        });
        window.webContents.on("will-frame-navigate", (event) => {
          if (!event.isMainFrame || !trustedOrigin(event.url, origin)) event.preventDefault();
        });
        window.webContents.on("will-attach-webview", (event) => event.preventDefault());
        window.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
          if (isMainFrame) platform?.operations.cancelOwner(owner);
        });
        window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
          callback(false),
        );
        window.webContents.session.setPermissionCheckHandler(() => false);
        window.webContents.session.setDevicePermissionHandler(() => false);
        window.once("ready-to-show", () => window.show());
        window.once("closed", () => {
          platform?.operations.cancelOwner(owner);
          gate.unregister(contents);
          windows.delete(owner);
        });
        void window.loadURL(origin).catch(() => {
          logger.error("application.started", { code: "INTERNAL" });
          app.quit();
        });
      }
      createWindow();
      app.on("second-instance", () => {
        const window = [...windows.values()][0];
        if (window) {
          if (window.isMinimized()) window.restore();
          window.focus();
        }
      });
      app.on("activate", () => {
        if (!windows.size) createWindow();
      });
      logger.info("application.started");
    })
    .catch((error: unknown) => {
      logger.error("application.started", {
        code: error instanceof PlatformError ? error.code : "INTERNAL",
      });
      app.quit();
    });

app.on("before-quit", (event) => {
  if (!platform || quitting) return;
  event.preventDefault();
  quitting = true;
  void platform
    .dispose()
    .catch(() => logger.error("application.stopped", { code: "INTERNAL" }))
    .finally(() => {
      logger.info("application.stopped");
      app.quit();
    });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
