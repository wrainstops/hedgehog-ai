// 本地 LLM 推理引擎（封装 node-llama-cpp）
// 支持：模型加载/卸载、流式生成、会话管理
//
// 注：node-llama-cpp 首次安装需要 cmake 编译原生模块。
// 如果编译失败（例如无 cmake / 网络问题），会自动降级为 mock 模式，
// 保证应用能跑起来（回复固定提示文本帮助你调试 UI）

const path = require('node:path');
const fs = require('node:fs');

// 尝试多种方式解析 node-llama-cpp 路径
function getLlamaCppPath() {
  // __dirname 在 electron/features/llm/ 下
  // 需要向上找到 apps/desktop 目录
  const desktopBase = path.join(__dirname, '..', '..', '..');
  
  // 方式1: 从 apps/desktop/node_modules 解析 (标准 npm/yarn)
  const desktopNodeModules = path.join(desktopBase, 'node_modules', 'node-llama-cpp', 'package.json');
  if (fs.existsSync(desktopNodeModules)) {
    console.log('[llm] Found node-llama-cpp at desktop node_modules');
    return path.join(path.dirname(desktopNodeModules), 'dist', 'index.js');
  }
  
  // 方式2: 从根目录 node_modules 解析 (标准 npm/yarn)
  const rootBase = path.join(__dirname, '..', '..', '..', '..');
  const rootNodeModules = path.join(rootBase, 'node_modules', 'node-llama-cpp', 'package.json');
  if (fs.existsSync(rootNodeModules)) {
    console.log('[llm] Found node-llama-cpp at root node_modules');
    return path.join(path.dirname(rootNodeModules), 'dist', 'index.js');
  }
  
  // 方式3: pnpm store 路径 (node_modules/.pnpm/node-llama-cpp@xxx/node_modules/node-llama-cpp)
  const pnpmDir = path.join(rootBase, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    try {
      const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('node-llama-cpp@')) {
          const pkgPath = path.join(pnpmDir, entry.name, 'node_modules', 'node-llama-cpp', 'package.json');
          if (fs.existsSync(pkgPath)) {
            console.log('[llm] Found node-llama-cpp in pnpm store:', pkgPath);
            return path.join(path.dirname(pkgPath), 'dist', 'index.js');
          }
        }
      }
    } catch (e) {
      console.warn('[llm] Error reading pnpm directory:', e.message);
    }
  }
  
  return null;
}

let llama = null;
let llamaLoaded = false;
let importFailedError = null;

async function ensureLlama() {
  console.log('[llm] ensureLlama called, llamaLoaded=', llamaLoaded, 'llama===null?', llama === null, 'Boolean(llama):', Boolean(llama));
  
  if (llamaLoaded) {
    const result = llama !== null;
    console.log('[llm] ensureLlama: llamaLoaded=true, returning', result);
    return result;
  }
  
  console.log('[llm] ensureLlama: llamaLoaded=false, will try import');
  
  // 首先尝试直接通过包名导入
  try {
    console.log('[llm] ensureLlama: trying import("node-llama-cpp")...');
    const imported = await import('node-llama-cpp');
    console.log('[llm] ensureLlama: import by name succeeded, keys:', Object.keys(imported).slice(0, 5));
    llama = imported;
    llamaLoaded = true;
    return true;
  } catch (err) {
    console.warn('[llm] ensureLlama: import by name failed:', err.message);
  }
  
  // 尝试通过绝对路径导入
  const absolutePath = getLlamaCppPath();
  console.log('[llm] ensureLlama: getLlamaCppPath returned:', absolutePath);
  
  if (absolutePath) {
    try {
      console.log('[llm] ensureLlama: trying import with absolute path:', absolutePath);
      const imported = await import(`file://${absolutePath}`);
      console.log('[llm] ensureLlama: import by absolute path succeeded');
      llama = imported;
      llamaLoaded = true;
      return true;
    } catch (err) {
      console.warn('[llm] ensureLlama: import by absolute path failed:', err.message);
    }
  } else {
    console.warn('[llm] ensureLlama: getLlamaCppPath returned null, cannot try absolute path');
  }
  
  // 都失败了
  console.warn('[llm] ensureLlama: all import methods failed');
  llama = null;
  llamaLoaded = true;
  return false;
}
// 启动时尝试预加载（不阻塞，但捕获错误避免警告）
console.log('[llm] Starting ensureLlama in background...');
ensureLlama().then(success => {
  console.log('[llm] Background ensureLlama completed, success:', success);
}).catch(err => {
  console.error('[llm] Background ensureLlama failed:', err.message);
});

