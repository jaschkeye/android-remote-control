# Android Remote Control

通过电脑完全操控已 Root 的安卓手机。支持 **Windows 桌面客户端**（USB 自动检测）和 **Web 浏览器**（WiFi 连接）两种模式。

## 架构

```
┌─────────────────────────────────────┐
│  Windows 桌面客户端 (Electron)       │
│  ├── ADB 自动检测 USB 设备            │
│  ├── 自动推送 daemon.jar + 启动       │
│  ├── 自动端口转发 (adb forward)       │
│  └── React UI + WebCodecs 投屏        │
└──────────────┬──────────────────────┘
               │ USB / WiFi
┌──────────────┴──────────────────────┐
│  Android Root Daemon (Kotlin)        │
│  ├── MediaCodec H.264 硬编码投屏      │
│  ├── InputManager 触控注入           │
│  ├── 配对码认证                      │
│  └── 端口 27183                      │
└─────────────────────────────────────┘
```

## 目录结构

```
android-remote-control/
├── android-daemon/    # 安卓 Root 守护进程（Kotlin + Gradle）
├── desktop-client/    # Windows 桌面客户端（Electron + React）
├── web-ui/            # 浏览器控制面板（React + Vite）
├── docs/              # 架构文档与协议规范
└── scripts/           # 构建与发布脚本
```

## 快速开始

### 方式一：Windows 桌面客户端（推荐）

USB 连接手机后自动检测、自动部署 daemon、自动建立连接。

```bash
cd desktop-client
npm install
npm run electron:dev
```

**工作流程**：
1. 手机开启 USB 调试，通过 USB 连接电脑
2. 客户端自动检测设备，显示型号/Android 版本/Root 状态
3. 点击「连接并部署」，自动推送 daemon.jar 到手机
4. 自动通过 `app_process` 启动 daemon
5. 自动执行 `adb forward tcp:27183 tcp:27183`
6. 浏览器内嵌窗口自动连接投屏

### 方式二：Web 浏览器（WiFi）

手机和电脑在同一局域网。

```bash
# 1. 编译并推送 daemon
cd android-daemon
./gradlew :app:assembleDebug
adb push app/build/outputs/apk/debug/app-debug.apk /data/local/tmp/remote-daemon.jar
adb shell "CLASSPATH=/data/local/tmp/remote-daemon.jar app_process / com.remote.daemon.Main &"

# 2. 启动前端
cd ../web-ui
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`，输入手机 IP 和配对码（默认 `000000`）连接。

## 功能规划

| 阶段 | 功能 | 状态 |
|------|------|------|
| MVP | 屏幕实时投射 + 鼠标点击操作 | ✅ |
| v1.1 | Windows 桌面客户端 + USB 自动检测 | ✅ |
| v2 | 文件管理（/data 全访问）、应用静默安装/卸载 | 规划中 |
| v3 | 交互式 Root Shell 终端、通知实时推送 | 规划中 |
| v4 | 录屏、剪贴板同步、系统控制 | 规划中 |
| v5 | 安全加固（TLS + JWT + 审计日志） | 规划中 |
| v6 | LSPosed 集成、群控、脚本录制回放 | 规划中 |

## 技术栈

- **安卓端**: Kotlin + Coroutines + MediaCodec + Java-WebSocket + libsu
- **桌面客户端**: Electron + React 18 + TypeScript + Vite + TailwindCSS + WebCodecs
- **Web 前端**: React 18 + TypeScript + Vite + TailwindCSS + WebCodecs + xterm.js
- **通信**: WebSocket + JSON-RPC 2.0

## 安全警告

本项目需要 Root 权限运行，拥有设备的完全控制权。默认配对码为 `000000`，生产环境请务必修改。WiFi 模式仅限局域网，公网使用请启用 TLS。

## License

MIT
