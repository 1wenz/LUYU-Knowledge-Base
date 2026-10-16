import {
  assistantStartSchema,
  publicSettingsSchema,
  type AssistantStart,
  type ChatModelInfo,
  type Citation,
  type OperationContext,
  type PublicSettings,
  type SearchFilters,
  type SearchHit,
  type SearchRequest,
  type SearchResponse,
  type ServiceContext,
} from "../../../src/lib/contracts";
import { DomainError } from "../../../src/lib/domain/validation";
import { selectContext } from "../../../src/lib/domain/citations";
import type { TokenCounter } from "../../../src/lib/domain/chunking";
import {
  ASSISTANT_SYSTEM,
  serializeSources,
  type AssistantSource,
  type ChatStream,
} from "./providers/chat";
import { deadline } from "./async";

export function citationFilter(count: number) {
  let pending = "";
  return (text: string, done = false): string => {
    pending += text;
    let output = "";
    while (pending.length) {
      const index = pending.indexOf("[");
      if (index < 0) {
        output += pending;
        pending = "";
        break;
      }
      output += pending.slice(0, index);
      pending = pending.slice(index);
      const match = pending.match(/^\[(\d+)\]/);
      if (match) {
        const number = Number(match[1]);
        if (number >= 1 && number <= count) output += `[${number}]`;
        pending = pending.slice(match[0].length);
        continue;
      }
      if (/^\[\d*$/.test(pending) && pending.length < 32 && !done) break;
      if (/^\[\d*$/.test(pending) && done) {
        pending = "";
        break;
      }
      output += pending[0];
      pending = pending.slice(1);
    }
    return output;
  };
}
export function createAssistant(
  deps: {
    getSettings(): PublicSettings;
    readKey(): Promise<string | null>;
    model(id: string, context: ServiceContext): Promise<ChatModelInfo>;
    search(input: SearchRequest, context: ServiceContext): Promise<SearchResponse>;
    sources(
      hits: SearchHit[],
      filters: SearchFilters | undefined,
      context: ServiceContext,
    ): Promise<AssistantSource[]>;
    current(
      sources: AssistantSource[],
      filters: SearchFilters | undefined,
      context: ServiceContext,
    ): Promise<string[]>;
    stream: ChatStream;
    counter: TokenCounter;
  },
  options: { timeoutMs?: number } = {},
) {
  return {
    async start(input: AssistantStart, parent: OperationContext): Promise<void> {
      const parsed = assistantStartSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_INPUT", "问题格式无效", "question");
      const settings = publicSettingsSchema.parse(structuredClone(deps.getSettings()));
      const modelId = settings.models.chatModel;
      if (!modelId) throw new DomainError("CONFIG_REQUIRED", "请先选择聊天模型", "models");
      const scope = deadline(parent.signal, options.timeoutMs ?? 90_000, "知识助手");
      const context = { ...parent, signal: scope.signal };
      let iterator: AsyncIterator<string> | undefined;
      try {
        const key = await scope.wait(deps.readKey);
        if (!key) throw new DomainError("CONFIG_REQUIRED", "请先配置 OpenRouter API key");
        const model = await scope.wait(() => deps.model(modelId, context));
        if (
          model.maxOutputTokens !== null &&
          settings.generation.maxOutputTokens > model.maxOutputTokens
        )
          throw new DomainError("INVALID_INPUT", "回答 token 上限超过模型能力", "generation");
        context.emit({ type: "retrieving" });
        const search = await scope.wait(() =>
          deps.search(
            {
              requestId: context.operationId,
              query: Array.from(parsed.data.question).slice(0, 2000).join(""),
              filters: parsed.data.filters,
            },
            context,
          ),
        );
        const found = await scope.wait(() =>
          deps.sources(search.hits, parsed.data.filters, context),
        );
        const overhead =
          deps.counter.count(ASSISTANT_SYSTEM) + deps.counter.count(parsed.data.question) + 128;
        const budget = Math.min(
          settings.generation.contextTokenBudget,
          model.contextLength === null
            ? settings.generation.contextTokenBudget
            : model.contextLength - overhead - settings.generation.maxOutputTokens,
        );
        if (budget < 1)
          throw new DomainError("INVALID_INPUT", "问题和回答预算超过模型上下文窗口", "generation");
        const selected = selectContext(
          found.map((source) => ({
            ...source,
            original: source,
            content: serializeSources([source]),
          })),
          {
            tokenBudget: budget,
            maxChunks: settings.generation.contextChunks,
            maxChunksPerDocument: settings.generation.maxChunksPerDocument,
          },
          deps.counter,
        ).chunks.map((item) => item.original);
        while (selected.length && deps.counter.count(serializeSources(selected)) > budget)
          selected.pop();
        const citations: Citation[] = selected.map(
          ({ chunkId, documentId, documentRevision, title, startLine, endLine }) => ({
            chunkId,
            documentId,
            documentRevision,
            title,
            startLine,
            endLine,
          }),
        );
        context.emit({ type: "context", search, citations });
        if (!selected.length) {
          scope.check();
          context.emit({
            type: "delta",
            text: "当前资料不足以回答这个问题。请补充相关笔记，或调整检索条件后重试。",
          });
          return;
        }
        const verify = async () => {
          const current = new Set(
            await scope.wait(() => deps.current(selected, parsed.data.filters, context)),
          );
          if (selected.some((source) => !current.has(source.chunkId))) {
            context.emit({ type: "context", search: { ...search, hits: [] }, citations: [] });
            throw new DomainError("CONFLICT", "回答期间来源笔记已改变，请重新提问");
          }
        };
        await verify();
        iterator = deps
          .stream({
            question: parsed.data.question,
            sources: selected,
            model,
            generation: settings.generation,
            key,
            signal: scope.signal,
          })
          [Symbol.asyncIterator]();
        const filter = citationFilter(selected.length);
        let output = "";
        const emit = (piece: string) => {
          if (!piece) return;
          output += piece;
          if (
            new TextEncoder().encode(output).length > 2_097_152 ||
            deps.counter.count(output) > settings.generation.maxOutputTokens
          )
            throw new DomainError("SCHEMA_MISMATCH", "回答超过输出 token 预算");
          // B owns throttling/seq/terminal; each service delta still obeys the event byte bound.
          let buffer = "";
          for (const character of piece) {
            if (new TextEncoder().encode(buffer + character).length > 16_384) {
              context.emit({ type: "delta", text: buffer });
              buffer = "";
            }
            buffer += character;
          }
          if (buffer) context.emit({ type: "delta", text: buffer });
        };
        let first = true;
        while (true) {
          const item = await scope.wait(() => iterator!.next());
          if (item.done) break;
          if (first) {
            await verify();
            first = false;
          }
          scope.check();
          emit(filter(item.value));
        }
        await verify();
        emit(filter("", true));
      } catch (error) {
        scope.check();
        if (error instanceof DomainError) throw error;
        throw new DomainError("PROVIDER_UNAVAILABLE", "知识助手暂时不可用，请稍后重试");
      } finally {
        scope.dispose();
        if (iterator?.return) void iterator.return().catch(() => undefined);
      }
    },
  };
}
