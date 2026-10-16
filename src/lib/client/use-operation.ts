"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  operationEventSchema,
  type AssistantStart,
  type Citation,
  type KnowledgeClient,
  type OperationPayload,
  type SearchResponse,
} from "@/lib/contracts";
import { command, readableError, unwrap } from "./result";

type Status =
  "idle" | "starting" | "retrieving" | "streaming" | "completed" | "cancelled" | "failed";
export type OperationState = {
  status: Status;
  text: string;
  search: SearchResponse | null;
  citations: Citation[];
  progress: { completed: number; total: number; failed: number } | null;
  error: string;
};
const initialState: OperationState = {
  status: "idle",
  text: "",
  search: null,
  citations: [],
  progress: null,
  error: "",
};
type ActiveOperation = {
  id: string;
  seq: number;
  terminal: boolean;
  sources: Map<string, Citation>;
};

function validatedCitations(citations: Citation[], sources: Map<string, Citation>) {
  return citations.filter((citation, index) => {
    const source = sources.get(citation.chunkId);
    return (
      source &&
      source.documentId === citation.documentId &&
      source.documentRevision === citation.documentRevision &&
      source.title === citation.title &&
      source.startLine === citation.startLine &&
      source.endLine === citation.endLine &&
      citations.findIndex((item) => item.chunkId === citation.chunkId) === index
    );
  });
}

export function useOperation(client: KnowledgeClient) {
  const [state, setState] = useState(initialState);
  const active = useRef<ActiveOperation | null>(null);
  const subscribed = useRef(false);
  useEffect(() => {
    const unsubscribe = client.operations.subscribe((rawEvent) => {
      const parsed = operationEventSchema.safeParse(rawEvent);
      if (!parsed.success) return;
      const event = parsed.data;
      const operation = active.current;
      if (
        !operation ||
        operation.terminal ||
        event.operationId !== operation.id ||
        event.seq <= operation.seq
      )
        return;
      operation.seq = event.seq;
      const payload: OperationPayload = event.payload;
      if (["completed", "failed", "cancelled"].includes(payload.type)) operation.terminal = true;
      if (payload.type === "context") {
        operation.sources = new Map(
          payload.search.hits.map((hit) => [
            hit.chunkId,
            {
              chunkId: hit.chunkId,
              documentId: hit.documentId,
              documentRevision: hit.documentRevision,
              title: hit.title,
              startLine: hit.startLine,
              endLine: hit.endLine,
            },
          ]),
        );
        const citations = validatedCitations(payload.citations, operation.sources);
        setState((previous) => ({ ...previous, search: payload.search, citations }));
      } else if (payload.type === "retrieving")
        setState((previous) => ({ ...previous, status: "retrieving" }));
      else if (payload.type === "delta")
        setState((previous) => ({
          ...previous,
          status: "streaming",
          text: previous.text + payload.text,
        }));
      else if (payload.type === "progress")
        setState((previous) => ({
          ...previous,
          progress: { completed: payload.completed, total: payload.total, failed: payload.failed },
        }));
      else if (payload.type === "completed") {
        const citations = payload.citations
          ? validatedCitations(payload.citations, operation.sources)
          : null;
        setState((previous) => ({
          ...previous,
          status: "completed",
          text: payload.text ?? previous.text,
          citations: citations ?? previous.citations,
        }));
      } else if (payload.type === "failed")
        setState((previous) => ({ ...previous, status: "failed", error: payload.error.message }));
      else if (payload.type === "cancelled")
        setState((previous) => ({ ...previous, status: "cancelled" }));
    });
    subscribed.current = true;
    return () => {
      subscribed.current = false;
      const operation = active.current;
      active.current = null;
      unsubscribe();
      if (operation && !operation.terminal)
        void client.operations
          .cancel(command({ operationId: operation.id }))
          .catch(() => undefined);
    };
  }, [client]);

  const start = useCallback(
    async (input: { kind: "assistant"; payload: AssistantStart } | { kind: "reindex" }) => {
      if (!subscribed.current || (active.current && !active.current.terminal)) return false;
      const requestId = crypto.randomUUID();
      active.current = { id: requestId, seq: 0, terminal: false, sources: new Map() };
      setState({ ...initialState, status: "starting" });
      try {
        const result = await (input.kind === "assistant"
          ? client.assistant.start({ requestId, payload: input.payload })
          : client.index.rebuild({ requestId, payload: {} }));
        const accepted = unwrap(result);
        if (result.requestId !== requestId || accepted.operationId !== requestId)
          throw new Error("Unexpected operation acceptance");
        return true;
      } catch (error) {
        const operation = active.current;
        if (operation?.id === requestId && !operation.terminal) {
          operation.terminal = true;
          setState((previous) => ({ ...previous, status: "failed", error: readableError(error) }));
          void client.operations.cancel(command({ operationId: requestId })).catch(() => undefined);
        }
        return false;
      }
    },
    [client],
  );

  const cancel = useCallback(async () => {
    const operation = active.current;
    if (!operation || operation.terminal) return;
    try {
      unwrap(await client.operations.cancel(command({ operationId: operation.id })));
      if (active.current === operation && !operation.terminal) {
        operation.terminal = true;
        setState((previous) => ({ ...previous, status: "cancelled" }));
      }
    } catch (error) {
      if (active.current === operation && !operation.terminal)
        setState((previous) => ({ ...previous, error: readableError(error) }));
    }
  }, [client]);
  const clearError = useCallback(() => setState((previous) => ({ ...previous, error: "" })), []);
  return {
    state,
    start,
    cancel,
    clearError,
    running: ["starting", "retrieving", "streaming"].includes(state.status),
  };
}
