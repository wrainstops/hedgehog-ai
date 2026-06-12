# Hedgehog AI · 产品与技术设计文档（v0.4）

> **产品定位**：本地 LLM 智能桌面应用
> **运行环境**：Windows / macOS / Linux（Electron）
> **代码仓库**：monorepo（pnpm workspace）— `packages/*` + `apps/*` + `services/*`
> **本文档范围**：功能需求、非功能约束、技术架构、模块设计、上线与分发策略

---

## 1. 产品目标

| 目标 | 说明 |
|---|---|
| **本地优先** | 模型、语音识别/合成、技能默认在本机运行，保证隐私与离线可用性 |
| **低门槛** | 用户无需安装 Python / 驱动。首次安装后可直接进入"对话"体验 |
| **可扩展** | 能力市场下载模型 / 语音 / 技能；开发者可通过 skill.json 提交新能力 |
| **全球友好** | 系统级 i18n（zh-CN / en-US，预留更多） |

---

## 2. 功能需求（Functional Requirements）

### 2.1 基础框架
- **FR-1**：Electron 单窗口应用，主界面包含左侧导航 + 右侧内容区
- **FR-2**：四个一级页面：对话 / 能力市场 / 已安装 / 设置
- **FR-3**：所有文字通过 i18n 模块获取（硬编码字符串为异常）

### 2.2 系统级 i18n
- **FR-11**：应用启动后读取 `settings.i18n.lang`；默认 `zh-CN`
- **FR-12**：设置页提供语言下拉；切换后立即应用于全系统（主进程 + 渲染进程）
- **FR-13**：语言文件按命名空间拆分：`common / nav / model-market / voice / skill-market`
- **FR-14**：缺失 key 时回退到 `en-US`，并在 dev console 输出警告

### 2.3 能力市场（Capability Market）
- **FR-21**："模型市场"升级为"能力市场"，按能力类型分 Tab：
  - LLM（语言模型）
  - ASR（语音识别）
  - TTS（语音合成）
  - Skill（技能）
- **FR-22**：卡片展示：名称、简介、大小、推荐标识、作者/来源、版本
- **FR-23**：下载/暂停/恢复/取消；支持断点续传与 mirror 回退
- **FR-24**：支持通过 URL 或镜像列表自定义 catalog 源（预留 UI，先不实现）
- **FR-25**：离线兜底：内置 `resources/fallback-models.json`

### 2.4 本地 LLM 推理
- **FR-31**：对话页流式生成，UI 逐 token 追加
- **FR-32**：支持加载、卸载、切换模型；配置项：`contextSize / threads / gpuLayers`
- **FR-33**：未安装 `node-llama-cpp` 原生依赖时进入 mock 模式，UI 可演示全链路

### 2.5 语音对话
- **FR-41**：长按麦克风按钮录音，松开触发识别
- **FR-42**：识别文本自动填入输入框，可手动修改后发送
- **FR-43**：优先使用 Electron 内置 Web Speech API；本地模型（Vosk/Whisper.cpp）留作可选项

### 2.6 技能市场与运行时
- **FR-51**：skill.json manifest 驱动：`id / version / name / description / runtime / permissions / tools / input_schema / response_path`
- **FR-52**：首版实现 **http-proxy** 执行器，支持 URL 模板参数替换、host 白名单
- **FR-53**：UI 提供测试调用入口，展示原始 JSON 结果
- **FR-54**：默认启用全部技能；可手动禁用/卸载

---

## 3. 非功能约束（Non-Functional Requirements）

- **NFR-1**：首次安装包 ≤ 250 MB（不含模型）
- **NFR-2**：LLM 推理 CPU 占用 ≤ 80%（四核机器，1.5B 模型，4 threads）
- **NFR-3**：下载失败率 ≤ 2%（含 mirror 回退）
- **NFR-4**：UI 响应 ≤ 100 ms（除 LLM 流式输出本身）
- **NFR-5**：模型/技能的用户数据存储位置使用 `app.getPath('userData')`
- **NFR-6**：支持 Windows 10 1809+ / macOS 11+ / Ubuntu 20.04+
- **NFR-7**：下载引擎提供断点续传、SHA-256 校验、速度与 ETA 显示
- **NFR-8**：Electron 主进程通过 IPC 暴露 API；渲染进程不可直接读写磁盘
- **NFR-9**：skill.json 的网络请求必须在 `permissions.network` host 白名单内
- **NFR-10**：语言切换不丢失当前对话或下载状态
- **NFR-11**：i18n key 命名统一为 `namespace.key`；不得出现裸字符串
- **NFR-12**：语音功能在无麦克风权限时优雅失败并提示用户
- **NFR-13**：所有可下载能力项的 version 遵循 semver，用于升级检测
- **NFR-14**：错误信息面向用户可理解（避免堆栈原文），dev console 输出完整错误

---

## 4. 技术实现

### 4.1 整体架构

