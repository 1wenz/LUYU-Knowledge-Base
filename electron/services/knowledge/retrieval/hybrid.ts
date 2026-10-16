import {
  searchRequestSchema,
  searchResponseSchema,
  publicSettingsSchema,
  type SearchRequest,
  type SearchResponse,
  type SearchHit,
  type SearchWarning,
  type SearchFilters,
  type ServiceContext,
  type PublicSettings,
  type SecretKind,
  type SafeLogger,
} from "../../../../src/lib/contracts";
import { DomainError } from "../../../../src/lib/domain/validation";
import { fuseRankedCandidates } from "../../../../src/lib/domain/rrf";
import { validateEmbeddingBatch, validateRerankResults } from "../../../../src/lib/domain/vectors";

export type ActiveProfile = {
  id: string;
  model: "openai/text-embedding-3-large";
  dimensions: 1536 | 3072;
  vectorReady: boolean;
};
export type RetrievalCandidate = Omit<SearchHit, "scores" | "snippet"> & {
  content: string;
  tags: string[];
  vectorCosine?: number;
};
type RecallInput = {
  query: string;
  filters?: SearchFilters;
  profile: ActiveProfile;
  limit: number;
};
export interface RetrievalPorts {
  getSettings(): PublicSettings;
  activeProfile(context: ServiceContext): Promise<ActiveProfile | null>;
  readSecret(kind: SecretKind): Promise<string | null>;
  keyword(input: RecallInput, context: ServiceContext): Promise<RetrievalCandidate[]>;
  embedQuery(
    query: string,
    profile: ActiveProfile,
    key: string,
    context: ServiceContext,
  ): Promise<number[]>;
  vector(
    input: RecallInput & { embedding: number[]; oversample: number },
    context: ServiceContext,
  ): Promise<RetrievalCandidate[]>;
  rerank(
    input: { query: string; documents: string[]; topN: number; key: string },
    context: ServiceContext,
  ): Promise<unknown>;
  currentChunkIds(
    candidates: RetrievalCandidate[],
    filters: SearchFilters | undefined,
    context: ServiceContext,
  ): Promise<string[]>;
  logger: SafeLogger;
}

function classified(error: unknown): DomainError {
  return error instanceof DomainError
    ? error
    : new DomainError("PROVIDER_UNAVAILABLE", "检索阶段暂时不可用");
}
function warning(stage: SearchWarning["stage"], error: DomainError): SearchWarning {
  const message =
    error.code === "CONFIG_REQUIRED"
      ? stage === "rerank"
        ? "请配置 Cohere API key，当前使用 RRF 排序"
        : "请配置 OpenRouter API key，当前使用关键词检索"
      : error.code === "PROVIDER_AUTH"
        ? "模型服务鉴权失败，请检查 API key"
        : error.code === "TIMEOUT"
          ? "该检索阶段超时，当前显示可用结果"
          : error.code === "INDEX_NOT_READY"
            ? "向量索引正在建立，当前使用关键词检索"
            : "该检索阶段未完成，当前显示可用结果";
  return {
    stage,
    reason:
      error.code === "CONFIG_REQUIRED"
        ? "not-configured"
        : error.code === "INDEX_NOT_READY"
          ? "index-pending"
          : error.code === "TIMEOUT"
            ? "timeout"
            : "failed",
    message,
  };
}

