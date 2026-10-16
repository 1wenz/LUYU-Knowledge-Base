import type {
  AssistantStart,
  Collection,
  CollectionSave,
  Document,
  DocumentMutation,
  DocumentPage,
  ListDocuments,
  SaveDocument,
  BatchImport,
  ImportReport,
  SearchRequest,
  SearchResponse,
  PublicSettings,
  SecretKind,
  OperationEvent,
  OperationPayload,
  IndexStatus,
  ChatModelInfo,
  ConnectionTarget,
  ConnectionReport,
} from "./schemas";

export type ServiceContext = { ownerId: string; signal: AbortSignal };
export type OperationContext = ServiceContext & {
  operationId: string;
  emit(payload: OperationPayload): void;
};
// Logging deliberately accepts only diagnostics, never arbitrary objects or provider errors.
export type Diagnostic = { requestId?: string; code?: string; durationMs?: number; count?: number };
export interface SafeLogger {
  info(event: string, detail?: Diagnostic): void;
  warn(event: string, detail?: Diagnostic): void;
  error(event: string, detail?: Diagnostic): void;
}
export type KnowledgeServiceDependencies = {
  getSettings(): PublicSettings;
  readSecret(kind: SecretKind): Promise<string | null>;
  emit(ownerId: string, event: OperationEvent): void;
  logger: SafeLogger;
  now(): Date;
  createId(): string;
};
export interface KnowledgeService {
  collections: {
    list(context: ServiceContext): Promise<Collection[]>;
    save(input: CollectionSave, context: ServiceContext): Promise<Collection>;
    remove(id: string, context: ServiceContext): Promise<{ removed: true }>;
  };
  documents: {
    list(input: ListDocuments, context: ServiceContext): Promise<DocumentPage>;
    get(id: string, context: ServiceContext): Promise<Document>;
    save(input: SaveDocument, context: ServiceContext): Promise<Document>;
    setFavorite(
      input: DocumentMutation & { favorite: boolean },
      context: ServiceContext,
    ): Promise<Document>;
    remove(input: DocumentMutation, context: ServiceContext): Promise<Document>;
    restore(input: DocumentMutation, context: ServiceContext): Promise<Document>;
    import(input: BatchImport, context: ServiceContext): Promise<ImportReport>;
  };
  search: { query(input: SearchRequest, context: ServiceContext): Promise<SearchResponse> };
  models: { list(context: ServiceContext): Promise<ChatModelInfo[]> };
  connections: {
    test(target: ConnectionTarget, context: ServiceContext): Promise<ConnectionReport>;
  };
  index: {
    status(context: ServiceContext): Promise<IndexStatus>;
    rebuild(context: OperationContext): Promise<void>;
  };
  assistant: { start(input: AssistantStart, context: OperationContext): Promise<void> };
  applySettings(previous: PublicSettings, next: PublicSettings): Promise<void>;
  dispose(): Promise<void>;
}
export type KnowledgeServiceFactory = (
  deps: KnowledgeServiceDependencies,
) => KnowledgeService | Promise<KnowledgeService>;
