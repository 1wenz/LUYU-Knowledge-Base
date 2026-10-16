import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AppInfo,
  KnowledgeServiceFactory,
  OperationEvent,
  PickedTextFiles,
  ServiceContext,
  SettingsView,
  PublicSettings,
} from "../src/lib/contracts";
import type { HandlerMap } from "./ipc/dispatcher";
import { SettingsStore, databaseSettingsChanged } from "./platform/settings";
import { SecretStore, type Encryption } from "./platform/secrets";
import { SerialQueue } from "./platform/files";
import { createSafeLogger, toPublicError, PlatformError } from "./platform/errors";
import { OperationRegistry } from "./platform/operations";
import { validateExternalUrl } from "./platform/security";
import { createUnavailableKnowledgeService } from "./platform/unavailable-service";

export type PlatformDependencies = {
  userData: string;
  encryption: Encryption;
  info: AppInfo;
  send(ownerId: string, event: OperationEvent): void;
  openExternal(url: string): Promise<void>;
  pickTextFiles(ownerId: string): Promise<PickedTextFiles>;
  createKnowledgeService?: KnowledgeServiceFactory;
};
export async function createPlatform(deps: PlatformDependencies) {
  const logger = createSafeLogger();
  const settings = await SettingsStore.open(join(deps.userData, "settings.json"));
  const secrets = await SecretStore.open(join(deps.userData, "credentials.json"), deps.encryption);
  const operations = new OperationRegistry(deps.send);
  let epoch = 0;
  let applying = false;
  let available = true;
  const configurationQueue = new SerialQueue();
  const factory: KnowledgeServiceFactory =
    deps.createKnowledgeService ?? (() => createUnavailableKnowledgeService());
  const service = await factory({
    getSettings: () => settings.get(),
    readSecret: (kind) => secrets.read(kind),
    emit: (ownerId, event) => operations.acceptServiceEvent(ownerId, event),
    logger,
    now: () => new Date(),
    createId: randomUUID,
  });
  if (!deps.createKnowledgeService) logger.warn("service.unavailable", { code: "CONFIG_REQUIRED" });
  const run = <T>(
    ownerId: string,
    requestId: string,
    work: (context: ServiceContext) => Promise<T>,
    kind: "call" | "search" = "call",
  ) => {
    if (applying || !available) throw new PlatformError("DATABASE_UNAVAILABLE");
    const startedEpoch = epoch;
    return operations.run(ownerId, requestId, kind, async (context) => {
      const result = await work(context);
      if (epoch !== startedEpoch || context.signal.aborted) throw new PlatformError("CANCELLED");
      return result;
    });
  };
  async function settingsView(ownerId: string): Promise<SettingsView> {
    let activeGenerationId: string | null = null;
    let requiresReindex = settings.requiresReindex();
    const statusId = randomUUID();
    const timeout = setTimeout(() => operations.cancel(ownerId, statusId), 5000);
    try {
      const status = await run(ownerId, statusId, (context) => service.index.status(context));
      activeGenerationId = status.activeGenerationId;
      requiresReindex ||= status.requiresReindex;
    } catch {
      /* Settings remain editable when the explicit index/connection endpoint reports unavailable. */
    } finally {
      clearTimeout(timeout);
    }
    return {
      settings: settings.get(),
      secrets: secrets.status(),
      index: { activeGenerationId, requiresReindex },
    };
  }
  async function apply(previous: PublicSettings, next: PublicSettings, forceConnection = false) {
    if (forceConnection || databaseSettingsChanged(previous, next)) {
      epoch++;
      operations.cancelConnection();
    }
    applying = true;
    try {
      await service.applySettings(previous, next);
      available = true;
    } catch (error) {
      available = false;
      logger.error("provider.failure", { code: toPublicError(error).code });
    } finally {
      applying = false;
    }
  }
  const handlers: HandlerMap = {
    "system:get-info": () => deps.info,
    "system:open-external": async ({ payload }) => {
      await deps.openExternal(validateExternalUrl(payload.url));
      return { opened: true };
    },
    "system:pick-text-files": (_request, ownerId) => deps.pickTextFiles(ownerId),
    "collections:list": (request, owner) =>
      run(owner, request.requestId, (context) => service.collections.list(context)),
    "collections:save": (request, owner) =>
      run(owner, request.requestId, (context) =>
        service.collections.save(request.payload, context),
      ),
    "collections:remove": (request, owner) =>
      run(owner, request.requestId, (context) =>
        service.collections.remove(request.payload.id, context),
      ),
    "documents:list": (request, owner) =>
      run(owner, request.requestId, (context) => service.documents.list(request.payload, context)),
    "documents:get": (request, owner) =>
      run(owner, request.requestId, (context) =>
        service.documents.get(request.payload.id, context),
      ),
    "documents:save": (request, owner) =>
      run(owner, request.requestId, (context) => service.documents.save(request.payload, context)),
    "documents:set-favorite": (request, owner) =>
      run(owner, request.requestId, (context) =>
        service.documents.setFavorite(request.payload, context),
      ),
    "documents:remove": (request, owner) =>
      run(owner, request.requestId, (context) =>
        service.documents.remove(request.payload, context),
      ),
    "documents:restore": (request, owner) =>
      run(owner, request.requestId, (context) =>
        service.documents.restore(request.payload, context),
      ),
    "documents:import": (request, owner) =>
      run(owner, request.requestId, (context) =>
        service.documents.import(request.payload, context),
      ),
    "search:query": async (request, owner) => {
      const response = await run(
        owner,
        request.requestId,
        (context) => service.search.query(request, context),
        "search",
      );
      return {
        ...response,
        warnings: response.warnings.map((warning) => ({
          ...warning,
          message: `检索阶段 ${warning.stage}：${warning.reason}。`,
        })),
      };
    },
    "search:cancel": ({ payload }, owner) => ({
      cancelled: operations.cancel(owner, payload.requestIdToCancel),
    }),
    "settings:get": (_request, owner) => settingsView(owner),
    "settings:update": (request, owner) =>
      configurationQueue.run(async () => {
        await settings.update(request.payload, (previous, next) => apply(previous, next));
        logger.info("settings.updated", { requestId: request.requestId });
        return settingsView(owner);
      }),
    "secrets:set": (request) =>
      configurationQueue.run(async () => {
        const status = await secrets.set(request.payload);
        const snapshot = settings.get();
        await apply(snapshot, snapshot, true);
        return status;
      }),
    "secrets:delete": (request) =>
      configurationQueue.run(async () => {
        const status = await secrets.delete(request.payload.kind);
        const snapshot = settings.get();
        await apply(snapshot, snapshot, true);
        return status;
      }),
    "connections:test": async (request, owner) => {
      const report = await run(owner, request.requestId, (context) =>
        service.connections.test(request.payload.target, context),
      );
      return {
        ...report,
        message: report.ok ? "连接验证成功。" : "连接验证失败，请检查设置和凭据。",
      };
    },
    "models:list": (request, owner) =>
      run(owner, request.requestId, (context) => service.models.list(context)),
    "index:status": (request, owner) =>
      run(owner, request.requestId, (context) => service.index.status(context)),
    "index:rebuild": (request, owner) => {
      if (applying || !available) throw new PlatformError("DATABASE_UNAVAILABLE");
      return operations.start(owner, request.requestId, "reindex", async (context) => {
        await service.index.rebuild(context);
        if (!context.signal.aborted) settings.clearReindex();
      });
    },
    "assistant:start": (request, owner) => {
      if (applying || !available) throw new PlatformError("DATABASE_UNAVAILABLE");
      return operations.start(owner, request.requestId, "assistant", (context) =>
        service.assistant.start(request.payload, context),
      );
    },
    "operations:cancel": ({ payload }, owner) => ({
      cancelled: operations.cancel(owner, payload.operationId),
    }),
  };
  return {
    handlers,
    logger,
    operations,
    async dispose() {
      operations.dispose();
      await configurationQueue.run(async () => {
        await service.dispose();
        secrets.dispose();
      });
    },
  };
}
