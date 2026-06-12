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
  const taRef = useRef<HTMLTextAreaElement>(null);

  const voice = useVoice('zh-CN');

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
    if (!text || !llmState || llmState.status !== 'ready') {
      if (!llmState || llmState.status !== 'ready') {
        alert('请先在能力市场下载一个模型并加载');
      }
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
    const result: any = await window.hedgehog.llm.load(item.id, item.install_path, {
      contextSize: 4096, threads: 4, gpuLayers: 0,
    });
    if (!result?.ok) alert(`加载模型失败: ${result?.error || 'unknown'}`);
    // 重新拉一下本地列表
    window.hedgehog.capabilityMarket.listLocalItems({ kind: 'llm' }).then(setLocalModels);
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
            background: llmState?.status === 'ready' ? '#10b981' : llmState?.status === 'generating' ? '#f59e0b' : llmState?.status === 'loading' ? '#3b82f6' : llmState?.status === 'error' ? '#ef4444' : '#6b7280'
          }}/>
          <span style={{ fontWeight: 600 }}>
            {llmState?.modelName || '(未加载模型)'}
            {llmState?.isMock ? ' [mock]' : ''}
          </span>
          <span style={{ color: '#6b7280', marginLeft: 8 }}>
            [{llmState?.status || 'idle'}]
          </span>
        </div>
        <button style={btnStyle()} onClick={() => setShowModelPicker(s => !s)}>
          切换模型
        </button>
        <button style={btnStyle(true)} onClick={unloadModel}>卸载</button>
        {generating && <button style={btnStyle(true)} onClick={stopGenerate}>停止</button>}
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
