// LLM 本地推理的协议类型
// 使用 node-llama-cpp 作为推理引擎

export interface LlamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlamaGenerateOptions {
  temperature?: number;       // 默认 0.7
  topK?: number;               // 默认 40
  topP?: number;               // 默认 0.95
  maxTokens?: number;          // 默认 -1（模型上下文上限）
  repeatPenalty?: number;      // 默认 1.1
  repeatLastN?: number;        // 默认 64
}

export interface LlamaLoadOptions {
  modelPath: string;
  contextSize?: number;        // 默认 4096
  gpuLayers?: number;           // 默认 0 (纯 CPU)
  threads?: number;             // 默认 4
  seed?: number;                // 默认随机
}

export interface LlamaState {
  modelId: string | null;       // local_items.id
  modelName: string | null;
  modelPath: string | null;
  status: 'idle' | 'loading' | 'ready' | 'generating' | 'error';
  error?: string;
  gpuLayers: number;
  threads: number;
  contextSize: number;
}

export type LlamaStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; text: string; tokensPerSecond: number }
  | { type: 'error'; message: string };