const { app, BrowserWindow } = require('electron');

/** @type {{ model:any, context:any, chat:any, state:import('@hedgehog/protocol').LlamaState }} */
let engine = { model: null, context: null, chat: null, state: {
  modelId: null, modelName: null, modelPath: null, status: 'idle',
  gpuLayers: 0, threads: 4, contextSize: 4096,
}};

let abortFlag = false;

/** 是否处于 mock 模式（无原生依赖时） */
function isMock() {
  if (llama === null) {
    console.log('[llm] isMock=true because llama is null');
  }
  return llama === null;
}

async function loadModel(itemId, modelPath, opts = {}) {
  // 0) 先确保 node-llama-cpp 已加载
  console.log('[llm] loadModel: about to call ensureLlama');
  const loaded = await ensureLlama();
  console.log('[llm] loadModel: ensureLlama returned:', loaded, 'llama:', typeof llama);

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

    // 3) node-llama-cpp v3 API
    const { getLlama, LlamaChatSession } = llama;
    const llamaInstance = await getLlama();
    const model = await llamaInstance.loadModel({
      modelPath,
      gpuLayers: opts.gpuLayers ?? 0,
    });
    const context = await model.createContext({
      contextSize: opts.contextSize ?? 4096,
    });
    const chat = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });

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
  console.log('[llm] generate called, current llama:', typeof llama, 'isMock:', isMock());
  if (engine.state.status !== 'ready') {
    return { ok: false, error: `model not ready (status=${engine.state.status})` };
  }
  const systemMsg = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');
  const prompt = buildPrompt(messages);

  // 超时控制：默认 2 分钟
  const TIMEOUT_MS = options.timeout ?? 120000;
  let timeoutId = null;
  let isTimedOut = false;

  try {
    engine.state.status = 'generating';
    broadcastState();
    abortFlag = false;

    if (isMock()) {
      console.log('[llm] generate: entering mock mode');
      // mock 模式：逐字打印固定回复（用于 UI 调试）
      const mockReply = `（演示模式，未安装 node-llama-cpp）\n我当前无法执行真正的推理。\n请在能力市场下载一个 .gguf 模型文件并加载。\n收到的消息：\n` + messages.map(m => `- ${m.role}: ${m.content}`).join('\n');
      for (const ch of mockReply) {
        if (abortFlag || isTimedOut) break;
        onToken(ch);
        await new Promise(r => setTimeout(r, 20));
      }
      engine.state.status = 'ready';
      broadcastState();
      return { ok: true, text: mockReply, tokensPerSecond: 50 };
    }

    // 设置超时
    const chat = engine.chat;
    let fullText = '';
    const start = Date.now();

    // 创建超时 Promise
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        reject(new Error(`推理超时 (${TIMEOUT_MS / 1000}秒)，可能是模型过大或硬件性能不足`));
      }, TIMEOUT_MS);
    });

    // 竞态：推理 vs 超时
    const inferencePromise = new Promise((resolve, reject) => {
      (async () => {
        try {
          const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
          
          // 使用 process.nextTick 让出主线程，使 UI 可以更新
          const yieldToEventLoop = () => new Promise(resolve => process.nextTick(resolve));
          
          await chat.prompt(lastUserMessage, {
            onTextChunk: async (chunk) => {
              if (typeof chunk === 'string') {
                fullText += chunk;
                // 先发送 token
                onToken(chunk);
                // 让出主线程，防止 UI 冻结
                await yieldToEventLoop();
              }
            },
            temperature: options.temperature ?? 0.7,
            topK: options.topK ?? 40,
            topP: options.topP ?? 0.95,
            repeatPenalty: options.repeatPenalty ?? 1.1,
            repeatLastN: options.repeatLastN ?? 64,
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      })();
    });

    await Promise.race([inferencePromise, timeoutPromise]);

    // 推理成功完成
    if (timeoutId) clearTimeout(timeoutId);
    const elapsed = (Date.now() - start) / 1000;
    const tps = elapsed > 0 ? Math.round(fullText.length / elapsed) : 0;

    engine.state.status = 'ready';
    broadcastState();
    return { ok: true, text: fullText, tokensPerSecond: tps };
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    engine.state.status = 'error';
    engine.state.error = String(err?.message || err);
    if (err.message.includes('超时')) {
      // 超时不算真正的错误，恢复 ready 状态
      engine.state.status = 'ready';
    }
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
