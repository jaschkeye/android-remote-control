const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MAX_BUFFER = 10 * 1024 * 1024;
const STREAM_MAX_BUFFER = 100 * 1024 * 1024;

// Serial numbers are alphanumeric + colons (USB) or IP:port (TCP)
const SERIAL_PATTERN = /^[a-zA-Z0-9:._-]+$/;

function validateSerial(serial) {
  if (!serial || !SERIAL_PATTERN.test(serial)) {
    throw new Error(`Invalid device serial: ${serial}`);
  }
}

class AdbManager {
  constructor() {
    this.adbPath = this.findAdb();
  }

  findAdb() {
    // 1. Check environment variable
    const envPath = process.env.ADB_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;

    // 2. Check bundled platform-tools
    const bundledPaths = [
      path.join(process.resourcesPath || __dirname, 'platform-tools', 'adb.exe'),
      path.join(__dirname, '..', 'resources', 'platform-tools', 'adb.exe'),
    ];
    for (const p of bundledPaths) {
      if (fs.existsSync(p)) return p;
    }

    // 3. Check common install locations on Windows
    const commonPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      'C:\\Android\\platform-tools\\adb.exe',
      'C:\\Program Files\\Android\\platform-tools\\adb.exe',
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }

    // 4. Fallback to PATH
    return 'adb';
  }

  async ensureAdb() {
    try {
      await this.exec(['start-server']);
      return true;
    } catch {
      return false;
    }
  }

  async getDevices() {
    try {
      const output = await this.exec(['devices']);
      const lines = output.trim().split('\n').slice(1);
      return lines
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            return { serial: parts[0], state: parts[1] };
          }
          return null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async getDeviceProp(serial, prop) {
    validateSerial(serial);
    try {
      const output = await this.exec(['-s', serial, 'shell', 'getprop', prop]);
      return output.trim();
    } catch {
      return '';
    }
  }

  async pushFile(serial, localPath, remotePath) {
    validateSerial(serial);
    return this.exec(['-s', serial, 'push', localPath, remotePath]);
  }

  async shell(serial, command) {
    validateSerial(serial);
    return this.exec(['-s', serial, 'shell', command]);
  }

  async forward(serial, local, remote) {
    validateSerial(serial);
    return this.exec(['-s', serial, 'forward', local, remote]);
  }

  async forwardRemove(serial, local) {
    validateSerial(serial);
    return this.exec(['-s', serial, 'forward', '--remove', local]);
  }

  async exec(args) {
    return new Promise((resolve, reject) => {
      execFile(this.adbPath, args, { maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${err.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async execStream(serial, command, onData) {
    validateSerial(serial);
    return new Promise((resolve, reject) => {
      const proc = execFile(
        this.adbPath,
        ['-s', serial, 'shell', command],
        { maxBuffer: STREAM_MAX_BUFFER }
      );
      proc.stdout?.on('data', (data) => onData(data.toString()));
      proc.stderr?.on('data', (data) => onData(data.toString()));
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Exit code: ${code}`));
      });
    });
  }
}

module.exports = { AdbManager };