```
┌──────────────────────────┐
│   Electron Renderer      │  ← React + Vite
│  ├─ 对话 / 市场 / 已安装 / 设置
│  └─ useVoice (Web Speech)
└────────┬─────────────────┘
         │ IPC (contextBridge)
┌────────▼─────────────────┐
│   Electron Main (Node)   │  ← main.cjs + preload.cjs
│  ├─ 能力市场（下载/注册表）
│  ├─ LLM（node-llama-cpp）
│  └─ Skill（http-proxy executor）
└────────┬─────────────────┘
         │ file system
┌────────▼─────────────────┐
│  userData/               │  ← llms / skills / catalog-cache / downloads.db
└──────────────────────────┘
```

### 4.2 能力市场 — catalog schema

```jsonc
{
  "version": 1,
  "updated_at": "2026-06-12T00:00:00Z",
  "items": [
    {
      "id": "qwen2-1.5b-instruct-q4_k_m",
      "kind": "llm",
      "version": "1.0.0",
      "name": "Qwen2 1.5B Instruct (Q4_K_M)",
      "description": "…",
      "size_bytes": 933000000,
      "sources": [
        { "url": "https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF/resolve/main/qwen2-1_5b-instruct-q4_k_m.gguf",
          "sha256": "…" }
      ],
      "capabilities": { "chat_format": "chatml" }
    },
    {
      "id": "faster-whisper-small-zh",
      "kind": "asr",
      "version": "1.0.0",
      "name": "Faster-Whisper Small (zh)",
      "size_bytes": 470000000,
      "sources": [{ "url": "…", "sha256": "…" }]
    },
    {
      "id": "skill-weather-cn",
      "kind": "skill",
      "version": "1.0.0",
      "name": "天气查询（中国城市）",
      "size_bytes": 2048,
      "sources": [{ "url": "…/weather-cn.zip", "sha256": "…" }]
    }
  ]
}
```

### 4.3 能力市场 — 下载引擎
- 使用 Node.js `https.get` + `Range` header，已下载部分写入临时文件 `.part`
- 完成后重命名并校验 sha256；`.zip` 自动解压到按 `kind` 组织的目录
- 下载条目写入 SQLite（或 fallback JSON），UI 轮询/订阅状态更新

### 4.4 LLM 推理
- 封装在 `electron/features/llm/index.cjs`；优先 require `node-llama-cpp`
- 流式生成通过 IPC 事件 `llm:token` 推送 token；`generate()` 返回最终文本和 token/s
- mock 模式无原生依赖也可演示全链路

### 4.5 语音
- 渲染侧 `useVoice` 封装 Web Speech API；长按 → 识别 → 填入输入框
- 本地 ASR（Vosk/Whisper.cpp）后续可通过独立 Node worker 接入，保持同一协议

### 4.6 技能运行时（http-proxy executor）
- manifest 位于 `{userData}/skills/<id>-<version>/skill.json`
- `invoke(id, version, toolName, args)` 执行：
  1. 校验 enabled 状态
  2. 填充 `{param}` 模板到 URL
  3. 校验 host 白名单
  4. 发起 HTTP(S) 请求，解析 JSON，可选 `response_path` 点号裁剪
  5. 返回 `{ok, data, error?}`

### 4.7 i18n
- 主进程集中管理语言文件（JSON），提供 `t('ns.key')` 与 `setLang()`
- 渲染进程通过 IPC 拉取文本；语言变化广播事件 `i18n:changed`

---

## 5. 上线与分发策略

- **LLM/语音/技能**：通过能力市场下载，不与安装包绑定
- **安装包**：Windows NSIS + Portable；macOS dmg+zip；Linux AppImage+deb
- **内置兜底 catalog**：`resources/fallback-models.json`，网络不可用时使用
- **应用内更新**：主版本走 electron-updater（后续接入）；能力项走 catalog 升级检测

---

## 6. 目录结构（约定）

```
hedgehog/
├── package.json / pnpm-workspace.yaml
├── tsconfig.base.json / turbo.json
├── docs/
│   └── design.md              # 本文档（产品 + 技术设计）
├── packages/
│   ├── protocol/src/          # 跨模块类型（capability / skill / llm / voice / i18n）
│   ├── storage/src/           # SQLite（或 JSON fallback）封装
│   └── i18n/src/              # 系统级多语言
├── apps/desktop/
│   ├── electron/
│   │   ├── main.cjs           # IPC 入口
│   │   ├── preload.cjs        # window.hedgehog.*
│   │   └── features/
│   │       ├── llm/index.cjs  # node-llama-cpp 封装（含 mock 模式）
│   │       └── skill/index.cjs# http-proxy executor
│   ├── resources/
│   │   ├── fallback-models.json
│   │   └── sample-skills/     # 示例技能（weather-cn, todo-local）
│   ├── src/
│   │   ├── App.tsx / main.tsx
│   │   ├── hooks/useVoice.ts
│   │   ├── components/DownloadBar.tsx
│   │   └── pages/             # Market / Installed / Conversation / Settings
│   ├── index.html / vite.config.ts / tsconfig.json
│   └── package.json           # electron-builder 配置在此
└── services/                  # （预留）Python 等独立进程服务
```
