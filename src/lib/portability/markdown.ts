import { BackupError, prepareBackupSnapshot, type BackupSnapshot } from "./backup";

export type ExportFile = { name: string; content: string };
export type MarkdownExport = {
  files: ExportFile[];
  documentCount: number;
  excludedTrashCount: number;
};

function safeTitle(title: string, maxUnits: number): string {
  const characters = Array.from(title.normalize("NFC"), (character) => {
    const point = character.codePointAt(0)!;
    const control = point < 32 || (point >= 127 && point <= 159);
    const directional =
      (point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069);
    const unpairedSurrogate = point >= 0xd800 && point <= 0xdfff;
    return control || directional || unpairedSurrogate || /[<>:"/\\|?*]/u.test(character)
      ? "_"
      : character;
  });
  let name = characters.join("").replace(/^[. ]+|[. ]+$/gu, "") || "未命名笔记";
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)) name = "_" + name;
  let bounded = "";
  for (const character of name) {
    if (bounded.length + character.length > maxUnits) break;
    bounded += character;
  }
  return bounded.replace(/[. ]+$/gu, "") || "未命名笔记";
}

export function createMarkdownExport(
  snapshot: BackupSnapshot,
  options: { includeTrash?: boolean } = {},
): MarkdownExport {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== "includeTrash") ||
    (options.includeTrash !== undefined && typeof options.includeTrash !== "boolean")
  ) {
    throw new BackupError("INVALID_FORMAT", "Markdown 导出选项无效。");
  }
  const input = prepareBackupSnapshot(snapshot);
  const documents = input.documents.filter(
    (document) => options.includeTrash || document.deletedAt === null,
  );
  const files = documents.map((document) => {
    const suffix = `--${document.id.toLowerCase()}.md`;
    return {
      name: safeTitle(document.title, 160 - suffix.length) + suffix,
      content: document.contentMarkdown,
    };
  });
  const manifest = {
    format: "zhiyu-markdown-export",
    version: 1,
    collections: input.collections,
    documents: documents.map((document, index) => {
      const { contentMarkdown: _body, ...metadata } = document;
      void _body;
      return { ...metadata, file: files[index].name };
    }),
  };
  return {
    files: [...files, { name: "manifest.json", content: JSON.stringify(manifest, null, 2) + "\n" }],
    documentCount: documents.length,
    excludedTrashCount: input.documents.length - documents.length,
  };
}
