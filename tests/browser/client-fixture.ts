import { buildSync } from "esbuild";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { ApiErrorCode } from "../../src/lib/contracts";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts";

// Bundle the real contract-backed adapter only into the test page. No test hook
// or fake status logic is included in the shipped renderer.
const bundled = buildSync({
  entryPoints: [resolve("src/lib/client/demo.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "FixtureClient",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;

export async function installClient(
  page: Page,
  options: {
    slowQuery?: string;
    searchError?: ApiErrorCode;
    rerankFailure?: boolean;
    assistantFailure?: boolean;
    assistantReady?: boolean;
    noiseEvents?: boolean;
    failStartOnce?: boolean;
  } = {},
) {
  await page.addInitScript({
    content:
      bundled +
      `\nconst fixtureOptions = ${JSON.stringify(options)};
    if (fixtureOptions.assistantReady && !localStorage.getItem('zhiyu:demo:v1')) {
      const settings = ${JSON.stringify(DEFAULT_SETTINGS)};
      settings.models.chatModel = 'demo/preview';
      const now = new Date().toISOString();
      localStorage.setItem('zhiyu:demo:v1', JSON.stringify({version: 1, collections: [], documents: [{id: 'd0000000-0000-4000-8000-000000000001', collectionId: null, title: '助手资料', contentMarkdown: '山湖资料的原始来源', tags: [], revision: 1, favorite: false, createdAt: now, updatedAt: now, deletedAt: null}], settings, imported: {}, requiresReindex: false, generationId: null}));
    }
    window.desktop = FixtureClient.createDemoClient(localStorage, {
      ...fixtureOptions,
      searchDelayMs: query => query === fixtureOptions.slowQuery ? 1500 : 60,
      ignoreSearchCancel: !!fixtureOptions.slowQuery,
    });
    if (fixtureOptions.assistantReady) window.desktop.secrets.set({requestId: crypto.randomUUID(), payload: {kind: 'openrouter-api-key', value: 'synthetic-fixture-key', persistence: 'session'}});
    const stats = window.fixtureStats = {starts: 0, cancellations: 0, listeners: 0, rebuilds: 0, modelLists: 0, probes: 0};
    const originalRebuild = window.desktop.index.rebuild;
    window.desktop.index.rebuild = request => { stats.rebuilds++; return originalRebuild(request); };
    const originalModelList = window.desktop.models.list;
    window.desktop.models.list = request => { stats.modelLists++; return originalModelList(request); };
    const originalProbe = window.desktop.connections.test;
    window.desktop.connections.test = request => { stats.probes++; return originalProbe(request); };
    const originalStart = window.desktop.assistant.start;
    window.desktop.assistant.start = request => {
      stats.starts++;
      if (fixtureOptions.failStartOnce && stats.starts === 1) return Promise.resolve({ok: false, requestId: request.requestId, error: {code: 'PROVIDER_UNAVAILABLE', message: '模拟服务暂时不可用，请重试。', retryable: true}});
      return originalStart(request);
    };
    const originalCancel = window.desktop.operations.cancel;
    window.desktop.operations.cancel = request => { stats.cancellations++; return originalCancel(request); };
    const originalSubscribe = window.desktop.operations.subscribe;
    window.desktop.operations.subscribe = listener => {
      stats.listeners++;
      const off = originalSubscribe(event => {
        let delivered = event;
        if (fixtureOptions.noiseEvents && event.payload.type === 'context' && event.payload.citations.length) delivered = {...event, payload: {...event.payload, citations: [...event.payload.citations, {...event.payload.citations[0], chunkId: crypto.randomUUID(), title: '伪造来源'}]}};
        listener(delivered);
        if (fixtureOptions.noiseEvents) {
          listener({...event, operationId: crypto.randomUUID(), payload: {type: 'delta', text: '旧操作污染'}});
          listener({...event, payload: {type: 'delta', text: '重复事件污染'}});
          if (event.payload.type === 'completed') listener({...event, seq: event.seq + 1, payload: {type: 'delta', text: '终态后污染'}});
        }
      });
      return () => { stats.listeners--; off(); };
    };`,
  });
}
