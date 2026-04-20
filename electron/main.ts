import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  safeStorage,
  shell,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import {
  installConsoleTee,
  openLogFile,
  pruneOldLogs,
  type LogHandle,
} from "./logs";
import { maskApiKey } from "./mask-key";
import { validateApiKey } from "./validate-key";

const DEV_PORT = Number(process.env.HEALTH_DEV_PORT ?? 3000);
const KEYCHAIN_FILE = "keychain.bin";
const LOG_KEEP_DAYS = 14;

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let logHandle: LogHandle | null = null;
let serverBaseUrl: string | null = null;

function keychainPath(): string {
  return path.join(app.getPath("userData"), KEYCHAIN_FILE);
}

function logsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

function initLogging(): void {
  const dir = logsDir();
  pruneOldLogs(dir, LOG_KEEP_DAYS);
  logHandle = openLogFile(dir);
  installConsoleTee(logHandle);
  console.log(`[electron] logs → ${logHandle.logPath}`);
}

function crashDetails(err: Error): string {
  const ts = new Date().toISOString();
  const lines = [
    `Time: ${ts}`,
    `Message: ${err.message || "(no message)"}`,
  ];
  if (err.name && err.name !== "Error") lines.push(`Name: ${err.name}`);
  lines.push("", "Stack:", err.stack ?? "(no stack)");
  return lines.join("\n");
}

function showCrashDialog(err: Error): void {
  const details = crashDetails(err);

  // dialog needs the app to be ready. If we crash before that, log and bail.
  if (!app.isReady()) {
    console.error("[electron] pre-ready crash:", details);
    app.exit(1);
    return;
  }

  // Loop so "Copy details" doesn't dismiss the dialog — the user can copy
  // then still pick Continue or Quit.
  while (true) {
    const idx = dialog.showMessageBoxSync({
      type: "error",
      title: "Health — unexpected error",
      message: err.message || "An unexpected error occurred",
      detail: err.stack ?? String(err),
      buttons: ["Copy details", "Continue", "Quit"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (idx === 0) {
      clipboard.writeText(details);
      continue;
    }
    if (idx === 2) {
      app.quit();
    }
    return;
  }
}

function installCrashHandlers(): void {
  process.on("uncaughtException", (err) => {
    console.error("[electron] uncaughtException:", err);
    showCrashDialog(err instanceof Error ? err : new Error(String(err)));
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[electron] unhandledRejection:", reason);
    const err = reason instanceof Error ? reason : new Error(String(reason));
    showCrashDialog(err);
  });
}

function tryLoadApiKey(): string | null {
  const p = keychainPath();
  if (!fs.existsSync(p)) return null;
  try {
    const encrypted = fs.readFileSync(p);
    return safeStorage.decryptString(encrypted);
  } catch (err) {
    console.error("[electron] failed to decrypt stored api key:", err);
    return null;
  }
}

function saveApiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Keychain encryption unavailable on this system");
  }
  const encrypted = safeStorage.encryptString(key);
  const p = keychainPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, encrypted);
}

function showFirstRun(): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 540,
      height: 520,
      resizable: false,
      title: "Health — setup",
      backgroundColor: "#f7f7f8",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void win.loadFile(path.join(__dirname, "first-run.html"));

    let resolved = false;

    ipcMain.handle("health:save-api-key", async (_event, key: unknown) => {
      if (typeof key !== "string" || !key.trim()) {
        throw new Error("Key is required");
      }
      const trimmed = key.trim();
      await validateApiKey(trimmed);
      saveApiKey(trimmed);
      resolved = true;
      ipcMain.removeHandler("health:save-api-key");
      resolve(trimmed);
      win.close();
      return { ok: true };
    });

    win.on("closed", () => {
      if (!resolved) {
        ipcMain.removeHandler("health:save-api-key");
        reject(new Error("setup window closed before key was entered"));
      }
    });
  });
}