export function createHybridSearch(ports: RetrievalPorts, options: { budgetMs?: number } = {}) {
  const budgetMs = options.budgetMs ?? 40_000;
  if (!Number.isFinite(budgetMs) || budgetMs < 1)
    throw new DomainError("INVALID_INPUT", "检索时间预算无效");
  return {
    async query(input: SearchRequest, parentContext: ServiceContext): Promise<SearchResponse> {
      const parsed = searchRequestSchema.safeParse(input);
      if (!parsed.success)
        throw new DomainError("INVALID_INPUT", "搜索输入格式或范围无效", "query");
      const settings = publicSettingsSchema.safeParse(structuredClone(ports.getSettings()));
      if (!settings.success)
        throw new DomainError("INVALID_INPUT", "检索设置未通过校验", "retrieval");
      const request = parsed.data;
      const retrieval = settings.data.retrieval;
      const count = request.resultCount ?? retrieval.resultCount;
      const start = performance.now();
      const controller = new AbortController();
      const timeoutError = new DomainError("TIMEOUT", "检索超过总时间预算");
      const cancelledError = new DomainError("CANCELLED", "检索已取消");
      let rejectAbort: ((error: DomainError) => void) | undefined;
      let abortError: DomainError | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      // Always observe the abort promise even if validation fails before the first await.
      void aborted.catch(() => undefined);
      const abort = (error: DomainError) => {
        if (abortError) return;
        abortError = error;
        controller.abort();
        rejectAbort!(error);
      };
      const onCancel = () => abort(cancelledError);
      parentContext.signal.addEventListener("abort", onCancel, { once: true });
      const timer = setTimeout(() => abort(timeoutError), budgetMs);
      const context = { ...parentContext, signal: controller.signal };
      const wait = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted]);
      const timings: SearchResponse["timingsMs"] = { total: 0 };
      const timed = async <T>(
        stage: keyof Omit<SearchResponse["timingsMs"], "total">,
        work: () => Promise<T>,
      ) => {
        const started = performance.now();
        try {
          return await wait(work());
        } finally {
          timings[stage] = performance.now() - started;
        }
      };
      try {
        if (parentContext.signal.aborted) abort(cancelledError);
        if (abortError) throw abortError;
        const profile = await wait(ports.activeProfile(context));
        if (!profile)
          throw new DomainError("INDEX_NOT_READY", "关键词索引尚未建立，请先初始化索引");
        const base = { query: request.query, filters: request.filters, profile };
        const keywordPromise = timed("keyword", () =>
          ports.keyword({ ...base, limit: retrieval.keywordCandidates }, context),
        );
        const vectorPromise = (async () => {
          if (!profile.vectorReady)
            throw new DomainError("INDEX_NOT_READY", "向量索引正在建立，当前使用关键词检索");
          const key = await wait(ports.readSecret("openrouter-api-key"));
          if (!key)
            throw new DomainError(
              "CONFIG_REQUIRED",
              "请配置 OpenRouter API key，当前使用关键词检索",
            );
          const embedding = await timed("embedding", () =>
            ports.embedQuery(request.query, profile, key, context),
          );
          const [validated] = validateEmbeddingBatch(
            { data: [{ index: 0, embedding }] },
            1,
            profile.dimensions,
          );
          return timed("vector", () =>
            ports.vector(
              {
                ...base,
                embedding: validated,
                limit: retrieval.vectorCandidates,
                oversample: retrieval.vectorOversample,
              },
              context,
            ),
          );
        })();
        const [keyword, vector] = await Promise.allSettled([keywordPromise, vectorPromise]);
        if (abortError) throw abortError;
        const warnings: SearchWarning[] = [];
        if (keyword.status === "rejected")
          warnings.push(warning("keyword", classified(keyword.reason)));
        if (vector.status === "rejected")
          warnings.push(
            warning(
              timings.vector === undefined ? "embedding" : "vector",
              classified(vector.reason),
            ),
          );
        if (keyword.status === "rejected" && vector.status === "rejected") {
          throw classified(keyword.reason);
        }
        const fusionStarted = performance.now();
        let fused = fuseRankedCandidates(
          {
            keyword:
              keyword.status === "fulfilled"
                ? keyword.value
                    .slice(0, retrieval.keywordCandidates)
                    .map((item, index) => ({ id: item.chunkId, item, rank: index + 1 }))
                : [],
            vector:
              vector.status === "fulfilled"
                ? vector.value
                    .slice(0, retrieval.vectorCandidates)
                    .map((item, index) => ({ id: item.chunkId, item, rank: index + 1 }))
                : [],
          },
          {
            keywordWeight: retrieval.keywordWeight,
            limit: Math.min(50, Math.max(count, retrieval.rerankCandidates)),
          },
        );
        timings.fusion = performance.now() - fusionStarted;
        if (fused.length) {
          const current = new Set(
            await wait(
              ports.currentChunkIds(
                fused.map((item) => item.item),
                request.filters,
                context,
              ),
            ),
          );
          fused = fused.filter((item) => current.has(item.id));
        }
        let mode: SearchResponse["mode"] =
          keyword.status === "fulfilled" && vector.status === "fulfilled"
            ? "hybrid"
            : keyword.status === "fulfilled"
              ? "keyword"
              : "vector";
        const rerankScores = new Map<string, number>();
        if (mode === "hybrid" && fused.length) {
          if (!retrieval.rerankEnabled)
            warnings.push({
              stage: "rerank",
              reason: "disabled",
              message: "Rerank 已关闭，当前使用 RRF 排序",
            });
          else {
            try {
              const key = await wait(ports.readSecret("cohere-api-key"));
              if (!key)
                throw new DomainError(
                  "CONFIG_REQUIRED",
                  "请配置 Cohere API key，当前使用 RRF 排序",
                );
              const raw = await timed("rerank", () =>
                ports.rerank(
                  {
                    query: request.query,
                    documents: fused.map(
                      (item) =>
                        `${item.item.title}\n${item.item.tags.join(", ")}\n${item.item.content}`,
                    ),
                    topN: Math.min(count, fused.length),
                    key,
                  },
                  context,
                ),
              );
              const mapped = validateRerankResults(
                raw,
                fused.length,
                Math.min(count, fused.length),
              );
              fused = mapped.map((result) => {
                const item = fused[result.index];
                rerankScores.set(item.id, result.score);
                return item;
              });
              mode = "hybrid-rerank";
            } catch (error) {
              if (abortError) throw abortError;
              warnings.push(warning("rerank", classified(error)));
            }
          }
        }
        const verified = new Set(
          fused.length
            ? await wait(
                ports.currentChunkIds(
                  fused.map((item) => item.item),
                  request.filters,
                  context,
                ),
              )
            : [],
        );
        if (abortError) throw abortError;
        const vectorScores = new Map(
          vector.status === "fulfilled"
            ? vector.value.map((item) => [item.chunkId, item.vectorCosine] as const)
            : [],
        );
        const hits = fused
          .filter((item) => verified.has(item.id))
          .slice(0, count)
          .map((item): SearchHit => ({
            chunkId: item.id,
            documentId: item.item.documentId,
            documentRevision: item.item.documentRevision,
            title: item.item.title,
            snippet: Array.from(item.item.content).slice(0, 1600).join(""),
            startLine: item.item.startLine,
            endLine: item.item.endLine,
            updatedAt: item.item.updatedAt,
            scores: {
              rrf: item.rrfScore,
              keywordRank: item.keywordRank,
              vectorRank: item.vectorRank,
              vectorCosine: vectorScores.get(item.id),
              rerank: rerankScores.get(item.id),
            },
          }));
        timings.total = performance.now() - start;
        ports.logger.info("search.completed", {
          requestId: request.requestId,
          count: hits.length,
          durationMs: timings.total,
        });
        const response = searchResponseSchema.safeParse({
          requestId: request.requestId,
          generationId: profile.id,
          mode,
          hits,
          warnings,
          timingsMs: timings,
        });
        if (!response.success)
          throw new DomainError("SCHEMA_MISMATCH", "检索结果来源或分数未通过校验");
        return response.data;
      } finally {
        clearTimeout(timer);
        parentContext.signal.removeEventListener("abort", onCancel);
      }
    },
  };
}
