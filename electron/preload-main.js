const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("health", {
  isElectron: true,
  getMaskedKey: () => ipcRenderer.invoke("health:get-masked-key"),
  replaceApiKey: (key) => ipcRenderer.invoke("health:replace-api-key", key),
  revealUserData: () => ipcRenderer.invoke("health:reveal-user-data"),
  revealLogs: () => ipcRenderer.invoke("health:reveal-logs"),
  getUserDataPath: () => ipcRenderer.invoke("health:get-user-data-path"),
  getLogsPath: () => ipcRenderer.invoke("health:get-logs-path"),
  checkForUpdates: () => ipcRenderer.invoke("health:check-for-updates"),
});
