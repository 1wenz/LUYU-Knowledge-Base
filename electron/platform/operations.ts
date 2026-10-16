import {
  LIMITS,
  operationEventSchema,
  operationPayloadSchema,
  utf8Bytes,
  type OperationAccepted,
  type OperationContext,
  type OperationEvent,
  type OperationPayload,
  type ServiceContext,
} from "../../src/lib/contracts";
import { PlatformError, toPublicError } from "./errors";

type Kind = "call" | "search" | "assistant" | "reindex";
type RecordState = {
  ownerId: string;
  id: string;
  kind: Kind;
  controller: AbortController;
  seq: number;
  done: boolean;
  pendingDelta: string;
  terminal?: OperationPayload;
  timer?: ReturnType<typeof setTimeout>;
  serviceSeq: number;
};
const terminals = new Set(["completed", "failed", "cancelled"]);
export class OperationRegistry {
  private readonly records = new Map<string, RecordState>();
  constructor(private readonly sink: (ownerId: string, event: OperationEvent) => void) {}
  private register(ownerId: string, id: string, kind: Kind): RecordState {
    if (
      this.records.has(id) ||
      [...this.records.values()].filter((record) => record.ownerId === ownerId).length >= 4096
    )
      throw new PlatformError("CONFLICT");
    const active = [...this.records.values()].filter((record) => !record.done);
    if (active.filter((record) => record.ownerId === ownerId).length >= 32)
      throw new PlatformError("CONFLICT");
    if (
      kind === "assistant" &&
      active.some((record) => record.ownerId === ownerId && record.kind === kind)
    )
      throw new PlatformError("CONFLICT");
    if (kind === "reindex" && active.some((record) => record.kind === kind))
      throw new PlatformError("CONFLICT");
    if (kind === "search")
      for (const record of active)
        if (record.ownerId === ownerId && record.kind === kind) this.cancelRecord(record);
    const record: RecordState = {
      ownerId,
      id,
      kind,
      controller: new AbortController(),
      seq: 0,
      done: false,
      pendingDelta: "",
      serviceSeq: 0,
    };
    this.records.set(id, record);
    return record;
  }
  private send(record: RecordState, payload: OperationPayload): void {
    if (record.done) return;
    const event = operationEventSchema.parse({
      operationId: record.id,
      seq: ++record.seq,
      payload,
    });
    if (terminals.has(payload.type)) {
      record.done = true;
      record.terminal = undefined;
      record.pendingDelta = "";
      if (record.timer) clearTimeout(record.timer);
    }
    try {
      this.sink(record.ownerId, event);
    } catch {
      record.done = true;
      record.controller.abort();
      if (record.timer) clearTimeout(record.timer);
    }
  }
  private flush(record: RecordState): void {
    record.timer = undefined;
    if (record.done) return;
    if (record.pendingDelta) {
      let bytes = 0;
      let length = 0;
      for (const character of record.pendingDelta) {
        const size = utf8Bytes(character);
        if (bytes + size > LIMITS.deltaBytes) break;
        bytes += size;
        length += character.length;
      }
      const text = record.pendingDelta.slice(0, length);
      record.pendingDelta = record.pendingDelta.slice(length);
      this.send(record, { type: "delta", text });
    }
    if (record.pendingDelta) this.schedule(record);
    else if (record.terminal) this.send(record, record.terminal);
  }
  private schedule(record: RecordState): void {
    if (!record.timer && !record.done) record.timer = setTimeout(() => this.flush(record), 50);
  }
  private emit(record: RecordState, input: OperationPayload): void {
    if (record.done || record.terminal) return;
    const payload = operationPayloadSchema.parse(input);
    if (payload.type === "started") throw new PlatformError("INVALID_INPUT");
    if (payload.type === "failed") payload.error = toPublicError(payload.error);
    if (payload.type === "context")
      payload.search.warnings = payload.search.warnings.map((warning) => ({
        ...warning,
        message: `检索阶段 ${warning.stage}：${warning.reason}。`,
      }));
    if (payload.type === "delta") {
      record.pendingDelta += payload.text;
      if (utf8Bytes(record.pendingDelta) > 256 * 1024) {
        this.cancelRecord(record);
        return;
      }
      this.schedule(record);
    } else if (terminals.has(payload.type)) {
      record.terminal = payload;
      if (record.pendingDelta) this.schedule(record);
      else this.send(record, payload);
    } else this.send(record, payload);
  }
  start(
    ownerId: string,
    id: string,
    kind: "assistant" | "reindex",
    work: (context: OperationContext) => Promise<void>,
  ): OperationAccepted {
    const record = this.register(ownerId, id, kind);
    this.send(record, { type: "started", kind });
    void Promise.resolve()
      .then(() => {
        if (record.controller.signal.aborted) return;
        return work({
          ownerId,
          operationId: id,
          signal: record.controller.signal,
          emit: (payload) => this.emit(record, payload),
        });
      })
      .then(
        () => this.emit(record, { type: "completed" }),
        (error: unknown) => this.emit(record, { type: "failed", error: toPublicError(error) }),
      );
    return { operationId: id };
  }
  acceptServiceEvent(ownerId: string, input: OperationEvent): void {
    const event = operationEventSchema.parse(input);
    const record = this.records.get(event.operationId);
    if (!record || record.ownerId !== ownerId) throw new PlatformError("UNAUTHORIZED");
    if (event.seq !== record.serviceSeq + 1) throw new PlatformError("CONFLICT");
    record.serviceSeq = event.seq;
    this.emit(record, event.payload);
  }
  async run<T>(
    ownerId: string,
    id: string,
    kind: "call" | "search",
    work: (context: ServiceContext) => Promise<T>,
  ): Promise<T> {
    const record = this.register(ownerId, id, kind);
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new PlatformError("CANCELLED"));
      record.controller.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([
        work({ ownerId, signal: record.controller.signal }),
        cancelled,
      ]);
      if (record.controller.signal.aborted) throw new PlatformError("CANCELLED");
      return result;
    } finally {
      record.controller.signal.removeEventListener("abort", abort);
      record.done = true;
      if (kind === "call" && this.records.get(id) === record) this.records.delete(id);
    }
  }
  private cancelRecord(record: RecordState): boolean {
    if (record.done) return false;
    record.controller.abort();
    record.pendingDelta = "";
    record.terminal = undefined;
    if (record.timer) clearTimeout(record.timer);
    if (record.kind === "assistant" || record.kind === "reindex")
      this.send(record, { type: "cancelled" });
    else record.done = true;
    return true;
  }
  cancel(ownerId: string, id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.ownerId !== ownerId) throw new PlatformError("UNAUTHORIZED");
    return this.cancelRecord(record);
  }
  cancelConnection(): void {
    for (const record of this.records.values()) this.cancelRecord(record);
  }
  cancelOwner(ownerId: string): void {
    for (const [id, record] of this.records)
      if (record.ownerId === ownerId) {
        this.cancelRecord(record);
        this.records.delete(id);
      }
  }
  dispose(): void {
    this.cancelConnection();
    this.records.clear();
  }
}
