import React from 'react';
import type { DownloadState } from '@hedgehog/protocol';

interface Props { downloads: DownloadState[] }

export default function DownloadBar({ downloads }: Props) {
  const visible = downloads.filter((d) => d.state !== 'done');
  if (visible.length === 0) return null;
  const t = (k: string) => window.hedgehog?.t?.(k) ?? k;

  return (
    <div className="download-bar">
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('download.downloading')}</div>
      {visible.map((d) => {
        const totalMb = d.total_bytes ? (d.total_bytes / 1024 / 1024).toFixed(2) : '0.00';
        const doneMb = (d.downloaded_bytes / 1024 / 1024).toFixed(2);
        const pct = d.total_bytes ? Math.min(100, (d.downloaded_bytes / d.total_bytes) * 100) : 0;
        return (
          <div key={d.id} className="download-item">
            <div>
              <div style={{ fontWeight: 500 }}>{d.id}</div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                {t('download.' + d.state)} · {doneMb} / {totalMb} MB
              </div>
            </div>
            <div className="progress"><div style={{ width: pct + '%' }} /></div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => window.hedgehog?.capabilityMarket?.pauseDownload?.(d.id)}>
                暂停
              </button>
              <button onClick={() => window.hedgehog?.capabilityMarket?.cancelDownload?.(d.id)}>
                取消
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
