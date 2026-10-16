import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = resolve(root, ".cache/init-phases");
const apply = process.argv.includes("--apply");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function safePath(parent, path) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
    throw new Error("Unsafe snapshot path: " + path);
  const target = resolve(parent, path);
  const offset = relative(parent, target);
  if (offset.startsWith(".." + sep) || offset === ".." || isAbsolute(offset))
    throw new Error("Unsafe snapshot path.");
  return target;
}

function git(args, input, allowedCodes = [0]) {
  const result = spawnSync("git", args, {
    cwd: root,
    input,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!allowedCodes.includes(result.status)) {
    throw new Error(result.stderr || result.stdout || "Git command failed.");
  }
  return result.stdout.trim();
}

try {
  const manifest = JSON.parse(await readFile(resolve(snapshotRoot, "manifest.json"), "utf8"));
  if (manifest.version !== 1) throw new Error("Unsupported checkpoint manifest.");
  const finalFiles = new Map();
  for (const phase of manifest.phases) {
    for (const file of phase.files) {
      const content = await readFile(safePath(safePath(snapshotRoot, phase.name), file.path));
      if (digest(content) !== file.sha256) throw new Error("Snapshot changed: " + file.path);
      finalFiles.set(file.path, file.sha256);
    }
  }
  for (const [path, expectedHash] of finalFiles) {
    if (digest(await readFile(safePath(root, path))) !== expectedHash) {
      throw new Error(
        "Working file changed since initialization: " + path + ". Review and commit it manually.",
      );
    }
  }
  console.log("Checkpoint files verified. Base: " + manifest.base);
  for (const phase of manifest.phases)
    console.log(phase.name + " · " + phase.message + " · " + phase.files.length + " files");
  if (!apply) {
    console.log("Dry run only. Use --apply in a terminal that can write .git.");
  } else {
    const statePath = resolve(snapshotRoot, "replay-state.json");
    const state = await readFile(statePath, "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code === "ENOENT") return { head: manifest.base, completed: [] };
        throw error;
      });
    if (git(["branch", "--show-current"]) !== manifest.branch)
      throw new Error("Git branch changed; refusing to replay.");
    if (git(["rev-parse", "HEAD"]) !== state.head)
      throw new Error("Git history changed; review pending stages manually.");
    git(["diff", "--cached", "--quiet"]);
    for (const phase of manifest.phases.slice(state.completed.length)) {
      for (const file of phase.files) {
        const content = await readFile(safePath(safePath(snapshotRoot, phase.name), file.path));
        const hash = git(["hash-object", "-w", "--stdin", "--path", file.path], content);
        git(["update-index", "--add", "--cacheinfo", "100644," + hash + "," + file.path]);
      }
      git(["diff", "--cached", "--check"]);
      console.log(git(["commit", "-m", phase.message]));
      state.head = git(["rev-parse", "HEAD"]);
      state.completed.push(phase.name);
      await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
    }
    console.log("Initialization commits completed.");
    console.log(git(["log", "--oneline", "--max-count=6"]));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