async function ensureApiKey(): Promise<string | null> {
  const stored = tryLoadApiKey();
  if (stored) {
    console.log("[electron] loaded api key from keychain");
    return stored;
  }
  if (app.isPackaged) {
    console.log("[electron] no stored key, showing first-run setup");
    return await showFirstRun();
  }
  console.log("[electron] dev mode, deferring key lookup to spawned server (.env)");
  return null;
}

async function startServer(apiKey: string | null): Promise<string> {
  const userDataDir = app.getPath("userData");
  const appDir = app.getAppPath();
  const mode = app.isPackaged ? "prod" : "dev";
  console.log(`[electron] userData → ${userDataDir}`);
  console.log(`[electron] app dir → ${appDir}`);

  const port = app.isPackaged ? await pickFreePort() : DEV_PORT;
  const cmd = app.isPackaged ? "start" : "dev";

  const nextScript = path.join(
    appDir,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  console.log(`[electron] ${mode}: next ${cmd} on port ${port}`);

  const teeStdio = app.isPackaged && logHandle != null;
  serverProcess = spawn(
    process.execPath,
    [nextScript, cmd, "--port", String(port)],
    {
      cwd: appDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        HEALTH_USER_DATA_DIR: userDataDir,
        HEALTH_APP_DIR: appDir,
        ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
      },
      stdio: teeStdio ? ["ignore", "pipe", "pipe"] : "inherit",
    },
  );

  if (teeStdio && logHandle) {
    const handle = logHandle;
    serverProcess.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      handle.write(chunk.toString());
    });
    serverProcess.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      handle.write(chunk.toString());
    });
  }

  serverProcess.on("exit", (code, signal) => {
    console.log(
      `[electron] next ${cmd} exited (code=${code}, signal=${signal})`,
    );
    serverProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  const url = `http://localhost:${port}`;
  await waitForServer(url);
  return url;
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("could not pick free port"));
      }
    });
  });
}

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Server never became reachable at ${url}`);
}

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Health",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload-main.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void mainWindow.loadURL(url);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });
}

function navigateTo(path: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || !serverBaseUrl) return;
  void mainWindow.loadURL(`${serverBaseUrl}${path}`);
}

function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Welcome to Health",
          click: () => navigateTo("/welcome"),
        },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => navigateTo("/settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle("health:get-masked-key", () => {
    const stored = tryLoadApiKey();
    return stored ? maskApiKey(stored) : null;
  });

  ipcMain.handle("health:replace-api-key", async (_event, key: unknown) => {
    if (typeof key !== "string" || !key.trim()) {
      throw new Error("Key is required");
    }
    const trimmed = key.trim();
    await validateApiKey(trimmed);
    saveApiKey(trimmed);
    return { ok: true };
  });

  ipcMain.handle("health:reveal-user-data", () => {
    const dir = app.getPath("userData");
    return shell.openPath(dir);
  });

  ipcMain.handle("health:reveal-logs", () => {
    const dir = logsDir();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });

  ipcMain.handle("health:get-user-data-path", () => app.getPath("userData"));

  ipcMain.handle("health:get-logs-path", () => logsDir());

  ipcMain.handle("health:check-for-updates", () => {
    return {
      ok: true,
      status: "not-implemented" as const,
      message: "Auto-update ships in Phase 7.",
    };
  });
}

installCrashHandlers();

void app.whenReady().then(async () => {
  if (app.isPackaged) {
    try {
      initLogging();
    } catch (err) {
      console.error("[electron] failed to init logging:", err);
    }
  }

  let apiKey: string | null;
  try {
    apiKey = await ensureApiKey();
  } catch (err) {
    console.error("[electron] setup aborted:", err);
    app.quit();
    return;
  }

  let url: string;
  try {
    url = await startServer(apiKey);
  } catch (err) {
    console.error("[electron] failed to start next server:", err);
    app.quit();
    return;
  }
  serverBaseUrl = url;
  registerIpc();
  installAppMenu();
  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
  if (logHandle) {
    logHandle.close();
    logHandle = null;
  }
});
