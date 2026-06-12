// 基于 Web Speech API 的简单语音输入 hook
// - 长按开始识别，松开返回识别文本
// - 浏览器权限拒绝时会报错提示

import { useEffect, useRef, useState, useCallback } from 'react';

// Web Speech API 的 TypeScript 没有内置声明，这里自己加
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

export interface UseVoiceResult {
  supported: boolean;
  listening: boolean;
  interimText: string;
  start: () => void;
  stop: () => Promise<string>; // 返回最终文本
  cancel: () => void;
  error: string | null;
}

export function useVoice(lang = 'zh-CN'): UseVoiceResult {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalTextRef = useRef('');
  const resolveRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return setSupported(false);
    setSupported(true);
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = lang;

    r.onresult = (event: any) => {
      let interim = '';
      let finalText = finalTextRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      finalTextRef.current = finalText;
      setInterimText(finalText + interim);
    };
    r.onerror = (e: any) => {
      // 'not-allowed' / 'no-speech' 是常见的良性错误
      if (e.error === 'not-allowed') setError('麦克风权限被拒绝');
      else if (e.error === 'no-speech') setError('未检测到语音');
      else setError('语音识别错误: ' + e.error);
    };
    r.onend = () => {
      setListening(false);
      const finalText = finalTextRef.current.trim();
      if (resolveRef.current) {
        const fn = resolveRef.current;
        resolveRef.current = null;
        fn(finalText);
      }
    };
    recognitionRef.current = r;
  }, [lang]);

  const start = useCallback(() => {
    setError(null);
    finalTextRef.current = '';
    setInterimText('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch (e: any) {
        // 重复 start 会抛 InvalidState，忽略
      }
    }
  }, []);

  const stop = useCallback(() => {
    return new Promise<string>((resolve) => {
      resolveRef.current = resolve;
      if (recognitionRef.current && listening) {
        recognitionRef.current.stop();
      } else {
        // 没在识别，直接 resolve 空文本
        resolve(finalTextRef.current.trim());
      }
    });
  }, [listening]);

  const cancel = useCallback(() => {
    if (recognitionRef.current) recognitionRef.current.abort();
    setListening(false);
    setInterimText('');
    finalTextRef.current = '';
  }, []);

  return { supported, listening, interimText, start, stop, cancel, error };
}
