export type DesktopInfo = {
  name: string;
  version: string;
  platform: string;
};

declare global {
  interface Window {
    desktop?: {
      getInfo: () => Promise<DesktopInfo>;
    };
  }
}
