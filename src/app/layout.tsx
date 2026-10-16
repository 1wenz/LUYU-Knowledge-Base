import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知屿 · 知识工作区",
  description: "一个本地优先的知识库，让灵感、笔记和资料有序沉淀。",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/brush.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="preload"
          href="/fonts/geist/Geist.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/lxgw/LXGWWenKaiScreen.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
