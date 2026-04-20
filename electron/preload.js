const { contextBridge, ipcRenderer, shell } = require("electron");

contextBridge.exposeInMainWorld("health", {
  saveApiKey: (key) => ipcRenderer.invoke("health:save-api-key", key),
  openExternal: (url) => shell.openExternal(url),
});
