// 语音对话模块类型定义

export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'error';

export interface VoiceState {
  status: VoiceStatus;
  error?: string;
  asrModel?: string;      // 当前使用的 ASR 模型 id
  lang?: string;          // zh / en
}

/** 渲染层 → 主进程（IPC 通道：voice:*） */
export interface VoiceAPI {
  startRecording(): Promise<void>;
  stopRecording(): Promise<{ text: string }>;
  cancelRecording(): Promise<void>;
  getState(): Promise<VoiceState>;
  subscribe(handler: (state: VoiceState) => void): () => void;

  // 设置
  setAsrModel(modelId: string): Promise<void>;
  setLang(lang: string): Promise<void>;
}

/** 主进程 → Python 子进程（stdio JSON 协议） */
export interface AsrCommandLine {
  cmd: 'transcribe' | 'ping' | 'shutdown';
  data?: string;    // base64 音频数据
  model?: string;   // ASR 模型目录（子进程启动时已传入；可留空）
  language?: string; // zh / en
}

export interface AsrResultLine {
  cmd: 'result' | 'pong' | 'error';
  text?: string;
  error?: string;
}
