import { Embeddings } from "@langchain/core/embeddings";
import { validateEmbeddingBatch } from "../../../../src/lib/domain/vectors";
import { DomainError } from "../../../../src/lib/domain/validation";
import type { TokenCounter } from "../../../../src/lib/domain/chunking";
import { large3TokenCounter } from "./tokenizer";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number, signal: AbortSignal) => Promise<void>;
type EmbeddingOptions = {
  apiKey: string;
  dimensions: 1536 | 3072;
  fetch?: FetchLike;
  counter?: TokenCounter;
  maxBatch?: number;
  maxBatchTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: SleepLike;
  random?: () => number;
  beforeRequest?: () => void;
};

const MODEL = "openai/text-embedding-3-large";
const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";

function providerStatus(status: number): DomainError {
  if (status === 401 || status === 403)
    return new DomainError("PROVIDER_AUTH", "OpenRouter 鉴权失败，请检查 API key");
  if (status === 404 || status === 400)
    return new DomainError("MODEL_UNSUPPORTED", "OpenRouter embedding 模型或维度不可用");
  if (status === 408) return new DomainError("TIMEOUT", "OpenRouter 请求超时");
  if (status === 402 || status === 429)
    return new DomainError("PROVIDER_LIMIT", "OpenRouter 请求达到限额，请稍后重试");
  return new DomainError("PROVIDER_UNAVAILABLE", "OpenRouter 暂时不可用，请稍后重试");
}

function stopped(input: AbortSignal): DomainError {
  return new DomainError(
    input.aborted ? "CANCELLED" : "TIMEOUT",
    input.aborted ? "OpenRouter 请求已取消" : "OpenRouter 请求超时",
  );
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class OpenRouterEmbeddings extends Embeddings {
  private readonly options: EmbeddingOptions & {
    maxBatch: number;
    maxBatchTokens: number;
    timeoutMs: number;
    maxRetries: number;
  };

  constructor(options: EmbeddingOptions) {
    super({ maxConcurrency: 2, maxRetries: 0 });
    if (!options.apiKey.trim() || ![1536, 3072].includes(options.dimensions))
      throw new DomainError("INVALID_INPUT", "OpenRouter embedding 配置无效");
    const timeoutMs = options.timeoutMs ?? 20_000;
    const maxRetries = options.maxRetries ?? 2;
    const maxBatch = options.maxBatch ?? 16;
    const maxBatchTokens = options.maxBatchTokens ?? 8_192;
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isInteger(maxRetries) ||
      maxRetries < 0 ||
      maxRetries > 2 ||
      !Number.isInteger(maxBatch) ||
      maxBatch < 1 ||
      maxBatch > 16 ||
      !Number.isInteger(maxBatchTokens) ||
      maxBatchTokens < 1
    )
      throw new DomainError("INVALID_INPUT", "OpenRouter embedding 批次或超时配置无效");
    this.options = { ...options, timeoutMs, maxRetries, maxBatch, maxBatchTokens };
  }

  async embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== "string"))
      throw new DomainError("INVALID_INPUT", "embedding 输入必须是文本数组");
    if (!texts.length) return [];
    const batches: string[][] = [];
    const counter = this.options.counter ?? large3TokenCounter();
    let batch: string[] = [];
    let tokens = 0;
    for (const text of texts) {
      const count = counter.count(text);
      if (
        !text.trim() ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > Math.min(8192, this.options.maxBatchTokens)
      )
        throw new DomainError("INVALID_INPUT", "embedding 单段 token 数超出 provider 上限");
      if (
        batch.length &&
        (batch.length >= this.options.maxBatch || tokens + count > this.options.maxBatchTokens)
      ) {
        batches.push(batch);
        batch = [];
        tokens = 0;
      }
      batch.push(text);
      tokens += count;
    }
    if (batch.length) batches.push(batch);
    const output = new Array<number[]>(texts.length);
    const group = new AbortController();
    const forwardAbort = () => group.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) group.abort();
    let firstFailure: unknown;
    let failed = false;
    let next = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= batches.length) return;
        let vectors: number[][];
        try {
          vectors = await this.request(batches[index], group.signal);
        } catch (error) {
          if (!failed) {
            failed = true;
            firstFailure = error;
          }
          group.abort();
          throw error;
        }
        const offset = batches.slice(0, index).reduce((sum, current) => sum + current.length, 0);
        vectors.forEach((vector, item) => {
          output[offset + item] = vector;
        });
      }
    };
    try {
      await Promise.allSettled([worker(), worker()]);
      if (failed) throw firstFailure;
      return output;
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
    const result = await this.embedDocuments([text], signal);
    return result[0];
  }

  private async request(texts: string[], parent: AbortSignal): Promise<number[][]> {
    const options = this.options;
    if (parent.aborted) throw new DomainError("CANCELLED", "OpenRouter 请求已取消");
    const fetcher = options.fetch ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const random = options.random ?? Math.random;
    const controller = new AbortController();
    const forward = () => controller.abort(stopped(parent));
    parent.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => controller.abort(stopped(parent)), options.timeoutMs);
    const check = () => {
      if (parent.aborted || controller.signal.aborted) throw stopped(parent);
    };
    const wait = <T>(action: () => Promise<T>): Promise<T> => {
      check();
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(stopped(parent));
        controller.signal.addEventListener("abort", abort, { once: true });
        Promise.resolve()
          .then(() => {
            check();
            return action();
          })
          .then(
            (value) => {
              controller.signal.removeEventListener("abort", abort);
              resolve(value);
            },
            (error: unknown) => {
              controller.signal.removeEventListener("abort", abort);
              reject(error);
            },
          );
      });
    };
    try {
      let attempt = 0;
      while (true) {
        check();
        options.beforeRequest?.();
        let response: Response;
        try {
          response = await wait(() =>
            fetcher(ENDPOINT, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${options.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: MODEL,
                input: texts,
                dimensions: options.dimensions,
                encoding_format: "float",
              }),
              signal: controller.signal,
            }),
          );
        } catch {
          check();
          if (attempt >= options.maxRetries)
            throw new DomainError("PROVIDER_UNAVAILABLE", "OpenRouter 网络请求失败，请稍后重试");
          await wait(() =>
            sleep(Math.min(2_000, 200 * 2 ** attempt + random() * 100), controller.signal),
          );
          attempt++;
          continue;
        }
        if (!response.ok) {
          if (
            !(
              [408, 425, 429].includes(response.status) ||
              (response.status >= 500 && response.status < 600)
            ) ||
            attempt >= options.maxRetries
          )
            throw providerStatus(response.status);
          await wait(() =>
            sleep(Math.min(2_000, 200 * 2 ** attempt + random() * 100), controller.signal),
          );
          attempt++;
          continue;
        }
        let body: unknown;
        try {
          body = await wait(() => response.json());
        } catch {
          check();
          throw new DomainError("SCHEMA_MISMATCH", "OpenRouter embedding 响应格式无效");
        }
        return validateEmbeddingBatch(body, texts.length, options.dimensions);
      }
    } finally {
      clearTimeout(timer);
      parent.removeEventListener("abort", forward);
    }
  }
}

export function createOpenRouterEmbeddings(options: EmbeddingOptions): OpenRouterEmbeddings {
  return new OpenRouterEmbeddings(options);
}
