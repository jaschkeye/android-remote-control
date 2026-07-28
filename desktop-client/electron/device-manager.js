const { AdbManager } = require('./adb');
const { AdbProxy, PROXY_PORT } = require('./adb-proxy');
const { EventEmitter } = require('events');

const POLL_INTERVAL_MS = 2000;

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.adb = new AdbManager();
    this.devices = new Map();
    this.pollTimer = null;
    this.deployedDevices = new Set();
    this.proxies = new Map();
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
    for (const proxy of this.proxies.values()) {
      proxy.stop();
    }
    this.proxies.clear();
  }

  async poll() {
    try {
      const rawDevices = await this.adb.getDevices();
      const currentSerials = new Set(rawDevices.map((d) => d.serial));

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
            screenWidth: 0,
            screenHeight: 0,
          };
          if (dev.state === 'device') {
            device.model = await this.adb.getDeviceProp(dev.serial, 'ro.product.model');
            device.androidVersion = await this.adb.getDeviceProp(dev.serial, 'ro.build.version.release');
            device.sdk = await this.adb.getDeviceProp(dev.serial, 'ro.build.version.sdk');
            device.rootAvailable = await this.checkRoot(dev.serial);
            // 获取设备屏幕分辨率并缓存
            const size = await this.getDeviceScreenSize(dev.serial);
            if (size) {
              device.screenWidth = size.width;
              device.screenHeight = size.height;
            }
          }
          this.devices.set(dev.serial, device);
          this.emit('device-connected', device);
          this.emit('devices-changed', this.getDevices());
        }
      }

      for (const serial of this.devices.keys()) {
        if (!currentSerials.has(serial)) {
          this.devices.delete(serial);
          this.deployedDevices.delete(serial);
          const proxy = this.proxies.get(serial);
          if (proxy) { proxy.stop(); this.proxies.delete(serial); }
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

  async getDeviceScreenSize(serial) {
    try {
      const output = await this.adb.shell(serial, 'wm size');
      // 输出格式示例: "Physical size: 720x1520"
      const match = output.match(/(\d+)x(\d+)/);
      if (match) {
        return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
      }
      return null;
    } catch {
      return null;
    }
  }

  async autoDeploy(serial) {
    const device = this.devices.get(serial);
    if (!device || device.state !== 'device') return;
    if (this.deployedDevices.has(serial)) return;

    this.emit('deploy-status', { serial, stage: 'checking', message: '初始化 ADB 代理...' });

    // Stop existing proxy if any
    const existingProxy = this.proxies.get(serial);
    if (existingProxy) { existingProxy.stop(); }

    // Start ADB proxy (replaces the Kotlin daemon)
    try {
      const proxy = new AdbProxy(serial);
      await proxy.start();
      this.proxies.set(serial, proxy);
      device.daemonRunning = true;
      device.forwardedPort = PROXY_PORT;
      this.deployedDevices.add(serial);
      this.emit('deploy-status', { serial, stage: 'done', message: 'ADB 代理就绪 (PNG 模式)' });
      this.emit('devices-changed', this.getDevices());
    } catch (err) {
      this.emit('deploy-status', { serial, stage: 'error', message: `代理启动失败: ${err.message}` });
    }
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
    const proxy = this.proxies.get(serial);
    if (proxy) { proxy.stop(); this.proxies.delete(serial); }
    const device = this.devices.get(serial);
    if (device) {
      device.forwardedPort = null;
      device.daemonRunning = false;
    }
    this.deployedDevices.delete(serial);
    this.emit('devices-changed', this.getDevices());
  }
}

module.exports = { DeviceManager };
