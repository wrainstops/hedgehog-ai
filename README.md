# Hedgehog AI · README

> 本文档记录**已实现功能、快速启动、本地验证、打包发布**。  
> 若你想了解**产品目标、功能/非功能需求、技术设计**，请阅读 [docs/design.md](docs/design.md)。

---

## 快速启动

```bash
# 1. 安装前准备
# visual studio 2022 (https://aka.ms/vs/17/release/vs_community.exe)
# 安装时勾选“使用c++的桌面开发”，并在右侧详细信息中勾选“适用于最新v143生成工具的c++MFC”；“对v143生成工具（最新）的c++/CLI支持”；“windows SDK”；“MSVC V142 - VS 2019 C++ x64/x86 生成工具”...
# 设置用户环境变量“msvs_version: 2022”；“VCINSTALLDIR: XXX\2022\Community\VC”（即 visual studio 2022产品的安装目录下的VC目录）

# 2. 安装依赖（需要 Node 22, pnpm 8）
cd hedgehog
npm install -g node-gyp
pnpm install

# 3. 开发模式启动（Vite + Electron 同时拉起）
pnpm dev

# 4. 生产构建（分两步，先 build 再打包）
cd apps/desktop
pnpm build
pnpm dist:win           # 或 dist:mac / dist:linux
```

> 首次启动应用后，先在「能力市场」下载一个 LLM 模型（或把本地 `*.gguf` 文件放入用户数据目录 `llms/`），然后在「已安装」页点击"加载"。

---

## 已实现功能模块

### 1. 能力市场（Capability Market）
- **三 Tab**：语言模型（LLM） / 语音识别（ASR） / 语音合成（TTS，占位）
- **下载引擎**：HTTP Range 断点续传、实时 SHA-256、速度 / ETA 计算、mirror 回退、zip 解压
- **catalog 三级回退**：在线 URL → userData 缓存 → 内置 `resources/fallback-models.json`
- **本地注册表**：已安装项（llm / asr / tts）在 SQLite（或 fallback JSON）中统一管理

### 2. 本地 LLM 推理（`node-llama-cpp`）
- 流式生成，UI 端逐 token 展示
- 加载 / 卸载管理；支持 `contextSize / threads / gpuLayers` 配置
- 未安装 `node-llama-cpp` 时自动进入 **mock 模式**（逐字打印确认消息），便于 UI 调试

### 3. 语音对话 MVP
- 基于 Electron 内置的 **Web Speech API**（中文 `zh-CN`）
- 长按麦克风按钮录音 → 识别文本自动追加到输入框
- 无需额外服务进程 / 模型下载即可演示

### 4. 系统级 i18n（zh-CN / en-US）
- 命名空间：`common / nav / model-market / voice`
- 主进程集中管理，设置页切换语言

---

## 目录结构

```
hedgehog/
├── package.json              # monorepo 根 (pnpm workspace)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
├── README.md               # 本文档
├── docs/
│   └── design.md             # 产品与技术设计文档
├── packages/
│   ├── protocol/src/         # 跨模块类型（capability / llm / voice / i18n）
│   ├── storage/src/          # SQLite 封装（local_items / downloads / settings）
│   └── i18n/                 # 系统级多语言 + locales JSON
├── apps/desktop/
│   ├── electron/
│   │   ├── main.cjs          # Electron 主进程（能力市场 + LLM + voice IPC）
│   │   ├── preload.cjs       # 暴露 window.hedgehog.* API
│   │   └── features/
│   │       └── llm/index.cjs # node-llama-cpp 封装（含 mock 模式）
│   ├── features/             # TypeScript 参考实现（catalog / downloader / registry）
│   ├── resources/
│   │   └── fallback-models.json   # 离线 catalog
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── hooks/useVoice.ts       # Web Speech API 封装（长按录音 → 识别）
│   │   ├── components/DownloadBar.tsx
│   │   └── pages/                  # Market / Installed / Conversation / Settings
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
└── services/                      # （预留）Python 等独立进程服务
```

---

## IPC API 一览（`window.hedgehog.*`）

### 能力市场
| 方法 | 返回 | 说明 |
|---|---|---|
| `capabilityMarket.getCatalog({kind?})` | `{items, updated_at, source}` | 获取 catalog（可按 kind 过滤） |
| `capabilityMarket.refreshCatalog({kind?})` | `{items, updated_at, source}` | 强制刷新（跳过本地缓存） |
| `capabilityMarket.listLocalItems({kind?})` | `LocalItem[]` | 本地已安装项 |
| `capabilityMarket.setCurrentItem(kind, id, version)` | `bool` | 标记当前使用项 |
| `capabilityMarket.deleteLocalItem(kind, id, version)` | `bool` | 删除（含磁盘目录） |
| `capabilityMarket.startDownload(id)` | `bool` | 启动下载（异步，订阅进度） |
| `capabilityMarket.pauseDownload(id)` | `void` | |
| `capabilityMarket.resumeDownload(id)` | `void` | |
| `capabilityMarket.cancelDownload(id)` | `void` | |

### LLM 推理
| 方法 | 返回 | 说明 |
|---|---|---|
| `llm.getState()` | `LlamaState` | `{modelId, status, isMock}` |
| `llm.load(id, installPath, {contextSize, threads, gpuLayers})` | `{ok, error?}` | |
| `llm.unload()` | `void` | |
| `llm.generate(messages, {temperature, topK, …})` | `{ok, text, tokensPerSecond?}` | 流式 token 通过 `llm:token` 事件推送 |
| `llm.stop()` | `void` | 中断当前生成 |

### 语音（Web Speech API，渲染侧封装）
- `voice.startRecording()` / `stopRecording()` / `cancelRecording()` / `getState()`
- 麦克风权限由系统弹窗授予

---

## 本地验证清单

- [ ] `pnpm install` 成功
- [ ] `pnpm dev` 正常打开 Electron 窗口
- [ ] 左侧导航可切换四个页面
- [ ] "已安装"页显示本地 LLM
- [ ] 对话页可输入文本 + 语音识别转文字
- [ ] 加载一个 `.gguf` 后流式回复正常
- [ ] `pnpm build && pnpm dist:win` / `dist:mac` / `dist:linux` 打包成功

---

## 打包发布

在 `apps/desktop/package.json` 中已配置 `electron-builder`：

```bash
cd apps/desktop
pnpm build               # 先构建 React 产物
pnpm pack                # 仅生成可执行目录（不打安装包，调试用）
pnpm dist:win            # Windows：NSIS 安装包 + Portable
pnpm dist:mac            # macOS：dmg + zip
pnpm dist:linux          # Linux：AppImage + deb
```

安装包输出目录：`apps/desktop/release/`。

---

## 后续可扩展方向

1. **Agent Runtime**：把 LLM 与工具调用合成为 tool-calling agent（对话页由模型自动选择合适工具）
2. **多轮对话持久化**：当前消息仅存内存，可写入 SQLite
3. **本地 ASR/TTS**：替换 Web Speech API 为 Vosk / Whisper.cpp / piper 等本地模型
4. **模型格式兼容**：除 GGUF 外支持 ollama / OpenAI-compatible 远程端点
5. **应用内更新**：主版本 + catalog 都支持增量更新（electron-updater）
