"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/components/ui/chat-message";
import { FluidButton } from "@/components/ui/fluid-button";
import { InputMessage } from "@/components/ui/input-message";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { assistantStartSchema, type Citation, type KnowledgeClient } from "@/lib/contracts";
import { command, readableError, unwrap } from "@/lib/client/result";
import { useOperation } from "@/lib/client/use-operation";
import { Markdown } from "./markdown";
import { SearchWarnings } from "./search-panel";

export function AssistantPanel({
  client,
  onSource,
  onSettings,
  mode,
}: {
  client: KnowledgeClient;
  onSource: (source: Citation) => void;
  onSettings: () => void;
  mode: "demo" | "desktop";
}) {
  const { state, start, cancel, running } = useOperation(client);
  const [input, setInput] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [follow, setFollow] = useState(true);
  const starting = useRef(false);
  const mounted = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (followRef.current && viewportRef.current)
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [state.text, state.search, state.status]);

  async function ask(question: string) {
    if (starting.current || running) return;
    const parsed = assistantStartSchema.safeParse({ question });
    if (!parsed.success) {
      setError("请输入 1–4000 个字符的问题。");
      return;
    }
    starting.current = true;
    setPreparing(true);
    setError("");
    try {
      const settings = unwrap(await client.settings.get(command({})));
      if (!mounted.current) return;
      if (!settings.settings.models.chatModel) {
        setError("请先选择聊天模型，再向知识库提问。");
        return;
      }
      if (mode === "desktop" && !settings.secrets["openrouter-api-key"].configured) {
        setError("请先填写 OpenRouter API key，再生成回答。");
        return;
      }
      setLastQuestion(parsed.data.question);
      followRef.current = true;
      setFollow(true);
      const accepted = await start({ kind: "assistant", payload: parsed.data });
      if (accepted && mounted.current) setInput("");
    } catch (error) {
      if (mounted.current) setError(readableError(error));
    } finally {
      starting.current = false;
      if (mounted.current) setPreparing(false);
    }
  }
  const label =
    state.status === "starting"
      ? "操作已启动"
      : state.status === "retrieving"
        ? "正在检索来源…"
        : state.status === "streaming"
          ? "正在生成回答…"
          : state.status === "completed"
            ? "回答完成"
            : state.status === "cancelled"
              ? "已停止生成"
              : "";
  const currentError = error || state.error;
  return (
    <section
      aria-label="知识助手"
      className="assistant-workspace mx-auto flex w-full max-w-4xl flex-col p-5 sm:p-8"
    >
      <h1 className="text-2xl">知识助手</h1>
      <p className="mt-2 mb-5 text-muted-foreground">从资料中查找来源，再核对回答。</p>
      <div
        ref={viewportRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
          followRef.current = atBottom;
          setFollow(atBottom);
        }}
        aria-label="问题、来源与回答"
        className="min-h-0 flex-1 space-y-6 overflow-y-auto rounded-xl border bg-card p-4 sm:p-6"
      >
        {!lastQuestion && (
          <p className="py-8 text-center text-muted-foreground">
            从一个问题开始，让已有资料参与思考。
          </p>
        )}
        {lastQuestion && <ChatMessage from="user">{lastQuestion}</ChatMessage>}
        {state.search && (
          <div className="space-y-3">
            <h2 className="text-xl">检索来源</h2>
            <SearchWarnings response={state.search} />
            {!state.citations.length && (
              <p className="text-sm text-muted-foreground">本次没有可核对的来源。</p>
            )}
            <ol className="space-y-2">
              {state.citations.map((source, index) => (
                <li key={source.chunkId}>
                  <button
                    className="min-h-9 text-left text-primary underline [overflow-wrap:anywhere]"
                    aria-label={`来源 ${index + 1}：${source.title}，第 ${source.startLine}–${source.endLine} 行`}
                    onClick={() => onSource(source)}
                  >
                    {index + 1}. {source.title} · 第 {source.startLine}–{source.endLine} 行
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        {state.text && (
          <ChatMessage from="assistant">
            <Markdown text={state.text} client={client} onError={setError} />
          </ChatMessage>
        )}
      </div>
      {!follow && (
        <FluidButton
          className="mt-2 self-end"
          variant="tertiary"
          onClick={() => {
            followRef.current = true;
            setFollow(true);
            if (viewportRef.current)
              viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
          }}
        >
          回到最新回答
        </FluidButton>
      )}
      <div className="my-3 min-h-6">
        {running ? (
          <ThinkingIndicator label={label} />
        ) : (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {label}
          </p>
        )}
      </div>
      {currentError && (
        <div role="alert" className="mb-4 space-y-3 rounded-lg border p-4">
          <p className="text-destructive">{currentError}</p>
          <div className="flex flex-wrap gap-2">
            {lastQuestion && (
              <FluidButton
                variant="tertiary"
                disabled={running || preparing}
                onClick={() => {
                  void ask(lastQuestion);
                }}
              >
                重试回答
              </FluidButton>
            )}
            <FluidButton variant="ghost" onClick={onSettings}>
              前往模型与 API 设置
            </FluidButton>
          </div>
        </div>
      )}
      <InputMessage
        value={input}
        onValueChange={(value) => {
          setInput(value);
          setError("");
        }}
        onSend={(value) => {
          void ask(value);
        }}
        onStop={() => {
          void cancel();
        }}
        status={running ? "streaming" : "idle"}
        disabled={preparing && !running}
      />
    </section>
  );
}
