"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Search } from "lucide-react";
import { FluidButton } from "@/components/ui/fluid-button";
import type { Citation, Collection, KnowledgeClient, SearchResponse } from "@/lib/contracts";
import { command, readableError, unwrap } from "@/lib/client/result";
import { Highlight } from "./markdown";

export const searchModeLabel: Record<SearchResponse["mode"], string> = {
  "hybrid-rerank": "混合检索 · 已重排",
  hybrid: "混合检索",
  keyword: "关键词检索",
  vector: "向量检索",
};

export function SearchWarnings({ response }: { response: SearchResponse }) {
  return (
    <div className="space-y-2">
      {response.warnings.map((warning, index) => (
        <p key={index} className="flex items-start gap-2 text-sm text-warning">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{warning.message}</span>
        </p>
      ))}
    </div>
  );
}

export function SearchPanel({
  client,
  collections,
  inputRef,
  onSource,
}: {
  client: KnowledgeClient;
  collections: Collection[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSource: (source: Citation) => void;
}) {
  const [query, setQuery] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const pending = useRef<string | null>(null);

  function invalidate() {
    const id = pending.current;
    pending.current = null;
    if (id) void client.search.cancel(command({ requestIdToCancel: id })).catch(() => undefined);
  }
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setResponse(null);
        setStatus("idle");
        setError("");
        return;
      }
      const requestId = crypto.randomUUID();
      pending.current = requestId;
      setStatus("loading");
      setResponse(null);
      setError("");
      void client.search
        .query({
          requestId,
          query: query.trim(),
          ...(collectionId ? { filters: { collectionId } } : {}),
        })
        .then((result) => {
          if (!active || pending.current !== requestId) return;
          const resultResponse = unwrap(result);
          if (result.requestId !== requestId || resultResponse.requestId !== requestId)
            throw new Error("Unexpected search response");
          pending.current = null;
          setResponse(resultResponse);
          setStatus("complete");
        })
        .catch((error) => {
          if (!active || pending.current !== requestId) return;
          pending.current = null;
          setStatus("error");
          setError(readableError(error));
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
      const id = pending.current;
      pending.current = null;
      if (id) void client.search.cancel(command({ requestIdToCancel: id })).catch(() => undefined);
    };
  }, [client, query, collectionId, retry]);

  return (
    <section aria-label="知识库来源检索" className="mx-auto w-full max-w-4xl p-5 sm:p-8">
      <h1 className="text-2xl">来源检索</h1>
      <p className="mt-2 mb-6 text-muted-foreground">查找笔记中的来源片段，打开原文核对上下文。</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="field min-w-0 flex-1">
          检索知识库
          <input
            ref={inputRef}
            type="search"
            className="fluid-field"
            maxLength={2000}
            value={query}
            onChange={(event) => {
              invalidate();
              setQuery(event.target.value);
              setResponse(null);
              setError("");
              setStatus(event.target.value.trim() ? "waiting" : "idle");
            }}
            placeholder="输入问题或关键词…"
          />
        </label>
        <label className="field w-full sm:w-44">
          检索范围
          <select
            className="fluid-field"
            value={collectionId}
            onChange={(event) => {
              invalidate();
              setCollectionId(event.target.value);
              setResponse(null);
              setStatus(query.trim() ? "waiting" : "idle");
            }}
          >
            <option value="">全部分类</option>
            {collections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="mt-5 flex min-h-10 flex-wrap items-center gap-3"
        role="status"
        aria-live="polite"
      >
        <span>
          {status === "waiting"
            ? "等待输入完成…"
            : status === "loading"
              ? "正在检索来源…"
              : status === "cancelled"
                ? "检索已取消"
                : response
                  ? `${response.hits.length} 个来源片段 · ${searchModeLabel[response.mode]}`
                  : ""}
        </span>
        {status === "loading" && (
          <FluidButton
            variant="tertiary"
            onClick={() => {
              invalidate();
              setStatus("cancelled");
            }}
          >
            取消检索
          </FluidButton>
        )}
      </div>
      {error && (
        <div role="alert" className="my-5 space-y-3 rounded-lg border p-4">
          <p className="text-destructive">{error}</p>
          <FluidButton variant="tertiary" onClick={() => setRetry((value) => value + 1)}>
            重新检索
          </FluidButton>
        </div>
      )}
      {response && <SearchWarnings response={response} />}
      {response?.hits.length === 0 && (
        <div className="py-12 text-center">
          <Search aria-hidden="true" className="mx-auto mb-4 size-8 text-muted-foreground" />
          <h2 className="text-xl">没有匹配的来源片段</h2>
          <p className="mt-2 text-muted-foreground">换个关键词，或添加资料后再试。</p>
        </div>
      )}
      <ol className="mt-6 divide-y">
        {response?.hits.map((hit) => (
          <li key={hit.chunkId} className="py-5">
            <button
              className="w-full text-left"
              onClick={() => onSource(hit)}
              aria-label={`打开来源：${hit.title}，第 ${hit.startLine}–${hit.endLine} 行`}
            >
              <span className="block text-lg text-primary">
                <Highlight text={hit.title} query={query} />
              </span>
              <span className="my-2 block text-sm text-muted-foreground">
                第 {hit.startLine}–{hit.endLine} 行 ·{" "}
                {new Date(hit.updatedAt).toLocaleDateString("zh-CN")}
              </span>
              <span className="block whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
                <Highlight text={hit.snippet} query={query} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
