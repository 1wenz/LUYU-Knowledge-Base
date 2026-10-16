import { _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";

export async function desktopFixture(existingUserData?: string) {
  const root = resolve(".cache/desktop-tests");
  await mkdir(root, { recursive: true });
  const userData = existingUserData ?? (await mkdtemp(join(root, "user-")));
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
  return { application, page, userData };
}
