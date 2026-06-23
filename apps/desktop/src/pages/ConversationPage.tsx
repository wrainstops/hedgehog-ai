import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useVoice } from '../hooks/useVoice';

interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  tps?: number;      // tokens per second（assistant 消息才会有）
  failed?: boolean;  // 生成失败时显示
}

interface LlmState {
  modelId: string | null;
  modelName: string | null;
  status: 'idle' | 'loading' | 'ready' | 'generating' | 'error';
  isMock?: boolean;
  error?: string;
}

interface LocalItem {
  id: string;
  kind: string;
  name: string;
  install_path: string;
}

export default function ConversationPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [llmState, setLlmState] = useState<LlmState | null>(null);
  const [localModels, setLocalModels] = useState<LocalItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [systemCommandResult, setSystemCommandResult] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const voice = useVoice('zh-CN');

  // --- 系统命令识别和执行 ---
  const executeSystemCommand = useCallback(async (userInput: string): Promise<boolean> => {
    const input = userInput.toLowerCase();

    // 1. 识别打开文件命令
    const openFilePatterns = [
      /用\s*(.+?)\s*打开\s*(.+)/i,  // "用记事本打开hosts文件"
      /打开\s*(.+?)\s*文件\s*(.+)/i,  // "打开hosts文件用记事本"
      /打开\s*(.+)/i,  // "打开hosts文件"
    ];

    for (const pattern of openFilePatterns) {
      const match = userInput.match(pattern);
      if (match) {
        let app = match[1] || '';
        let file = match[2] || match[1] || '';

        // 常见文件路径映射
        const filePaths: Record<string, string> = {
          'hosts': 'C:\\Windows\\System32\\drivers\\etc\\hosts',
          'hosts文件': 'C:\\Windows\\System32\\drivers\\etc\\hosts',
          '环境变量': 'C:\\Windows\\System32\\sysdm.cpl',
          '系统属性': 'C:\\Windows\\System32\\sysdm.cpl',
        };

        const filePath = filePaths[file] || file;

        // 如果有指定应用，先打开应用
        if (app && app !== '文件') {
          const appResult = await window.hedgehog?.system?.openApp?.(app);
          if (appResult?.ok) {
            setSystemCommandResult(`已启动 ${app}，正在尝试打开文件...`);
          }
        }

        // 打开文件
        const fileResult = await window.hedgehog?.system?.openFile?.(filePath);
        if (fileResult?.ok) {
          setSystemCommandResult(`✅ 已打开: ${filePath}`);
          return true;
        } else {
          setSystemCommandResult(`❌ 打开失败: ${fileResult?.error}`);
          return true;
        }
      }
    }

    // 2. 识别打开应用命令
    const openAppPatterns = [
      /打开\s*(微信|vscode|notepad|记事本|calc|计算器|taskmgr|任务管理器|explorer|文件管理器|chrome|浏览器)/i,
      /启动\s*(微信|vscode|notepad|记事本|calc|计算器|taskmgr|任务管理器|explorer|文件管理器|chrome|浏览器)/i,
      /用\s*(微信|vscode|notepad|记事本|calc|计算器|taskmgr|任务管理器|explorer|文件管理器|chrome|浏览器)\s*打开/i,
    ];

    for (const pattern of openAppPatterns) {
      const match = userInput.match(pattern);
      if (match) {
        const appName = match[1];
        const result = await window.hedgehog?.system?.openApp?.(appName);
        if (result?.ok) {
          setSystemCommandResult(`✅ 已启动: ${appName}`);
          return true;
        } else {
          setSystemCommandResult(`❌ 启动失败: ${result?.error}`);
          return true;
        }
      }
    }

    // 3. 识别执行命令
    const executePatterns = [
      /执行命令\s*[:：]?\s*(.+)/i,
      /运行\s*[:：]?\s*(.+)/i,
      /cmd\s*[:：]?\s*(.+)/i,
    ];

    for (const pattern of executePatterns) {
      const match = userInput.match(pattern);
      if (match) {
        const command = match[1].trim();
        const result = await window.hedgehog?.system?.executeCommand?.(command);
        if (result?.ok) {
          setSystemCommandResult(`✅ 命令执行成功:\n${result.data}`);
          if (result.stderr) {
            setSystemCommandResult(prev => `${prev}\n⚠️ 警告:\n${result.stderr}`);
          }
        } else {
          setSystemCommandResult(`❌ 命令执行失败: ${result?.error}`);
        }
        return true;
      }
    }

    // 4. 识别系统信息查询
    const systemInfoPatterns = [
      /系统信息/i,
      /系统状态/i,
      /电脑信息/i,
      /查看系统/i,
    ];

    for (const pattern of systemInfoPatterns) {
      if (pattern.test(input)) {
        const result = await window.hedgehog?.system?.getInfo?.();
        if (result?.ok && result.data) {
          const info = result.data;
          setSystemCommandResult(`📊 系统信息:\n` +
            `操作系统: ${info.platform} (${info.arch})\n` +
            `主机名: ${info.hostname}\n` +
            `CPU 核心数: ${info.cpus}\n` +
            `总内存: ${info.totalmem}\n` +
            `可用内存: ${info.freemem}\n` +
            `运行时间: ${info.uptime}\n` +
            `用户目录: ${info.homedir}\n` +
            `临时目录: ${info.tmpdir}`);
          return true;
        }
      }
    }

    // 5. 识别文件搜索
    const searchPatterns = [
      /搜索\s*(.+?)\s*(在|从)\s*(.+)/i,
      /在\s*(.+?)\s*中搜索\s*(.+)/i,
      /查找\s*(.+)/i,
    ];

    for (const pattern of searchPatterns) {
      const match = userInput.match(pattern);
      if (match) {
        let patternStr = match[1] || '';
        let searchPath = match[3] || match[2] || '';

        // 默认搜索路径
        if (!searchPath) {
          searchPath = 'C:\\Users';
        }

        const result = await window.hedgehog?.system?.searchFiles?.(searchPath, patternStr);
        if (result?.ok && result.data) {
          const files = result.data.slice(0, 10); // 限制显示前10个结果
          let output = `🔍 搜索结果 (${result.data.length} 个文件):\n`;
          files.forEach(file => {
            output += `\n📄 ${file.name}\n   路径: ${file.path}\n   大小: ${file.size} bytes\n   修改时间: ${new Date(file.modified).toLocaleString()}\n`;
          });
          setSystemCommandResult(output);
          return true;
        } else {
          setSystemCommandResult(`❌ 搜索失败: ${result?.error}`);
          return true;
        }
      }
    }

    return false; // 不是系统命令
  }, []);

  // --- 拉取 LLM 状态 & 本地模型列表
  useEffect(() => {
    window.hedgehog?.llm?.getState?.().then(setLlmState);
    window.hedgehog?.capabilityMarket?.listLocalItems?.({ kind: 'llm' }).then(setLocalModels);

    const offState = window.hedgehog?.llm?.onStateChange?.(setLlmState);
    const offToken = window.hedgehog?.llm?.onToken?.((text: string) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const copy = [...prev];
        const lastIdx = copy.length - 1;
        copy[lastIdx] = { ...copy[lastIdx], content: copy[lastIdx].content + text };
        return copy;
      });
    });

    return () => { offState?.(); offToken?.(); };
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    // 先检查是否是系统命令
    const isSystemCommand = await executeSystemCommand(text);
    if (isSystemCommand) {
      // 添加用户消息
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      // 添加系统命令结果消息
      if (systemCommandResult) {
        const systemMsg: ChatMessage = { id: `s-${Date.now()}`, role: 'assistant', content: systemCommandResult };
        setMessages((prev) => [...prev, systemMsg]);
        setSystemCommandResult(null);
      }
      return;
    }

    // 如果不是系统命令，检查是否需要 LLM
    if (!llmState || llmState.status !== 'ready') {
      alert('请先在能力市场下载一个模型并加载');
      return;
    }

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    const assistantMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '' };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setGenerating(true);
    try {
      const history: ChatMessage[] = [...messages, userMsg].slice(-10);
      const result: any = await window.hedgehog.llm.generate([
        { role: 'system', content: 'You are a helpful assistant. Answer in the same language as the user.' },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ], { temperature: 0.7 });
      if (result?.ok) {
        // 如果最终返回的文本与已拼接的不一致（可能流式传输未触发），填充文本
        setMessages((prev) => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          if (copy[lastIdx]?.content === '' && result.text) {
            copy[lastIdx] = { ...copy[lastIdx], content: result.text, tps: result.tokensPerSecond };
          } else if (result.tokensPerSecond) {
            copy[lastIdx] = { ...copy[lastIdx], tps: result.tokensPerSecond };
          }
          return copy;
        });
      } else {
        setMessages((prev) => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          copy[lastIdx] = { ...copy[lastIdx], content: `[生成失败] ${result?.error || 'unknown error'}`, failed: true };
          return copy;
        });
      }
    } catch (err: any) {
      setMessages((prev) => {
        const copy = [...prev];
        const lastIdx = copy.length - 1;
        copy[lastIdx] = { ...copy[lastIdx], content: `[异常] ${err?.message || err}`, failed: true };
        return copy;
      });
    } finally {
      setGenerating(false);
    }
  }, [input, messages, llmState]);

  const loadModel = async (item: LocalItem) => {
    setShowModelPicker(false);
    setModelLoading(true);
    try {
      const result: any = await window.hedgehog.llm.load(item.id, item.install_path, {
        contextSize: 4096, threads: 4, gpuLayers: 0,
      });
      if (!result?.ok) {
        alert(`加载模型失败: ${result?.error || 'unknown'}`);
      }
    } finally {
      // 监听 LLM 状态变化，loading 结束后自动取消
      const checkReady = setInterval(() => {
        window.hedgehog?.llm?.getState?.().then((state: LlmState | null) => {
          if (state?.status === 'ready' || state?.status === 'error') {
            clearInterval(checkReady);
            setModelLoading(false);
            // 主动刷新 llmState，确保 UI 立即更新
            setLlmState(state);
            // 重新拉一下本地列表
            window.hedgehog.capabilityMarket.listLocalItems({ kind: 'llm' }).then(setLocalModels);
          }
        });
      }, 200);
      // 超时保护：30秒后强制取消 loading
      setTimeout(() => {
        clearInterval(checkReady);
        setModelLoading(false);
      }, 30000);
    }
  };

  const unloadModel = async () => {
    await window.hedgehog.llm.unload();
    setMessages((prev) => [...prev, { id: `sys-${Date.now()}`, role: 'system', content: '— 模型已卸载 —' }]);
  };

  const stopGenerate = () => window.hedgehog?.llm?.stop?.();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 8, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 4,
            background: modelLoading ? '#3b82f6' : llmState?.status === 'ready' ? '#10b981' : llmState?.status === 'generating' ? '#f59e0b' : llmState?.status === 'loading' ? '#3b82f6' : llmState?.status === 'error' ? '#ef4444' : '#6b7280',
            opacity: modelLoading ? 1 : undefined,
            animation: modelLoading ? 'blink 1s infinite' : 'none'
          }}/>
          <span style={{ fontWeight: 600 }}>
            {modelLoading ? '加载模型中...' : (llmState?.modelName || '(未加载模型)')}
            {llmState?.isMock ? ' [mock]' : ''}
          </span>
          <span style={{ color: '#6b7280', marginLeft: 8 }}>
            [{modelLoading ? 'loading' : (llmState?.status || 'idle')}]
          </span>
          {generating && (
            <span style={{ marginLeft: 12, color: '#f59e0b', fontSize: 12 }}>
              ⏳ 生成中... （首次推理可能需要 30-60 秒预热）
            </span>
          )}
        </div>
        <button style={btnStyle()} onClick={() => setShowModelPicker(s => !s)} disabled={modelLoading}>
          {modelLoading ? '加载中...' : '切换模型'}
        </button>
        <button style={btnStyle(true)} onClick={unloadModel}>卸载</button>
        {generating && <button style={btnStyle(true)} onClick={stopGenerate}>停止</button>}
        <button style={btnStyle()} onClick={() => {
          alert('🤖 系统命令帮助:\n\n📁 文件操作:\n• "用记事本打开hosts文件"\n• "打开hosts文件"\n\n🚀 应用启动:\n• "打开微信"\n• "启动vscode"\n• "打开浏览器"\n\n💻 系统命令:\n• "执行命令: ipconfig"\n• "运行: dir"\n\n📊 系统信息:\n• "系统信息"\n• "电脑信息"\n\n🔍 文件搜索:\n• "搜索hosts在C:\\Windows"\n• "查找project"');
          taRef.current?.focus();
        }}>💡 帮助</button>
      </div>

      {showModelPicker && (
        <div style={{ padding: 8, background: '#f9fafb', borderRadius: 6 }}>
          {localModels.length === 0 && <div style={{ color: '#6b7280' }}>还没有本地模型。请到“能力市场”下载，或“已安装”中导入 .gguf 文件。</div>}
          {localModels.map(m => (
            <button key={m.id} onClick={() => loadModel(m)} style={{ ...btnStyle(), display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}>
              <b>{m.name}</b>
              <div style={{ color: '#6b7280', fontSize: 12 }}>{m.install_path}</div>
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, overflow: 'auto', minHeight: 300 }}>
        {messages.filter(m => m.role !== 'system').map((m, i) => (
          <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              background: m.role === 'user' ? '#dbeafe' : '#ffffff',
              color: m.failed ? '#ef4444' : '#1f2937',
              padding: '10px 14px', borderRadius: 10, border: '1px solid #e5e7eb',
              maxWidth: 700, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {m.content}
            </div>
            {m.tps && <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>{m.tps} tokens/s</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={taRef}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="说点什么... (Enter 发送, Shift+Enter 换行)"
          style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #d0d7de', resize: 'vertical' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button
          style={{
          padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
          background: voice.listening ? '#ef4444' : '#fff',
          color: voice.listening ? '#fff' : 'inherit',
          border: '1px solid #d0d7de',
        }}
          onMouseDown={voice.start}
          onMouseUp={async () => {
            const text = await voice.stop();
            if (text) setInput(prev => (prev ? prev + ' ' : '') + text);
          }}
          onMouseLeave={() => {
            if (voice.listening) {
              voice.stop().then((t: string) => t && setInput(prev => (prev ? prev + ' ' : '') + t));
            }
          }}
          title={voice.supported ? '按住说话（松开发送）' : '当前环境不支持语音识别'}
        >
          🎤
        </button>
        <button
          style={{ padding: '10px 18px', background: '#1d4ed8', color: '#fff', border: '1px solid #1d4ed8', borderRadius: 8, cursor: 'pointer' }}
          onClick={send} disabled={generating}
        >
          {generating ? '生成中…' : '发送'}
        </button>
      </div>
    </div>
  );
}

function btnStyle(isSecondary = false): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
    background: isSecondary ? '#f3f4f6' : '#fff',
    border: '1px solid #d0d7de',
  };
}
