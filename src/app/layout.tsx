import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知屿 · Knowledge Base",
  description: "一个本地优先的知识库，让灵感、笔记和资料有序沉淀。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
