import { defineConfig, devices } from "@playwright/test";

const previewPort = process.env.ZHIYU_PREVIEW_PORT ?? "3100";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:" + previewPort,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: '"' + process.execPath + '" scripts/preview.mjs',
    url: "http://127.0.0.1:" + previewPort,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", PORT: previewPort },
  },
});
