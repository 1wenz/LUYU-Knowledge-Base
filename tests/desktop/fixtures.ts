import { _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts";

export async function desktopFixture(existingUserData?: string) {
  const root = resolve(".cache/desktop-tests");
  await mkdir(root, { recursive: true });
  const userData = existingUserData ?? (await mkdtemp(join(root, "user-")));
  if (!existingUserData) {
    const missingDatabase = `zhiyu_desktop_missing_${randomUUID().replaceAll("-", "")}`;
    await writeFile(
      join(userData, "settings.json"),
      JSON.stringify({
        ...structuredClone(DEFAULT_SETTINGS),
        database: {
          ...DEFAULT_SETTINGS.database,
          port: 1,
          database: missingDatabase,
          user: missingDatabase,
        },
      }),
      { encoding: "utf8", flag: "wx" },
    );
  }
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  env.ZHIYU_TEST_MODE = "1";
  env.ZHIYU_TEST_USER_DATA = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const executablePath = process.env.ZHIYU_PACKAGE_EXE;
  const scale = process.env.ZHIYU_TEST_SCALE_FACTOR;
  if (scale && !["1", "1.25"].includes(scale)) throw new Error("桌面测试缩放参数无效。");
  const application = await electron.launch({
    args: [
      ...(scale ? [`--force-device-scale-factor=${scale}`] : []),
      ...(executablePath ? [] : [resolve(".")]),
    ],
    executablePath,
    env,
    cwd: resolve("."),
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("load");
  return { application, page, userData };
}
