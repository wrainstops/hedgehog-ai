// 能力市场 catalog 类型定义
// 对应 design.md §4.3 的 models.json / local_items / downloads

/** 能力项类型 */
export type ItemKind = 'llm' | 'asr' | 'tts' | 'skill';

/** 多语言字符串（zh-CN / en-US 双写） */
export interface I18nString {
  'zh-CN': string;
  'en-US': string;
  [lang: string]: string;
}

/** 下载信息（统一格式；zip 包需要 needsUnzip） */
export interface DownloadInfo {
  url: string;
  filename: string;
  sha256: string;
  mirrors: string[];
  needsUnzip?: boolean;
}

/** LLM 专属字段 */
export interface LlmExtra {
  quant: string;           // Q4_K_M / Q5_K_M / FP16 ...
  languages: string[];     // zh, en, ...
}

/** ASR 专属字段 */
export interface AsrExtra {
  format?: string;         // ctranslate2 / whisper.cpp / vosk
  languages?: string[];
}

/** TTS 专属字段（MVP 不实现，预留结构） */
export interface TtsExtra {
  format?: string;
  voicePresets?: string[];
}

/** Skill 专属字段 */
export interface SkillExtra {
  runtime: 'http-proxy' | 'node-script' | 'json-config';
  permissions?: {
    network?: string[];
    fs?: string[];
    child_process?: string[];
  };
  tools: SkillTool[];
}

export interface SkillTool {
  name: string;
  description: I18nString;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** catalog 中的单个能力项（LLM / ASR / TTS / Skill 统一建模） */
export interface CatalogItem {
  id: string;
  version: string;
  kind: ItemKind;
  name: I18nString;
  description: I18nString;
  size_bytes: number;
  recommended?: boolean;
  min_memory_gb?: number;
  license: { name: string; url: string };
  source: { name: string; repo?: string };
  download: DownloadInfo;

  // kind 专属字段（按 kind 读取对应字段）
  llm?: LlmExtra;
  asr?: AsrExtra;
  tts?: TtsExtra;
  skill?: SkillExtra;
}

/** catalog 根结构 */
export interface Catalog {
  version: number;
  updated_at: string;
  items: CatalogItem[];
}

export type CatalogSource = 'online' | 'cache' | 'fallback';

/** 下载进度/状态 */
export type DownloadStateStatus =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'paused'
  | 'failed'
  | 'done';

export interface DownloadState {
  id: string;
  kind: ItemKind;
  state: DownloadStateStatus;
  total_bytes: number;
  downloaded_bytes: number;
  speed_bps: number;
  error?: string;
}

/** 本地已安装项注册表 */
export interface LocalItem {
  id: string;
  version: string;
  kind: ItemKind;
  name: string;           // 展示 fallback 名称（可被 catalog 的 i18n 字符串覆盖）
  size_bytes?: number;
  install_path: string;    // 磁盘真实位置（目录或单个文件）
  sha256?: string;
  downloaded_at: number;
  is_current: number;      // 0/1：该 kind 下的当前使用项
  is_manual_import: number;
}

/** 主进程对外暴露的能力市场 API（IPC 通道） */
export interface CapabilityMarketAPI {
  getCatalog(opts?: { kind?: ItemKind }): Promise<{
    items: CatalogItem[];
    updated_at: string;
    source: CatalogSource;
  }>;
  refreshCatalog(opts?: { kind?: ItemKind }): Promise<{
    items: CatalogItem[];
    updated_at: string;
    source: 'online' | 'fallback';
  }>;

  listLocalItems(opts?: { kind?: ItemKind }): Promise<LocalItem[]>;
  setCurrentItem(kind: ItemKind, id: string, version: string): Promise<void>;
  deleteLocalItem(kind: ItemKind, id: string, version: string): Promise<void>;
  importLocalFile(kind: ItemKind, filePath: string): Promise<LocalItem>;

  startDownload(itemId: string): Promise<void>;
  pauseDownload(itemId: string): Promise<void>;
  resumeDownload(itemId: string): Promise<void>;
  cancelDownload(itemId: string): Promise<void>;

  subscribeDownloads(handler: (states: DownloadState[]) => void): () => void;
}

/** Settings key 定义（与 design.md 保持一致） */
export const SETTING_KEYS = {
  CATALOG_URL: 'catalog_url',
  LLMS_DIR: 'llms_dir',
  ASRS_DIR: 'asrs_dir',
  TTSS_DIR: 'ttss_dir',
  SKILLS_DIR: 'skills_dir',
  MAX_CONCURRENT_DOWNLOADS: 'max_concurrent_downloads',
  VOICE_ASR_MODEL: 'voice.asr_model',
  VOICE_ASR_LANG: 'voice.asr_lang',
  I18N_LANG: 'i18n.lang',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** 统一的 Settings API（主进程 & 渲染侧共用） */
export interface SettingsAPI {
  getSetting(key: SettingKey | string): Promise<string | null>;
  setSetting(key: SettingKey | string, value: string): Promise<void>;
}
