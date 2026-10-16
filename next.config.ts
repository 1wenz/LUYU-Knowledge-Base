import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  experimental: {
    workerThreads: true,
    useTypeScriptCli: false,
    cpus: 2,
  },
};

export default nextConfig;
