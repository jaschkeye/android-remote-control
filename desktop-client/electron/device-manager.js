const { AdbManager } = require('./adb');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const DAEMON_REMOTE_PATH = '/data/local/tmp/remote-daemon.jar';
const DAEMON_PORT = 27183;
const FORWARD_LOCAL = `tcp:${DAEMON_PORT}`;
const FORWARD_REMOTE = `tcp:${DAEMON_PORT}`;
const POLL_INTERVAL_MS = 2000;
const DAEMON_STARTUP_DELAY_MS = 1500;

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.adb = new AdbManager();
    this.devices = new Map();
    this.pollTimer = null;
    this.deployedDevices = new Set();
  }

  start() {
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Remove all forwards
    for (const serial of this.devices.keys()) {
      this.adb.forwardRemove(serial, FORWARD_LOCAL).catch(() => {});
    }
  }

  async poll() {
    try {
      const rawDevices = await this.adb.getDevices();
      const currentSerials = new Set(rawDevices.map((d) => d.serial));

      // Detect new devices
      for (const dev of rawDevices) {
        if (!this.devices.has(dev.serial)) {
          const device = {
            serial: dev.serial,
            state: dev.state,
            model: '',
            androidVersion: '',
            sdk: '',
            rootAvailable: false,
            daemonRunning: false,
            forwardedPort: null,
          };
          // Fetch device info
          if (dev.state === 'device') {
            device.model = await this.adb.getDeviceProp(dev.serial, 'ro.product.model');
            device.androidVersion = await this.adb.getDeviceProp(dev.serial, 'ro.build.version.release');
            device.sdk = await this.adb.getDeviceProp(dev.serial, 'ro.build.version.sdk');
            device.rootAvailable = await this.checkRoot(dev.serial);
          }
          this.devices.set(dev.serial, device);
          this.emit('device-connected', device);
          this.emit('devices-changed', this.getDevices());
        }
      }

      // Detect disconnected devices
      for (const serial of this.devices.keys()) {
        if (!currentSerials.has(serial)) {
          this.devices.delete(serial);
          this.deployedDevices.delete(serial);
          this.emit('device-disconnected', serial);
          this.emit('devices-changed', this.getDevices());
        }
      }
    } catch (err) {
      // ADB might not be ready yet
    }
  }

  async checkRoot(serial) {
    try {
      const output = await this.adb.shell(serial, 'su -c id');
      return output.includes('uid=0');
    } catch {
      return false;
    }
  }

  async autoDeploy(serial) {
    const device = this.devices.get(serial);
    if (!device || device.state !== 'device') return;
    if (this.deployedDevices.has(serial)) return;

    this.emit('deploy-status', { serial, stage: 'checking', message: '检查设备状态...' });

    // Check if daemon is already running
    try {
      const checkResult = await this.adb.shell(serial, 'pgrep -f remote-daemon');
      if (checkResult.trim()) {
        this.emit('deploy-status', { serial, stage: 'running', message: 'Daemon 已在运行' });
        device.daemonRunning = true;
        await this.setupForward(serial);
        this.emit('devices-changed', this.getDevices());
        return;
      }
    } catch {
      // Not running
    }

    // Find daemon jar
    const jarPath = this.findDaemonJar();
    if (!jarPath) {
      this.emit('deploy-status', { serial, stage: 'error', message: '未找到 daemon.jar，请先编译 android-daemon' });
      return;
    }

    // Push jar
    this.emit('deploy-status', { serial, stage: 'pushing', message: '推送 daemon.jar...' });
    try {
      await this.adb.pushFile(serial, jarPath, DAEMON_REMOTE_PATH);
    } catch (err) {
      this.emit('deploy-status', { serial, stage: 'error', message: `推送失败: ${err.message}` });
      return;
    }

    // Start daemon
    this.emit('deploy-status', { serial, stage: 'starting', message: '启动 daemon...' });
    try {
      const startCmd = `CLASSPATH=${DAEMON_REMOTE_PATH} app_process / com.remote.daemon.Main > /dev/null 2>&1 &`;
      await this.adb.shell(serial, startCmd);
      // Wait a moment for startup
      await new Promise((r) => setTimeout(r, DAEMON_STARTUP_DELAY_MS));
      device.daemonRunning = true;
      this.deployedDevices.add(serial);
      this.emit('deploy-status', { serial, stage: 'done', message: 'Daemon 启动成功' });

      // Setup port forwarding
      await this.setupForward(serial);
      this.emit('devices-changed', this.getDevices());
    } catch (err) {
      this.emit('deploy-status', { serial, stage: 'error', message: `启动失败: ${err.message}` });
    }
  }

  async setupForward(serial) {
    try {
      await this.adb.forward(serial, FORWARD_LOCAL, FORWARD_REMOTE);
      const device = this.devices.get(serial);
      if (device) {
        device.forwardedPort = DAEMON_PORT;
        this.emit('devices-changed', this.getDevices());
      }
    } catch (err) {
      this.emit('deploy-status', { serial, stage: 'error', message: `端口转发失败: ${err.message}` });
    }
  }

  findDaemonJar() {
    const candidates = [
      path.join(__dirname, '..', 'resources', 'remote-daemon.jar'),
      path.join(__dirname, '..', 'android-daemon', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      path.join(__dirname, '..', 'android-daemon', 'app', 'build', 'outputs', 'jar', 'remote-daemon.jar'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  getDevices() {
    return Array.from(this.devices.values());
  }

  getForwardedPort(serial) {
    const device = this.devices.get(serial);
    return device?.forwardedPort ?? null;
  }

  async connectDevice(serial) {
    await this.autoDeploy(serial);
    return this.getForwardedPort(serial);
  }

  async disconnectDevice(serial) {
    try {
      await this.adb.forwardRemove(serial, FORWARD_LOCAL);
      const device = this.devices.get(serial);
      if (device) {
        device.forwardedPort = null;
        device.daemonRunning = false;
      }
      this.deployedDevices.delete(serial);
      this.emit('devices-changed', this.getDevices());
    } catch {}
  }
}

module.exports = { DeviceManager };
