import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const scheme = "knowledge";
const productionOrigin = `${scheme}://app`;
let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function rendererUrl() {
  if (app.isPackaged) return productionOrigin;
  const address = process.env.ELECTRON_RENDERER_URL;
  if (!address) return productionOrigin;
  const url = new URL(address);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("开发渲染地址必须使用本机 HTTP 地址。");
  }
  return url.origin;
}

function isTrustedUrl(address: string) {
  try {
    const candidate = new URL(address);
    const trusted = new URL(rendererUrl());
    return candidate.protocol === trusted.protocol && candidate.host === trusted.host;
  } catch {
    return false;
  }
}

function registerStaticProtocol() {
  const exportRoot = resolve(app.getAppPath(), "out");
  protocol.handle(scheme, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "app" || !["GET", "HEAD"].includes(request.method)) {
        return new Response("Forbidden", { status: 403 });
      }
      const pathname = decodeURIComponent(url.pathname);
      const target = resolve(exportRoot, `.${pathname}`);
      const relativePath = relative(exportRoot, target);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        relativePath.includes(":")
      ) {
        return new Response("Forbidden", { status: 403 });
      }
      const filePath = pathname.endsWith("/") ? join(target, "index.html") : target;
      if (!existsSync(filePath)) return new Response("Not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(request.method === "HEAD" ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch {
      return new Response("Bad request", { status: 400 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "知屿 · Knowledge Base",
    backgroundColor: "#f8f9fb",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, address) => {
    if (!isTrustedUrl(address)) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.once("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(rendererUrl()).catch((error: unknown) => {
    console.error("无法加载知识库工作区：", error);
    app.quit();
  });
}

app
  .whenReady()
  .then(() => {
    registerStaticProtocol();
    ipcMain.handle("app:get-info", (event) => {
      if (
        event.sender !== mainWindow?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        !isTrustedUrl(event.senderFrame.url)
      )
        throw new Error("不允许的 IPC 调用来源。");
      return { name: app.getName(), version: app.getVersion(), platform: process.platform };
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    console.error(error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
