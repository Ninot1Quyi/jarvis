const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("islandHost", {
  getScreenMetrics() {
    return ipcRenderer.invoke("island:get-screen-metrics");
  },
  onSnapshot(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("island:snapshot", listener);
    return () => ipcRenderer.removeListener("island:snapshot", listener);
  },
  onBridgeError(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("island:bridge-error", listener);
    return () => ipcRenderer.removeListener("island:bridge-error", listener);
  },
  sendConversationEvent(payload) {
    ipcRenderer.send("island:conversation-event", payload);
  },
});
