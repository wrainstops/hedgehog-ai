import React, { useEffect, useState } from 'react';
import type { DownloadState } from '@hedgehog/protocol';

interface Props { downloads: DownloadState[] }

export default function DownloadBar({ downloads }: Props) {
  const [lang, setLang] = useState<string>('zh-CN');
  const [translations, setTranslations] = useState<Record<string, string>>({});

  useEffect(() => {
    // 获取当前语言
    window.hedgehog?.i18n?.getLang?.().then((l: string) => l && setLang(l));

    // 监听语言变化
    const unsubscribe = window.hedgehog?.i18n?.onLangChange?.((newLang: string) => {
      setLang(newLang);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  // 加载翻译
  useEffect(() => {
    const loadTranslations = async () => {
      const keys = [
        'model-market.download.downloading',
        'model-market.download.extracting',
        'model-market.download.paused',
        'model-market.download.failed',
        'model-market.download.done',
        'model-market.download.queued',
        'model-market.action.pause',
        'model-market.action.resume',
        'model-market.action.cancel',
      ];
      const results: Record<string, string> = {};
      for (const key of keys) {
        results[key] = await window.hedgehog?.i18n?.t?.(key) ?? key;
      }
      setTranslations(results);
    };
    loadTranslations();
  }, [lang]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const getStateText = (state: string) => {
    const key = `model-market.download.${state}`;
    return translations[key] || state;
  };

  const visible = downloads.filter((d) => d.state !== 'done');
  if (visible.length === 0) return null;

  return (
    <div className="download-bar" style={{
      position: 'fixed',
      bottom: 0,
      left: 240,
      right: 0,
      background: 'white',
      borderTop: '1px solid #e5e7eb',
      padding: 16,
      maxHeight: 200,
      overflowY: 'auto',
      boxShadow: '0 -2px 8px rgba(0,0,0,0.1)'
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {translations['model-market.download.downloading'] || '下载中'} ({visible.length})
      </div>
      {visible.map((d) => {
        const pct = d.total_bytes ? Math.min(100, (d.downloaded_bytes / d.total_bytes) * 100) : 0;
        const speedText = d.speed_bps ? ` · ${(d.speed_bps / 1024 / 1024).toFixed(1)} MB/s` : '';

        return (
          <div key={d.id} className="download-item" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 0',
            borderBottom: '1px solid #f3f4f6'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{d.id}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {getStateText(d.state)} · {formatSize(d.downloaded_bytes)} / {formatSize(d.total_bytes)}{speedText}
              </div>
              <div style={{
                background: '#e5e7eb',
                height: 4,
                borderRadius: 2,
                marginTop: 4,
                overflow: 'hidden'
              }}>
                <div style={{
                  background: d.state === 'failed' ? '#ef4444' : '#3b82f6',
                  height: '100%',
                  borderRadius: 2,
                  width: `${pct}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {d.state === 'downloading' && (
                <button
                  onClick={() => window.hedgehog?.capabilityMarket?.pauseDownload?.(d.id)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  {translations['model-market.action.pause'] || '暂停'}
                </button>
              )}
              {d.state === 'paused' && (
                <button
                  onClick={() => window.hedgehog?.capabilityMarket?.resumeDownload?.(d.id)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  {translations['model-market.action.resume'] || '继续'}
                </button>
              )}
              <button
                onClick={() => window.hedgehog?.capabilityMarket?.cancelDownload?.(d.id)}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                {translations['model-market.action.cancel'] || '取消'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
