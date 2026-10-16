import { contextBridge, ipcRenderer } from "electron";
import { createPreloadClient } from "./ipc/bridge";

const client = createPreloadClient({
  invoke: (channel, request) => ipcRenderer.invoke(channel, request),
  subscribe: (channel, listener) => {
    const receive = (_event: Electron.IpcRendererEvent, input: unknown) => listener(input);
    ipcRenderer.on(channel, receive);
    return () => ipcRenderer.removeListener(channel, receive);
  },
});
contextBridge.exposeInMainWorld(
  "desktop",
  Object.freeze({ ...client, getInfo: () => ipcRenderer.invoke("app:get-info") }),
);
