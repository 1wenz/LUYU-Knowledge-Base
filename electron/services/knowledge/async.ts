import { DomainError } from "../../../src/lib/domain/validation";

export function withAbort<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  const cancelled = () => new DomainError("CANCELLED", "操作已取消");
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw cancelled();
        return action();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}

export function deadline(parent: AbortSignal, timeoutMs: number, label: string) {
  const controller = new AbortController();
  let reason: DomainError | undefined;
  const stop = (code: "CANCELLED" | "TIMEOUT") => {
    if (reason) return;
    reason = new DomainError(code, code === "CANCELLED" ? `${label}已取消` : `${label}超时`);
    controller.abort(reason);
  };
  const forward = () => stop("CANCELLED");
  parent.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
  if (parent.aborted) forward();
  const check = () => {
    if (reason) throw reason;
  };
  return {
    signal: controller.signal,
    check,
    wait<T>(action: () => Promise<T>): Promise<T> {
      check();
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(reason);
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
    },
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", forward);
      controller.abort();
    },
  };
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DomainError("CANCELLED", "操作已取消"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
