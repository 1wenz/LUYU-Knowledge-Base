import { DomainError } from "../../../../src/lib/domain/validation";
import { validateRerankResults } from "../../../../src/lib/domain/vectors";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type RerankInput = {
  query: string;
  documents: string[];
  topN: number;
  key: string;
  signal: AbortSignal;
};

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
function sanitizedStatus(status: number): DomainError {
  if (status === 401 || status === 403)
    return new DomainError("PROVIDER_AUTH", "Cohere 鉴权失败，请检查 API key");
  if (status === 429) return new DomainError("PROVIDER_LIMIT", "Cohere 请求达到限额，请稍后重试");
  if (status === 408) return new DomainError("TIMEOUT", "Cohere 请求超时");
  return new DomainError("PROVIDER_UNAVAILABLE", "Cohere 暂时不可用，请稍后重试");
}

export function createCohereReranker(
  options: {
    fetch?: FetchLike;
    timeoutMs?: number;
    maxRetries?: number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    random?: () => number;
    beforeRequest?: () => void;
  } = {},
) {
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 2;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > 2
  )
    throw new DomainError("INVALID_INPUT", "Cohere 超时或重试配置无效");
  const sleep =
    options.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
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
      }));
  const random = options.random ?? Math.random;
  return {
    async rerank(input: RerankInput) {
      if (input.documents.length === 0) return { results: [] };
      if (
        input.documents.length > 50 ||
        !Number.isInteger(input.topN) ||
        input.topN < 1 ||
        input.topN > input.documents.length
      )
        throw new DomainError("INVALID_INPUT", "Rerank 参数无效");
      if (!input.key.trim()) throw new DomainError("PROVIDER_AUTH", "请先配置 Cohere API key");
      if (input.signal.aborted) throw new DomainError("CANCELLED", "Cohere 请求已取消");
      const controller = new AbortController();
      const stoppedError = () =>
        new DomainError(
          input.signal.aborted ? "CANCELLED" : "TIMEOUT",
          input.signal.aborted ? "Cohere 请求已取消" : "Cohere 请求超时",
        );
      const forwardAbort = () => controller.abort(stoppedError());
      input.signal.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(stoppedError()), timeoutMs);
      const checkStopped = () => {
        if (input.signal.aborted || controller.signal.aborted) throw stoppedError();
      };
      // SDK/fetch implementations may ignore AbortSignal; bound every asynchronous stage.
      const wait = <T>(action: () => Promise<T>): Promise<T> => {
        checkStopped();
        return new Promise<T>((resolve, reject) => {
          const abort = () => reject(stoppedError());
          controller.signal.addEventListener("abort", abort, { once: true });
          Promise.resolve()
            .then(() => {
              checkStopped();
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
          checkStopped();
          options.beforeRequest?.();
          let response: Response;
          try {
            response = await wait(() =>
              fetcher("https://api.cohere.com/v2/rerank", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${input.key}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "rerank-v3.5",
                  query: input.query,
                  documents: input.documents,
                  top_n: input.topN,
                }),
                signal: controller.signal,
              }),
            );
          } catch {
            checkStopped();
            if (attempt >= maxRetries)
              throw new DomainError("PROVIDER_UNAVAILABLE", "Cohere 网络请求失败，请稍后重试");
            await wait(() =>
              sleep(Math.min(2_000, 200 * 2 ** attempt + random() * 100), controller.signal),
            );
            attempt++;
            continue;
          }
          if (!response.ok) {
            if (!retryableStatus(response.status) || attempt >= maxRetries)
              throw sanitizedStatus(response.status);
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
            checkStopped();
            throw new DomainError("SCHEMA_MISMATCH", "Cohere 响应格式无效");
          }
          const results = validateRerankResults(body, input.documents.length, input.topN);
          return {
            results: results.map((result) => ({
              index: result.index,
              relevance_score: result.score,
            })),
          };
        }
      } finally {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", forwardAbort);
      }
    },
  };
}
