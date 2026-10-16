"use client";

import { useEffect, useRef, useState } from "react";
import { FluidButton } from "@/components/ui/fluid-button";
import { FluidDialog } from "@/components/ui/fluid-dialog";
import type { Citation, Document, KnowledgeClient } from "@/lib/contracts";
import { command, readableError, unwrap } from "@/lib/client/result";

export function SourceDialog({
  source,
  client,
  onClose,
}: {
  source: Citation;
  client: KnowledgeClient;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [refreshed, setRefreshed] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    client.documents
      .get(command({ id: source.documentId }))
      .then(unwrap)
      .then((value) => {
        if (active) setDocument(value);
      })
      .catch((error) => {
        if (active) setError(readableError(error));
      });
    return () => {
      active = false;
    };
  }, [client, source.documentId]);
  const stale = !!document && document.revision !== source.documentRevision;
  useEffect(() => {
    if (document && !stale) {
      lineRef.current?.scrollIntoView({ block: "center" });
      lineRef.current?.focus({ preventScroll: true });
    }
  }, [document, stale]);
  return (
    <FluidDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="来源原文"
      description={`${source.title} · 第 ${source.startLine}–${source.endLine} 行`}
      className="document-editor"
    >
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!document && !error && <p role="status">正在读取原笔记…</p>}
      {document?.deletedAt ? (
        <p role="alert">原笔记已在回收站，请先恢复后重新检索。</p>
      ) : (
        document && (
          <>
            {stale && (
              <div role="alert" className="mb-4 rounded-lg border p-4 text-warning">
                笔记版本已变化，原片段行号可能已失效。请返回并重新检索。
                {!refreshed && (
                  <div className="mt-3">
                    <FluidButton variant="tertiary" onClick={() => setRefreshed(true)}>
                      查看最新原文（不沿用旧行号）
                    </FluidButton>
                  </div>
                )}
              </div>
            )}
            {(!stale || refreshed) && (
              <div
                aria-label="带行号的来源原文"
                className="max-h-[55dvh] overflow-y-auto rounded-lg border font-mono text-sm"
              >
                {document.contentMarkdown.split("\n").map((line, index) => {
                  const highlighted =
                    !stale && index + 1 >= source.startLine && index + 1 <= source.endLine;
                  return (
                    <div
                      key={index}
                      ref={!stale && index + 1 === source.startLine ? lineRef : undefined}
                      tabIndex={!stale && index + 1 === source.startLine ? -1 : undefined}
                      data-source-line={index + 1}
                      data-highlighted={highlighted}
                      className={`flex gap-4 px-4 py-1 ${highlighted ? "bg-secondary text-primary" : ""}`}
                    >
                      <span
                        aria-label={`第 ${index + 1} 行`}
                        className="w-8 shrink-0 text-right text-muted-foreground"
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {line || " "}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )
      )}
      <FluidButton className="mt-5" variant="tertiary" onClick={onClose}>
        返回来源列表
      </FluidButton>
    </FluidDialog>
  );
}
