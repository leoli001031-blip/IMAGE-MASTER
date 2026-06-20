const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let serverProcess;
let mainWindow;

app.setName("Image Master");
applyUserDataDirOverride();

app.whenReady().then(async () => {
  try {
    const appServerDir = resolveAppServerDir();
    const port = await findFreePort(Number(process.env.IMAGE_MASTER_PORT || 3457));
    const userDataDir = resolveUserDataDir();
    const runtimeDataDir = path.join(userDataDir, "data");
    fs.mkdirSync(runtimeDataDir, { recursive: true });

    serverProcess = startServer({ appServerDir, port, runtimeDataDir, userDataDir });
    await waitForServer(`http://127.0.0.1:${port}/canvas`, 30_000);

    mainWindow = createWindow();
    await mainWindow.loadURL(`http://127.0.0.1:${port}/canvas`);
  } catch (error) {
    await showStartupError(error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  stopServer();
});

function resolveAppServerDir() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "app-server")]
    : [
        path.join(process.cwd(), "dist-electron", "app-server"),
        path.join(__dirname, "..", "dist-electron", "app-server"),
      ];

  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, "server.js")));
  if (!found) {
    throw new Error("未找到 Electron app-server。请先运行 npm run electron:prepare-server:env。");
  }
  return found;
}

function applyUserDataDirOverride() {
  const override = process.env.IMAGE_MASTER_ELECTRON_USER_DATA_DIR;
  if (!override || !override.trim()) return;
  app.setPath("userData", path.resolve(override.trim()));
}

function resolveUserDataDir() {
  return app.getPath("userData");
}

function startServer({ appServerDir, port, runtimeDataDir, userDataDir }) {
  const nodeBin = resolveNodeBinary();
  const bundledEnv = readEnvFile(path.join(appServerDir, ".env"));
  const env = {
    ...process.env,
    ...bundledEnv,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    IMAGE_MASTER_DATA_DIR: runtimeDataDir,
  };

  const logPath = path.join(userDataDir, "server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n[${new Date().toISOString()}] Starting Image Master server on ${port}\n`);

  const child = spawn(nodeBin, ["server.js"], {
    cwd: appServerDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logStream.write(chunk));
  child.stderr.on("data", (chunk) => logStream.write(chunk));
  child.on("exit", (code, signal) => {
    logStream.write(`[${new Date().toISOString()}] Server exited code=${code} signal=${signal}\n`);
    logStream.end();
  });
  return child;
}

function resolveNodeBinary() {
  if (process.env.IMAGE_MASTER_NODE && fs.existsSync(process.env.IMAGE_MASTER_NODE)) {
    return process.env.IMAGE_MASTER_NODE;
  }
  const probe = spawnSync("/bin/zsh", ["-lc", "command -v node"], { encoding: "utf8" });
  const found = probe.stdout.trim();
  if (found && fs.existsSync(found)) return found;
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("未找到 Node.js。当前测试版 Electron 包需要本机安装 Node.js 20+。");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "Image Master",
    backgroundColor: "#f6efe4",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill();
  serverProcess = undefined;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`未找到可用端口，从 ${startPort} 开始尝试了 100 个端口。`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
      request.setTimeout(1000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Image Master 本地服务启动超时。"));
        return;
      }
      setTimeout(tick, 250);
    };

    tick();
  });
}

async function showStartupError(error) {
  const message = error instanceof Error ? error.message : String(error);
  await dialog.showMessageBox({
    type: "error",
    title: "Image Master 启动失败",
    message: "Image Master 启动失败",
    detail: message,
  });
}
