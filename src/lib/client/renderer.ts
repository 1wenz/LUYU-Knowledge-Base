"use client";

import type { KnowledgeClient } from "@/lib/contracts";
import type {} from "@/lib/desktop";
import { createDemoClient } from "./demo";

export type ClientSelection =
  | { kind: "ready"; mode: "desktop" | "demo"; client: KnowledgeClient }
  | { kind: "choose-demo" }
  | { kind: "error"; message: string };

export function selectRendererClient(): ClientSelection {
  const desktop = window.desktop;
  if (desktop) {
    const groups = {
      system: ["getInfo", "openExternal", "pickTextFiles"],
      collections: ["list", "save", "remove"],
      documents: ["list", "get", "save", "setFavorite", "remove", "restore", "import"],
      search: ["query", "cancel"],
      settings: ["get", "update"],
      secrets: ["set", "delete"],
      connections: ["test"],
      models: ["list"],
      index: ["status", "rebuild"],
      assistant: ["start"],
      operations: ["subscribe", "cancel"],
    };
    const complete = Object.entries(groups).every(([group, methods]) => {
      const value: unknown = Reflect.get(desktop, group);
      return (
        !!value &&
        typeof value === "object" &&
        methods.every((method) => typeof Reflect.get(value, method) === "function")
      );
    });
    if (!complete) {
      return {
        kind: "error",
        message:
          "桌面接口尚未就绪。请更新并重启应用，或联系集成人检查 preload；当前内容不会写入演示存储。",
      };
    }
    return { kind: "ready", mode: "desktop", client: desktop };
  }
  if (location.protocol === "knowledge:" || navigator.userAgent.includes("Electron/")) {
    return { kind: "error", message: "桌面接口未连接。请重启应用并检查 preload 配置。" };
  }
  if (new URLSearchParams(location.search).get("demo") !== "1") return { kind: "choose-demo" };
  try {
    return { kind: "ready", mode: "demo", client: createDemoClient(window.localStorage) };
  } catch {
    return {
      kind: "error",
      message: "演示存储无法读取。请先备份浏览器数据，再检查存储权限；原有数据不会被覆盖。",
    };
  }
}
