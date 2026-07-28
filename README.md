# Android Remote Control

通过电脑浏览器完全操控已 Root 的安卓手机。

## 架构

```
PC 浏览器 (React + WebCodecs + WebSocket)
       |
WiFi / USB
       |
Android Root Daemon (Kotlin, Magisk模块, 端口 27183)
```

## 功能规划

| 阶段 | 功能 |
|------|------|
| MVP | 屏幕实时投射 + 鼠标点击操作 |
| v2 | 文件管理（/data 全访问）、应用静默安装/卸载 |
| v3 | 交互式 Root Shell 终端、通知实时推送 |
| v4 | 录屏、剪贴板同步、系统控制 |
| v5 | 安全加固（TLS + JWT + 审计日志） |
| v6 | LSPosed 集成、群控、脚本录制回放 |

## 技术栈

- **安卓端**: Kotlin + Coroutines + MediaCodec + Java-WebSocket + libsu
- **前端**: React 18 + TypeScript + Vite + TailwindCSS + WebCodecs + xterm.js
- **通信**: WebSocket + JSON-RPC 2.0

## 目录结构

```
android-daemon/   # 安卓 Root 守护进程（Kotlin + Gradle）
web-ui/           # 浏览器控制面板（React + Vite）
magisk-module/    # Magisk 模块（开机自启）
docs/             # 架构文档与协议规范
scripts/          # 构建与发布脚本
```

## 快速开始

### 编译安卓 Daemon

```bash
cd android-daemon
./gradlew :app:assembleDebug
```

### 安装 Magisk 模块

```bash
adb push app/build/outputs/apk/debug/app-debug.apk /data/local/tmp/remote-daemon.jar
adb push magisk-module /data/adb/modules/remote-daemon
```

### 启动前端

```bash
cd web-ui
npm install
npm run dev
```

## 安全警告

本项目需要 Root 权限运行，拥有设备的完全控制权。默认仅监听局域网，公网使用请务必启用 TLS + 配对认证。

## License

MIT
