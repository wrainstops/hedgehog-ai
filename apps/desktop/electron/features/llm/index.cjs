// 本地 LLM 推理引擎（封装 node-llama-cpp）
// 支持：模型加载/卸载、流式生成、会话管理
//
// 注：node-llama-cpp 首次安装需要 cmake 编译原生模块。
// 如果编译失败（例如无 cmake / 网络问题），会自动降级为 mock 模式，
// 保证应用能跑起来（回复固定提示文本帮助你调试 UI）

const path = require('node:path');
const fs = require('node:fs');

let llama = null;
try {
  llama = require('node-llama-cpp');
} catch (err) {
  console.warn('[llm] node-llama-cpp not installed — running in mock mode');
  llama = null;
}

const { app, BrowserWindow } = require('electron');

/** @type {{ model:any, context:any, chat:any, state:import('@hedgehog/protocol').LlamaState }} */
let engine = { model: null, context: null, chat: null, state: {
  modelId: null, modelName: null, modelPath: null, status: 'idle',
  gpuLayers: 0, threads: 4, contextSize: 4096,
}};

let abortFlag = false;

/** 是否处于 mock 模式（无原生依赖时） */
function isMock() {
  return llama === null;
}

async function loadModel(itemId, modelPath, opts = {}) {
  // 1) 校验路径
  if (!fs.existsSync(modelPath)) {
    return { ok: false, error: `model not found: ${modelPath}` };
  }
  engine.state.status = 'loading';
  broadcastState();

  try {
    if (isMock()) {
      // mock 模式：假装加载成功，延迟 500ms
      await new Promise(r => setTimeout(r, 500));
      engine.state = {
        modelId: itemId, modelName: path.basename(modelPath),
        modelPath, status: 'ready', gpuLayers: 0,
        threads: opts.threads || 4, contextSize: opts.contextSize || 2048,
      };
      broadcastState();
      return { ok: true };
    }

    // 2) 卸载旧模型
    if (engine.chat) { try { await engine.chat.dispose(); } catch {} }
    if (engine.context) { try { await engine.context.dispose(); } catch {} }
    if (engine.model) { try { await engine.model.dispose(); } catch {} }

    // 3) 创建新模型 / 上下文 / chat
    const { LlamaModel, LlamaContext, LlamaChatSession } = llama;
    const model = new LlamaModel({
      modelPath,
      gpuLayers: opts.gpuLayers ?? 0,
      threads: opts.threads ?? 4,
    });
    const context = new LlamaContext({
      model,
      contextSize: opts.contextSize ?? 4096,
    });
    const chat = new LlamaChatSession({ context });

    engine = {
      model, context, chat,
      state: {
        modelId: itemId,
        modelName: path.basename(modelPath),
        modelPath,
        status: 'ready',
        gpuLayers: opts.gpuLayers ?? 0,
        threads: opts.threads ?? 4,
        contextSize: opts.contextSize ?? 4096,
      },
    };
    broadcastState();
    return { ok: true };
  } catch (err) {
    engine.state.status = 'error';
    engine.state.error = String(err?.message || err);
    broadcastState();
    return { ok: false, error: engine.state.error };
  }
}

async function unloadModel() {
  try {
    if (engine.chat) { await engine.chat.dispose(); engine.chat = null; }
    if (engine.context) { await engine.context.dispose(); engine.context = null; }
    if (engine.model) { await engine.model.dispose(); engine.model = null; }
  } catch {}
  engine.state = {
    modelId: null, modelName: null, modelPath: null, status: 'idle',
    gpuLayers: 0, threads: 4, contextSize: 4096,
  };
  broadcastState();
}

/**
 * 流式生成文本
 * @param {Array<{role:string,content:string}>} messages
 * @param {(text:string)=>void} onToken
 */
async function generate(messages, onToken, options = {}) {
  if (engine.state.status !== 'ready') {
    return { ok: false, error: `model not ready (status=${engine.state.status})` };
  }
  const systemMsg = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');
  const prompt = buildPrompt(messages);

  try {
    engine.state.status = 'generating';
    broadcastState();
    abortFlag = false;

    if (isMock()) {
      // mock 模式：逐字打印固定回复（用于 UI 调试）
      const mockReply = `（演示模式，未安装 node-llama-cpp）\n我当前无法执行真正的推理。\n请在能力市场下载一个 .gguf 模型文件并加载。\n收到的消息：\n` + messages.map(m => `- ${m.role}: ${m.content}`).join('\n');
      for (const ch of mockReply) {
        if (abortFlag) break;
        onToken(ch);
        await new Promise(r => setTimeout(r, 20));
      }
      engine.state.status = 'ready';
      broadcastState();
      return { ok: true, text: mockReply, tokensPerSecond: 50 };
    }

    const chat = engine.chat;
    let fullText = '';
    const start = Date.now();

    // 使用 node-llama-cpp promptWithHistory 或 chat
    if (typeof chat.promptWithChatHistory === 'function') {
      const history = messages.map(m => ({
        type: m.role === 'user' ? 'user' : (m.role === 'system' ? 'system' : 'model'),
        text: m.content,
      }));
      await chat.promptWithChatHistory(history, {
        onTextChunk: (chunk) => { if (typeof chunk === 'string') { fullText += chunk; onToken(chunk); } },
        temperature: options.temperature ?? 0.7,
        topK: options.topK ?? 40,
        topP: options.topP ?? 0.95,
        repeatPenalty: options.repeatPenalty ?? 1.1,
        repeatLastN: options.repeatLastN ?? 64,
      });
    } else {
      // fallback: 简单 prompt
      await chat.prompt(prompt, {
        onToken: (chunk) => {
          const s = typeof chunk === 'string' ? chunk : engine.context?.decode?.(chunk) || '';
          fullText += s; onToken(s);
        },
        temperature: options.temperature ?? 0.7,
        topK: options.topK ?? 40,
        topP: options.topP ?? 0.95,
      });
    }
    const elapsed = (Date.now() - start) / 1000;
    const tps = elapsed > 0 ? Math.round(fullText.length / elapsed) : 0;

    engine.state.status = 'ready';
    broadcastState();
    return { ok: true, text: fullText, tokensPerSecond: tps };
  } catch (err) {
    engine.state.status = 'error';
    engine.state.error = String(err?.message || err);
    broadcastState();
    return { ok: false, error: engine.state.error };
  }
}

function stopGeneration() { abortFlag = true; }

/**
 * 把 messages 拼接成简单提示词（在 mock / 老版本 API  fallback 路径用）
 */
function buildPrompt(messages) {
  return messages
    .map(m => {
      if (m.role === 'system') return `### System\n${m.content}\n`;
      if (m.role === 'user') return `### User\n${m.content}\n`;
      return `### Assistant\n${m.content}\n`;
    })
    .join('\n') + '### Assistant\n';
}

function getState() {
  return { ...engine.state, isMock: isMock() };
}

function broadcastState() {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    if (w.isDestroyed()) continue;
    w.webContents.send('llm:state', getState());
  }
}

module.exports = {
  loadModel,
  unloadModel,
  generate,
  stopGeneration,
  getState,
  isMock,
};
