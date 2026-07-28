const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { AdbManager } = require('./adb');
const { DeviceManager } = require('./device-manager');
const { AgentEngine } = require('./ai-agent');

let mainWindow = null;
let deviceManager = null;
let agentEngine = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Android AI Control',
    backgroundColor: '#0a0e14',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('console-message', (event, level, message) => {
    const tag = level === 2 ? '[Renderer:WARN]' : level === 3 ? '[Renderer:ERR]' : '[Renderer]';
    console.log(`${tag} ${message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const adb = new AdbManager();
  const adbReady = await adb.ensureAdb();
  if (!adbReady) {
    console.error('[Main] ADB not found. Please install platform-tools.');
  }

  deviceManager = new DeviceManager();
  deviceManager.on('devices-changed', (devices) => {
    mainWindow?.webContents.send('devices-changed', devices);
  });
  deviceManager.on('device-connected', async (device) => {
    mainWindow?.webContents.send('device-connected', device);
    await deviceManager.autoDeploy(device.serial);
  });
  deviceManager.on('device-disconnected', (serial) => {
    mainWindow?.webContents.send('device-disconnected', serial);
  });
  deviceManager.on('deploy-status', (status) => {
    mainWindow?.webContents.send('deploy-status', status);
  });
  deviceManager.on('log', (line) => {
    mainWindow?.webContents.send('log', line);
  });
  deviceManager.start();

  createWindow();
});

app.on('window-all-closed', () => {
  if (agentEngine) { agentEngine.stop(); }
  deviceManager?.stop();
  app.quit();
});

app.on('before-quit', async () => {
  if (agentEngine) { agentEngine.stop(); }
  deviceManager?.stop();
});

// ========== Device IPC ==========

ipcMain.handle('get-devices', async () => {
  return deviceManager?.getDevices() ?? [];
});

ipcMain.handle('connect-device', async (event, serial) => {
  return deviceManager?.connectDevice(serial);
});

ipcMain.handle('disconnect-device', async (event, serial) => {
  return deviceManager?.disconnectDevice(serial);
});

ipcMain.handle('get-forwarded-port', async (event, serial) => {
  return deviceManager?.getForwardedPort(serial);
});

const ALLOWED_PROTOCOLS = ['https:', 'http:'];

ipcMain.handle('open-external', async (event, url) => {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      console.error(`[Main] Blocked open-external for protocol: ${parsed.protocol}`);
      return;
    }
    shell.openExternal(url);
  } catch {
    console.error(`[Main] Invalid URL for open-external: ${url}`);
  }
});

// ========== AI Agent IPC ==========

ipcMain.handle('agent-start', async (event, goal, config) => {
  if (!deviceManager) return;

  const devices = deviceManager.getDevices();
  const connected = devices.find((d) => d.forwardedPort);
  if (!connected) {
    mainWindow?.webContents.send('agent-event', {
      type: 'error',
      message: '没有已连接的设备',
    });
    return;
  }

  // Stop existing agent
  if (agentEngine) {
    agentEngine.stop();
    await new Promise((r) => setTimeout(r, 500));
  }

  // Find adb path (reuse from AdbManager)
  const adb = new AdbManager();
  agentEngine = new AgentEngine({
    adbPath: adb.adbPath,
    serial: connected.serial,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || 'https://api.openai.com/v1',
    model: config.model || 'gpt-4o',
    maxIterations: config.maxIterations || 20,
  });

  // Forward agent events to renderer
  const forwardEvent = (eventData) => {
    mainWindow?.webContents.send('agent-event', eventData);
  };

  agentEngine.on('start', forwardEvent);
  agentEngine.on('screenshot', forwardEvent);
  agentEngine.on('thinking', forwardEvent);
  agentEngine.on('action', forwardEvent);
  agentEngine.on('done', forwardEvent);
  agentEngine.on('error', forwardEvent);
  agentEngine.on('max-iterations', forwardEvent);
  agentEngine.on('log', forwardEvent);

  // Run in background (don't await)
  agentEngine.run(goal).catch((err) => {
    console.error('[Main] Agent run error:', err.message);
  });
});

ipcMain.handle('agent-stop', async () => {
  if (agentEngine) {
    agentEngine.stop();
  }
});

ipcMain.handle('agent-status', async () => {
  if (!agentEngine) return { running: false, iteration: 0 };
  return { running: agentEngine.running, iteration: agentEngine.iteration };
});
