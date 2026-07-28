/**
 * ADB Proxy Server
 * 
 * Replaces the Kotlin daemon when Android SDK is unavailable.
 * Uses `adb exec-out screencap -p` for screen capture (PNG)
 * and `adb shell input` for touch injection.
 * 
 * Protocol: WebSocket + JSON-RPC 2.0 (same as the Kotlin daemon)
 * Video format: PNG images (binary WebSocket messages)
 */

const { WebSocketServer } = require('ws');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROXY_PORT = 27183;
const CAPTURE_INTERVAL_MS = 200; // ~5fps (stable for PNG mode)
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47];

function findAdbPath() {
  const envPath = process.env.ADB_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const bundledPaths = [
    path.join(process.resourcesPath || __dirname, 'platform-tools', 'adb.exe'),
    path.join(__dirname, '..', 'resources', 'platform-tools', 'adb.exe'),
  ];
  for (const p of bundledPaths) {
    if (fs.existsSync(p)) return p;
  }

  const commonPaths = [
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'C:\\Android\\platform-tools\\adb.exe',
    'C:\\Program Files\\Android\\platform-tools\\adb.exe',
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return 'adb';
}

class AdbProxy {
  constructor(serial) {
    this.serial = serial;
    this.adbPath = findAdbPath();
    this.wss = null;
    this.casting = false;
    this.captureTimer = null;
    this.pendingShot = false;
    this.frameCount = 0;
    this.ws = null;
    this.screenSize = null; // cached screen size
    console.log(`[AdbProxy] Using adb: ${this.adbPath}`);
  }

  start() {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: PROXY_PORT }, () => {
        console.log(`[AdbProxy] WebSocket server on :${PROXY_PORT} (device: ${this.serial})`);
        resolve();
      });

      this.wss.on('connection', (ws) => {
        console.log('[AdbProxy] Client connected');
        this.ws = ws;
        ws.on('message', (data) => this.handleMessage(ws, data));
        ws.on('close', () => {
          console.log('[AdbProxy] Client disconnected');
          this.ws = null;
          this.stopCast();
        });
      });
    });
  }

  stop() {
    this.stopCast();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  handleMessage(ws, data) {
    try {
      const msg = JSON.parse(data.toString());
      const { id, method, params } = msg;
      let result = null;
      let error = null;

      switch (method) {
        case 'ping':
          result = { pong: true, timestamp: Date.now() };
          break;
        case 'startScreenCast':
          this.startCast(ws);
          result = { started: true };
          break;
        case 'stopScreenCast':
          this.stopCast();
          result = { stopped: true };
          break;
        case 'injectInput':
          result = this.injectInput(params);
          break;
        case 'getScreenInfo':
          // Return cached size or fetch if not available
          if (this.screenSize) {
            result = this.screenSize;
          } else {
            return this.getScreenSize()
              .then((size) => {
                this.screenSize = size;
                ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: size, error: null }));
              })
              .catch((err) => {
                ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: null, error: { code: -32000, message: err.message } }));
              });
          }
          break;
        default:
          error = { code: -32601, message: `Unknown method: ${method}` };
      }

      ws.send(JSON.stringify({ jsonrpc: '2.0', id, result, error }));
    } catch (e) {
      console.error('[AdbProxy] Message error:', e.message);
    }
  }

  startCast(ws) {
    if (this.casting) return;
    this.casting = true;
    this.frameCount = 0;
    console.log('[AdbProxy] Starting screen cast (PNG mode)');

    const captureLoop = async () => {
      if (!this.casting) return;
      const client = this.ws;
      if (!client || client.readyState !== client.OPEN) {
        console.log('[AdbProxy] Client disconnected, stopping cast');
        this.casting = false;
        return;
      }
      if (this.pendingShot) {
        this.captureTimer = setTimeout(captureLoop, CAPTURE_INTERVAL_MS);
        return;
      }
      this.pendingShot = true;
      try {
        const pngData = await this.captureScreen();
        if (pngData && pngData.length > 0 && this.ws && this.ws.readyState === this.ws.OPEN) {
          this.ws.send(pngData);
          this.frameCount++;
          if (this.frameCount === 1 || this.frameCount % 100 === 0) {
            console.log(`[AdbProxy] Sent frame #${this.frameCount} (${pngData.length} bytes)`);
          }
        }
      } catch (e) {
        console.error('[AdbProxy] Capture error:', e.message);
      }
      this.pendingShot = false;
      if (this.casting) {
        this.captureTimer = setTimeout(captureLoop, CAPTURE_INTERVAL_MS);
      }
    };
    captureLoop();
  }

  stopCast() {
    this.casting = false;
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
  }

  captureScreen() {
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        ['-s', this.serial, 'exec-out', 'screencap', '-p'],
        { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' },
        (err, stdout) => {
          if (err) {
            reject(err);
          } else {
            resolve(stdout);
          }
        }
      );
    });
  }

  /**
   * Execute input injection (tap/swipe/text/keyevent/longpress)
   * Uses execFile with array args - NO shell escaping needed since execFile bypasses shell
   * @param {object} params - Input parameters with type field
   * @returns {Promise<{injected: boolean}>}
   */
  async injectInput(params) {
    if (!params || !params.type) {
      return { injected: false };
    }

    const { type } = params;
    const serial = this.serial;

    try {
      switch (type) {
        case 'tap': {
          const { x, y } = params;
          await this._execAdbAsync(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
          return { injected: true };
        }
        case 'swipe': {
          const { x1, y1, x2, y2, duration = 300 } = params;
          await this._execAdbAsync([
            'shell', 'input', 'swipe',
            String(Math.round(x1)), String(Math.round(y1)),
            String(Math.round(x2)), String(Math.round(y2)),
            String(duration)
          ]);
          return { injected: true };
        }
        case 'text': {
          // execFile passes args directly to the process, no shell interpolation
          // For non-ASCII text (Chinese, etc.), adb input text doesn't work natively
          // We use a workaround: encode to URL-encoded format for ADBKeyboard
          const text = String(params.text);
          
          // Check if text contains non-ASCII characters
          if (/[^\x00-\x7F]/.test(text)) {
            // For Chinese/Unicode text, try using adb shell am broadcast to ADBKeyboard
            // Fallback: use `adb shell input text` with percent-encoding
            const encoded = encodeURIComponent(text);
            try {
              await this._execAdbAsync(['shell', 'input', 'text', encoded]);
              return { injected: true };
            } catch {
              // If that fails, try am broadcast method (requires ADBKeyboard installed)
              try {
                await this._execAdbAsync([
                  'shell', 'am', 'broadcast',
                  '-a', 'ADB_INPUT_TEXT',
                  '--es', 'msg', text
                ]);
                return { injected: true };
              } catch {
                return { injected: false, error: '无法输入非ASCII文字，请安装 ADBKeyboard' };
              }
            }
          } else {
            // ASCII text: pass directly (execFile handles escaping)
            await this._execAdbAsync(['shell', 'input', 'text', text]);
            return { injected: true };
          }
        }
        case 'keyevent': {
          const { keycode } = params;
          await this._execAdbAsync(['shell', 'input', 'keyevent', String(keycode)]);
          return { injected: true };
        }
        case 'longpress': {
          const { x, y, duration = 500 } = params;
          await this._execAdbAsync([
            'shell', 'input', 'swipe',
            String(Math.round(x)), String(Math.round(y)),
            String(Math.round(x)), String(Math.round(y)),
            String(duration)
          ]);
          return { injected: true };
        }
        default:
          return { injected: false, error: `Unknown input type: ${type}` };
      }
    } catch (err) {
      console.error(`[AdbProxy] injectInput error (${type}):`, err.message);
      return { injected: false, error: err.message };
    }
  }

  /**
   * Execute adb command asynchronously (Promise wrapper)
   * @param {string[]} args - Arguments to pass to adb
   * @returns {Promise<string>}
   * @private
   */
  _execAdbAsync(args) {
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        ['-s', this.serial, ...args],
        { maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(stdout);
          }
        }
      );
    });
  }

  /**
   * Get device screen resolution
   * @returns {Promise<{width: number, height: number}>}
   */
  getScreenSize() {
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        ['-s', this.serial, 'shell', 'wm', 'size'],
        { maxBuffer: 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (err) {
            reject(err);
            return;
          }
          // Output format: "Physical size: 720x1520"
          const match = stdout.match(/(\d+)x(\d+)/);
          if (match) {
            resolve({ width: parseInt(match[1], 10), height: parseInt(match[2], 10) });
          } else {
            reject(new Error(`无法解析屏幕分辨率: ${stdout.trim()}`));
          }
        }
      );
    });
  }
}

module.exports = { AdbProxy, PROXY_PORT };
