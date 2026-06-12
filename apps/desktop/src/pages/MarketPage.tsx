import React, { useEffect, useState } from 'react';
import type { CatalogItem, ItemKind, DownloadState } from '@hedgehog/protocol';
import DownloadBar from '../components/DownloadBar';

type Tab = ItemKind;
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'llm', label: 'tab.llm' },
  { key: 'asr', label: 'tab.asr' },
  { key: 'tts', label: 'tab.tts' },
  { key: 'skill', label: 'tab.skill' },
];

export default function MarketPage() {
  const [tab, setTab] = useState<Tab>('llm');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadState[]>([]);
  const [source, setSource] = useState<string>('online');

  useEffect(() => {
    window.hedgehog?.capabilityMarket?.getCatalog?.({ kind: tab }).then((res: any) => {
      setItems(res?.items ?? []);
      setSource(res?.source ?? 'online');
    });
    const off = window.hedgehog?.capabilityMarket?.subscribeDownloads?.(setDownloads);
    return off;
  }, [tab]);

  const t = (k: string) => window.hedgehog?.t?.(k) ?? k;

  return (
    <div>
      <div className="tabs">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            className={tab === tb.key ? 'active' : ''}
            onClick={() => setTab(tb.key)}
          >
            {t(tb.label)}
          </button>
        ))}
        <button
          style={{ marginLeft: 'auto' }}
          onClick={() =>
            window.hedgehog?.capabilityMarket
              ?.refreshCatalog?.({ kind: tab })
              .then((res: any) => {
                setItems(res?.items ?? []);
                setSource(res?.source ?? 'online');
              })
          }
        >
          刷新
        </button>
      </div>

      {source === 'fallback' && (
        <div style={{ color: '#b45309', marginBottom: 12 }}>
          {t('toast.usingOfflineCatalog')}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">当前 Tab 下暂无可用能力。尝试刷新或切换其他 Tab。</div>
      ) : (
        <div className="card-grid">
          {items.map((item) => (
            <div key={item.id} className="card">
              <h3>{t(item.name['zh-CN']) ?? item.name['zh-CN'] ?? item.id}</h3>
              <div className="meta">
                {item.kind} · {item.version} · {(item.size_bytes / 1024 / 1024 / 1024).toFixed(2)} GB
              </div>
              <div>
                {item.recommended && <span className="tag">推荐</span>}
                <span className="tag">{item.license?.name}</span>
              </div>
              <button
                onClick={() => window.hedgehog?.capabilityMarket?.startDownload?.(item.id)}
              >
                {t('action.download')}
              </button>
              {' '}
              <button
                className="secondary"
                onClick={() => window.hedgehog?.capabilityMarket?.cancelDownload?.(item.id)}
              >
                {t('action.cancel')}
              </button>
            </div>
          ))}
        </div>
      )}

      <DownloadBar downloads={downloads} />
    </div>
  );
}
