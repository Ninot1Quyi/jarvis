const path = require("node:path");
const {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
} = require("electron");
const { createWindowEdgeController } = require("./window-edge/controller");
const { createNativeShellBridge } = require("./native-shell/bridge");

const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 252;
const USER_TOP_OFFSET = Number(process.env.ISLAND_TOP_OFFSET ?? 0);
const USE_NATIVE_SHELL =
  process.argv.includes("--native-shell") ||
  process.env.JARVIS_NATIVE_SHELL === "1";

let mainWindow = null;
let stdinBuffer = "";
let nativeShellBridge = null;
const edgeController = createWindowEdgeController({
  topOffset: USER_TOP_OFFSET,
});

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  const { frame } = edgeController.resolveFrame(WINDOW_WIDTH, WINDOW_HEIGHT);

  mainWindow = new BrowserWindow({
    ...frame,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    title: "jarvis-island-electron",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setFullScreenable(false);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setIgnoreMouseEvents(false);

  const icon = nativeImage.createFromPath(
    path.join(__dirname, "icon.png")
  );
  if (!icon.isEmpty()) {
    mainWindow.setIcon(icon);
  }

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  edgeController.pinToTopEdge(mainWindow, {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });

  if (process.argv.includes("--devtools")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  mainWindow.once("ready-to-show", () => {
    edgeController.pinToTopEdge(mainWindow, {
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupIpc() {
  ipcMain.handle("island:get-screen-metrics", () => {
    const { display, bounds } = edgeController.resolveFrame(
      WINDOW_WIDTH,
      WINDOW_HEIGHT
    );
    const workArea = display.workArea;
    return {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      workArea,
    };
  });

  ipcMain.on("island:conversation-event", (_event, payload) => {
    sendToRenderer("island:conversation-event", payload);
  });
}

function setupStdinBridge() {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    stdinBuffer += chunk;
    let delimiter = stdinBuffer.indexOf("\n");
    while (delimiter >= 0) {
      const line = stdinBuffer.slice(0, delimiter).trim();
      stdinBuffer = stdinBuffer.slice(delimiter + 1);
      delimiter = stdinBuffer.indexOf("\n");

      if (!line) continue;
      try {
        const snapshot = JSON.parse(line);
        sendToRenderer("island:snapshot", snapshot);
      } catch {
        sendToRenderer("island:bridge-error", line);
      }
    }
  });
}

app.whenReady().then(() => {
  if (USE_NATIVE_SHELL) {
    nativeShellBridge = createNativeShellBridge({ app });
    nativeShellBridge.start();
    return;
  }

  setupIpc();
  setupStdinBridge();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (USE_NATIVE_SHELL) {
    return;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
