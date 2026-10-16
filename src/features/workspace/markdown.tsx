"use client";

import type { ReactNode } from "react";
import type { KnowledgeClient } from "@/lib/contracts";
import { command, readableError, unwrap } from "@/lib/client/result";

// Deliberately small Markdown subset, rendered only as React text/elements.
// Raw HTML stays literal; images never produce a network request.
function inline(text: string, openLink: (url: string) => void): ReactNode[] {
  const parts = text.split(
    /(!\[[^\]\n]*\]\([^\)\n]*\)|\[[^\]\n]+\]\([^\)\n]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/g,
  );
  return parts.map((part, index) => {
    if (part.startsWith("!["))
      return (
        <span key={index} className="text-muted-foreground">
          [图片：{part.slice(2, part.indexOf("]")) || "未命名"}，未自动加载]
        </span>
      );
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      let safe = false;
      try {
        const url = new URL(link[2]);
        safe = ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
      } catch {
        /* Relative and executable links remain text. */
      }
      return safe ? (
        <button
          key={index}
          type="button"
          className="inline text-left text-primary underline [overflow-wrap:anywhere]"
          onClick={() => openLink(link[2])}
        >
          {link[1]} ↗
        </button>
      ) : (
        <span key={index}>{link[1]}（链接不可用）</span>
      );
    }
    if (part.startsWith("`"))
      return (
        <code key={index} className="rounded bg-muted px-1 text-sm">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function Markdown({
  text,
  client,
  onError,
}: {
  text: string;
  client: KnowledgeClient;
  onError: (message: string) => void;
}) {
  const lines = text.split("\n");
  const output: ReactNode[] = [];
  const openLink = (url: string) => {
    void client.system
      .openExternal(command({ url }))
      .then(unwrap)
      .catch((error) => onError(readableError(error)));
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      const start = index;
      const block: string[] = [];
      while (++index < lines.length && !/^\s*```/.test(lines[index])) block.push(lines[index]);
      output.push(
        <pre key={start} className="my-4 rounded-lg bg-muted p-4">
          <code>{block.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const content = inline(
      heading ? heading[2] : line.replace(/^\s*[-*+]\s+/, "• ").replace(/^>\s?/, "│ "),
      openLink,
    );
    output.push(
      heading ? (
        <div
          key={index}
          role="heading"
          aria-level={Math.min(6, heading[1].length + 1)}
          className="mt-6 mb-3 text-xl"
        >
          {content}
        </div>
      ) : (
        <p key={index} className="min-h-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {content}
        </p>
      ),
    );
  }
  return <div className="reading-content min-w-0 max-w-[72ch] space-y-2">{output}</div>;
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return text;
  const pieces: ReactNode[] = [];
  let from = 0;
  let index: number;
  while ((index = text.toLocaleLowerCase().indexOf(needle, from)) !== -1) {
    pieces.push(
      text.slice(from, index),
      <mark key={index} className="rounded bg-secondary text-primary">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    from = index + needle.length;
  }
  pieces.push(text.slice(from));
  return pieces;
}
