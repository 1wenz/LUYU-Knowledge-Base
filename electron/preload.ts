import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld(
  "desktop",
  Object.freeze({
    getInfo: () => ipcRenderer.invoke("app:get-info"),
  }),
);
