import { _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";

export async function desktopFixture(existingUserData?: string) {
  const root = resolve(".cache/desktop-tests");
  await mkdir(root, { recursive: true });
  const userData = existingUserData ?? (await mkdtemp(join(root, "user-")));
  const env = { ...process.env, ZHIYU_TEST_MODE: "1", ZHIYU_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const executablePath = process.env.ZHIYU_PACKAGE_EXE;
  const application = await electron.launch({
    args: executablePath ? [] : [resolve(".")],
    executablePath,
    env,
    cwd: resolve("."),
  });
  const page = await application.firstWindow();
  return { application, page, userData };
}
