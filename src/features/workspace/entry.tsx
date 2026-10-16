"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Laptop } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { selectRendererClient, type ClientSelection } from "@/lib/client/renderer";
import { KnowledgeWorkspace } from "@/features/knowledge/workspace";
import { Workspace } from "./workspace";

export function WorkspaceEntry() {
  const params = useSearchParams();
  const demoQuery = params.get("demo");
  const legacyQuery = params.get("legacy");
  const [selection, setSelection] = useState<ClientSelection | { kind: "loading" | "legacy" }>({
    kind: "loading",
  });
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      const legacy =
        !window.desktop &&
        !navigator.userAgent.includes("Electron/") &&
        new URLSearchParams(location.search).get("legacy") === "1";
      setSelection(legacy ? { kind: "legacy" } : selectRendererClient());
    });
    return () => {
      active = false;
    };
  }, [demoQuery, legacyQuery]);

  if (selection.kind === "legacy") return <KnowledgeWorkspace />;
  if (selection.kind === "ready")
    return <Workspace client={selection.client} mode={selection.mode} />;
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-xl rounded-xl border bg-card p-6 sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark className="size-10" />
          <span className="text-[1.375rem]">
            知屿 <span className="text-sm text-muted-foreground">Zhiyu</span>
          </span>
        </div>
        {selection.kind === "loading" ? (
          <p role="status">正在打开工作区…</p>
        ) : selection.kind === "error" ? (
          <>
            <h1 className="text-2xl">工作区暂时无法打开</h1>
            <p role="alert" className="my-6 text-destructive">
              {selection.message}
            </p>
            <button
              type="button"
              onClick={() => location.reload()}
              className="text-primary underline"
            >
              重新连接工作区
            </button>
          </>
        ) : (
          <>
            <Laptop aria-hidden="true" className="mb-4 size-8 text-primary" />
            <h1 className="text-2xl">打开你的知识工作区</h1>
            <p className="my-6 text-muted-foreground">
              在桌面应用中整理本地资料、查找来源，让想法有据可循。浏览器演示使用独立的本地数据，首次打开为空。
            </p>
            <Link
              href="/?demo=1"
              className="inline-flex min-h-10 items-center gap-3 rounded-md bg-primary px-4 py-2 text-primary-foreground"
            >
              进入浏览器演示 <ArrowRight aria-hidden="true" className="size-5" />
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
