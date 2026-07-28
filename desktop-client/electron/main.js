const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { AdbManager } = require('./adb');
const { DeviceManager } = require('./device-manager');

let mainWindow = null;
let deviceManager = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Android Remote Control',
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Ensure ADB is available
  const adbReady = await AdbManager.ensureAdb();
  if (!adbReady) {
    console.error('[Main] ADB not found. Please install platform-tools.');
  }

  // Initialize device manager
  deviceManager = new DeviceManager();
  deviceManager.on('devices-changed', (devices) => {
    mainWindow?.webContents.send('devices-changed', devices);
  });
  deviceManager.on('device-connected', async (device) => {
    mainWindow?.webContents.send('device-connected', device);
    // Auto-deploy daemon when device connects
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
  deviceManager?.stop();
  app.quit();
});

app.on('before-quit', async () => {
  deviceManager?.stop();
});

// IPC Handlers
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
