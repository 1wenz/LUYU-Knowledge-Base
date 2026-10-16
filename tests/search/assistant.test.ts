import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SETTINGS,
  type OperationContext,
  type OperationPayload,
  type SearchResponse,
} from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/domain/validation";
import { createAssistant } from "../../electron/services/knowledge/assistant";
import type { AssistantSource } from "../../electron/services/knowledge/providers/chat";

const source: AssistantSource = {
  chunkId: randomUUID(),
  documentId: randomUUID(),
  documentRevision: 2,
  title: "合成来源",
  content: "合成证据。",
  startLine: 1,
  endLine: 2,
};
const { content, ...citation } = source;
const search: SearchResponse = {
  requestId: randomUUID(),
  generationId: randomUUID(),
  mode: "keyword",
  hits: [
    {
      ...citation,
      snippet: content,
      updatedAt: "2026-10-16T00:00:00.000Z",
      scores: { rrf: 1 },
    },
  ],
  warnings: [],
  timingsMs: { total: 0 },
};
function fixture(overrides: Partial<Parameters<typeof createAssistant>[0]> = {}, timeoutMs = 5000) {
  const events: OperationPayload[] = [];
  let calls = 0;
  const context: OperationContext = {
    ownerId: "test",
    operationId: randomUUID(),
    signal: new AbortController().signal,
    emit: (payload) => events.push(payload),
  };
  const deps: Parameters<typeof createAssistant>[0] = {
    getSettings: () => ({
      ...structuredClone(DEFAULT_SETTINGS),
      models: { ...DEFAULT_SETTINGS.models, chatModel: "synthetic/chat" },
    }),
    readKey: async () => "synthetic-key",
    model: async (id) => ({
      id,
      name: "合成模型",
      contextLength: 20_000,
      maxOutputTokens: 2048,
      supportsTemperature: null,
    }),
    search: async () => search,
    sources: async () => [source],
    current: async (sources) => sources.map((item) => item.chunkId),
    counter: { count: (value) => Array.from(value).length },
    stream: async function* (input) {
      calls++;
      assert.equal(input.sources[0].documentRevision, 2);
      yield "依据 [";
      yield "1] 合成证据 [999]。";
    },
    ...overrides,
  };
  return { assistant: createAssistant(deps, { timeoutMs }), events, context, calls: () => calls };
}

test("助手只输出允许来源编号，发出 context/delta 并由 B 维护 seq 与终态", async () => {
  const db = fixture();
  await db.assistant.start({ question: "合成问题" }, db.context);
  assert.equal(db.calls(), 1);
  const text = db.events
    .filter((event) => event.type === "delta")
    .map((event) => (event.type === "delta" ? event.text : ""))
    .join("");
  assert.equal(text, "依据 [1] 合成证据 。");
  assert.deepEqual(
    db.events
      .filter((event) => event.type === "context")
      .map((event) => (event.type === "context" ? event.citations : [])),
    [
      [
        {
          chunkId: source.chunkId,
          documentId: source.documentId,
          documentRevision: 2,
          title: source.title,
          startLine: 1,
          endLine: 2,
        },
      ],
    ],
  );
  assert.ok(db.events.every((event) => ["retrieving", "context", "delta"].includes(event.type)));
});

test("无模型不检索，无证据不调用 LLM，缺失资料明确说明不足", async () => {
  const unconfigured = fixture({
    getSettings: () => structuredClone(DEFAULT_SETTINGS),
    search: async () => {
      throw new Error("must not retrieve");
    },
  });
  await assert.rejects(
    unconfigured.assistant.start({ question: "问题" }, unconfigured.context),
    (error: unknown) => error instanceof DomainError && error.code === "CONFIG_REQUIRED",
  );
  const empty = fixture({ sources: async () => [] });
  await empty.assistant.start({ question: "问题" }, empty.context);
  assert.equal(empty.calls(), 0);
  assert.ok(empty.events.some((event) => event.type === "delta" && event.text.includes("不足")));
});

test("上下文受总预算和每文档上限约束，窗口不足时拒绝生成", async () => {
  const sources = Array.from({ length: 8 }, (_, index) => ({
    ...source,
    chunkId: randomUUID(),
    documentId: index < 6 ? source.documentId : randomUUID(),
    content: "合成证据".repeat(35),
  }));
  let included = 0;
  const db = fixture({
    sources: async () => sources,
    stream: async function* (input) {
      included = input.sources.length;
      assert.ok(input.sources.filter((item) => item.documentId === source.documentId).length <= 3);
      yield "资料 [1]";
    },
  });
  await db.assistant.start({ question: "合成问题" }, db.context);
  assert.equal(included, 5);
  const small = fixture({
    model: async (id) => ({
      id,
      name: id,
      contextLength: 100,
      maxOutputTokens: 2048,
      supportsTemperature: false,
    }),
  });
  await assert.rejects(
    small.assistant.start({ question: "问题" }, small.context),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_INPUT",
  );
  assert.equal(small.calls(), 0);
});

test("来源在生成期间变化会撤销引用并失败，超时与取消可中止忽略信号的 stream", async () => {
  let current = true;
  const changed = fixture({
    current: async () => (current ? [source.chunkId] : []),
    stream: async function* () {
      current = false;
      yield "旧证据 [1]";
    },
  });
  await assert.rejects(
    changed.assistant.start({ question: "合成问题" }, changed.context),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
  assert.ok(
    changed.events.some((event) => event.type === "context" && event.citations.length === 0),
  );
  assert.ok(changed.events.every((event) => event.type !== "delta"));
  const timeout = fixture(
    { stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }) },
    5,
  );
  await assert.rejects(
    timeout.assistant.start({ question: "问题" }, timeout.context),
    (error: unknown) => error instanceof DomainError && error.code === "TIMEOUT",
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    timeout.assistant.start({ question: "问题" }, { ...timeout.context, signal: abort.signal }),
    (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
  );
});
