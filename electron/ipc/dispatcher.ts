import { randomUUID } from "node:crypto";
import {
  requestSchemas,
  responseSchemas,
  uuidSchema,
  LIMITS,
  type ApiResult,
  type IpcChannel,
  type ParsedRequestFor,
  type ResponseFor,
  type SafeLogger,
} from "../../src/lib/contracts";
import { PlatformError, toPublicError } from "../platform/errors";
import { SenderGate, type InvocationSource } from "./sender";

export type Handler<C extends IpcChannel> = (
  request: ParsedRequestFor<C>,
  ownerId: string,
) => ResponseFor<C> | Promise<ResponseFor<C>>;
export type HandlerMap = { [C in IpcChannel]: Handler<C> };

export class IpcDispatcher {
  private readonly handlers = new Map<
    string,
    (input: unknown, ownerId: string) => Promise<unknown>
  >();
  constructor(
    private readonly gate: SenderGate,
    handlers: HandlerMap,
    private readonly logger: SafeLogger,
  ) {
    const register = <C extends IpcChannel>(channel: C, handler: Handler<C>) => {
      this.handlers.set(channel, async (input, ownerId) => {
        const request = requestSchemas[channel].parse(input) as ParsedRequestFor<C>;
        const value = await handler(request, ownerId);
        const response = responseSchemas[channel].safeParse(value);
        if (!response.success) throw new PlatformError("INTERNAL");
        return response.data;
      });
    };
    for (const channel of Object.keys(requestSchemas) as IpcChannel[])
      register(channel, handlers[channel]);
  }
  async invoke(
    channel: string,
    source: InvocationSource,
    input: unknown,
  ): Promise<ApiResult<unknown>> {
    const candidate =
      typeof input === "object" && input !== null && "requestId" in input
        ? input.requestId
        : undefined;
    const id = uuidSchema.safeParse(candidate);
    const requestId = id.success ? id.data : randomUUID();
    try {
      const ownerId = this.gate.authorize(source);
      const handler = this.handlers.get(channel);
      if (!handler) throw new PlatformError("INVALID_INPUT");
      // Bound the clone before schema transformations or service calls. Never log this serialized value.
      const serialized = JSON.stringify(input);
      if (
        !serialized ||
        serialized.length > LIMITS.importBytes + 4096 ||
        Buffer.byteLength(serialized, "utf8") > LIMITS.importBytes + 4096
      )
        throw new PlatformError("INVALID_INPUT");
      return { ok: true, requestId, value: await handler(input, ownerId) };
    } catch (error) {
      const publicError = toPublicError(error);
      this.logger.warn("ipc.rejected", { requestId, code: publicError.code });
      return { ok: false, requestId, error: publicError };
    }
  }
}
