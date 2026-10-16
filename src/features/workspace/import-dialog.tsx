"use client";

import { useRef, useState } from "react";
import { FluidButton } from "@/components/ui/fluid-button";
import { FluidDialog } from "@/components/ui/fluid-dialog";
import {
  batchImportSchema,
  LIMITS,
  type BatchImport,
  type Collection,
  type KnowledgeClient,
} from "@/lib/contracts";
import { command, readableError, unwrap } from "@/lib/client/result";
import { isNote } from "@/features/knowledge/model";

async function fingerprint(source: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ImportDialog({
  client,
  collections,
  onClose,
  onImported,
}: {
  client: KnowledgeClient;
  collections: Collection[];
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [batch, setBatch] = useState<BatchImport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function prepare(legacy: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setBatch(null);
    try {
      let source: string;
      let items: BatchImport["items"];
      if (legacy) {
        const raw = localStorage.getItem("zhiyu:notes:v1");
        if (!raw) throw new Error("没有找到旧版笔记数据。");
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error("旧版数据损坏，请先备份。原数据已保留。");
        }
        if (
          !data ||
          typeof data !== "object" ||
          !("version" in data) ||
          data.version !== 1 ||
          !("notes" in data) ||
          !Array.isArray(data.notes) ||
          !data.notes.every(isNote) ||
          new Set(data.notes.map((note) => note.id)).size !== data.notes.length
        )
          throw new Error("旧版数据格式无效，原数据已保留。");
        if (!data.notes.length) throw new Error("旧版知识库为空，没有需要导入的笔记。");
        if (data.notes.length > LIMITS.importCount)
          throw new Error("旧版笔记超过单次 100 篇上限，请先分批导出文件再导入。");
        const names = { product: "产品设计", engineering: "技术笔记", ideas: "灵感碎片" };
        items = data.notes.map((note) => ({
          sourceId: note.id,
          draft: {
            title: note.title,
            contentMarkdown: note.content,
            collectionId:
              collections.find((item) => item.name === names[note.collectionId])?.id ?? null,
            tags: note.tags,
          },
        }));
        source = "legacy:" + JSON.stringify(items);
      } else {
        const files = unwrap(await client.system.pickTextFiles(command({}))).files;
        if (!files.length) return;
        items = await Promise.all(
          files.map(async (file) => ({
            sourceId: await fingerprint(file.name + "\n" + file.content),
            draft: {
              title: Array.from(file.name.replace(/\.(md|markdown|txt)$/i, "") || "导入笔记")
                .slice(0, 120)
                .join(""),
              contentMarkdown: file.content,
              collectionId: null,
              tags: [],
            },
          })),
        );
        items.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
        source = "files:" + JSON.stringify(items);
      }
      const parsed = batchImportSchema.safeParse({
        sourceFingerprint: await fingerprint(source),
        items,
      });
      if (!parsed.success)
        throw new Error(
          "导入内容超出限制：每篇最多 2 MiB、每批最多 100 篇且总量 8 MiB，请拆分后重试。",
        );
      setBatch(parsed.data);
    } catch (error) {
      setError(
        error instanceof Error && !("detail" in error) ? error.message : readableError(error),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function importBatch() {
    if (!batch || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const report = unwrap(await client.documents.import(command(batch)));
      onImported(`导入 ${report.imported} 篇，跳过 ${report.skipped} 篇重复笔记。`);
      onClose();
    } catch (error) {
      setError(readableError(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <FluidDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="导入资料"
      description="导入 UTF-8 Markdown / TXT，或读取当前浏览器的旧版笔记。原文件和旧版存储会保留。"
    >
      <div className="flex flex-wrap gap-3">
        <FluidButton
          variant="tertiary"
          disabled={busy}
          onClick={() => {
            void prepare(false);
          }}
        >
          选择文本文件
        </FluidButton>
        <FluidButton
          variant="tertiary"
          disabled={busy}
          onClick={() => {
            void prepare(true);
          }}
        >
          读取旧版笔记
        </FluidButton>
      </div>
      <p className="my-4 text-sm text-muted-foreground">
        每篇最多 2 MiB，每批最多 100 篇、总量 8
        MiB。迁移标题、正文、分类和标签；创建时间以本次导入为准。
      </p>
      {busy && <p role="status">正在处理导入…</p>}
      {error && (
        <p role="alert" className="my-4 text-destructive">
          {error}
        </p>
      )}
      {batch && (
        <>
          <p className="mb-3">待导入 {batch.items.length} 篇笔记</p>
          <ul className="mb-5 max-h-48 overflow-y-auto rounded-lg border p-4 text-sm">
            {batch.items.map((item) => (
              <li key={item.sourceId} className="py-1 [overflow-wrap:anywhere]">
                {item.draft.title}
              </li>
            ))}
          </ul>
          <FluidButton
            disabled={busy}
            onClick={() => {
              void importBatch();
            }}
          >
            确认导入
          </FluidButton>
        </>
      )}
    </FluidDialog>
  );
}
