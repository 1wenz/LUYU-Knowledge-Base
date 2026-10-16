import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    "out/**",
    "dist-electron/**",
    "release/**",
    "next-env.d.ts",
    ".cache/**",
    ".runtime/**",
    "tools/**",
    ".prime-agent/**",
    ".nausicaa/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    files: ["electron-builder.config.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
