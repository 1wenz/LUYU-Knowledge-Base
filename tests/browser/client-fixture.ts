import { buildSync } from "esbuild";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { ApiErrorCode } from "../../src/lib/contracts";

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
  } = {},
) {
  await page.addInitScript({
    content:
      bundled +
      `\nconst fixtureOptions = ${JSON.stringify(options)};
    window.desktop = FixtureClient.createDemoClient(localStorage, {
      ...fixtureOptions,
      searchDelayMs: query => query === fixtureOptions.slowQuery ? 1500 : 60,
      ignoreSearchCancel: !!fixtureOptions.slowQuery,
    });`,
  });
}
