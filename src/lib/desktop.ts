import type { KnowledgeClient } from "./contracts";

export type DesktopInfo = {
  name: string;
  version: string;
  platform: string;
};

declare global {
  interface Window {
    desktop?: KnowledgeClient & {
      getInfo: () => Promise<DesktopInfo>;
    };
  }
}
