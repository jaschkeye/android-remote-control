const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
      await this.exec('start-server');
      return true;
    } catch {
      return false;
    }
  }

  async getDevices() {
    try {
      const output = await this.exec('devices');
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
    try {
      const output = await this.exec(`-s ${serial} shell getprop ${prop}`);
      return output.trim();
    } catch {
      return '';
    }
  }

  async pushFile(serial, localPath, remotePath) {
    return this.exec(`-s ${serial} push "${localPath}" "${remotePath}"`);
  }

  async shell(serial, command) {
    return this.exec(`-s ${serial} shell ${command}`);
  }

  async forward(serial, local, remote) {
    return this.exec(`-s ${serial} forward ${local} ${remote}`);
  }

  async forwardRemove(serial, local) {
    return this.exec(`-s ${serial} forward --remove ${local}`);
  }

  async exec(args) {
    return new Promise((resolve, reject) => {
      const fullArgs = args.split(' ');
      execFile(this.adbPath, fullArgs, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${err.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async execStream(serial, command, onData) {
    return new Promise((resolve, reject) => {
      const proc = execFile(
        this.adbPath,
        ['-s', serial, 'shell', command],
        { maxBuffer: 100 * 1024 * 1024 }
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
