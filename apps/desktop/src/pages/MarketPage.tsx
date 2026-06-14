import React, { useEffect, useState } from 'react';
import type { CatalogItem, ItemKind, DownloadState } from '@hedgehog/protocol';
import DownloadBar from '../components/DownloadBar';

type Tab = ItemKind;
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'llm', label: 'model-market.tab.llm' },
  { key: 'asr', label: 'model-market.tab.asr' },
  { key: 'tts', label: 'model-market.tab.tts' },
  { key: 'skill', label: 'model-market.tab.skill' },
];

export default function MarketPage() {
  const [tab, setTab] = useState<Tab>('llm');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadState[]>([]);
  const [source, setSource] = useState<string>('online');
  const [lang, setLang] = useState<string>('zh-CN');

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

  useEffect(() => {
    window.hedgehog?.capabilityMarket?.getCatalog?.({ kind: tab }).then((res: any) => {
      setItems(res?.items ?? []);
      setSource(res?.source ?? 'online');
    });
    const off = window.hedgehog?.capabilityMarket?.onDownloadProgress?.((downloads: any[]) => {
      console.log('[MarketPage] Download progress:', downloads);
      setDownloads(downloads || []);
    });
    return off;
  }, [tab]);

  const t = async (k: string) => {
    return await window.hedgehog?.i18n?.t?.(k) ?? k;
  };

  const [translations, setTranslations] = useState<Record<string, string>>({});

  // 加载翻译
  useEffect(() => {
    const loadTranslations = async () => {
      const keys = [
        'model-market.title',
        'model-market.tab.llm',
        'model-market.tab.asr',
        'model-market.tab.tts',
        'model-market.tab.skill',
        'model-market.model.recommended',
        'model-market.action.download',
        'model-market.action.pause',
        'model-market.action.resume',
        'model-market.action.cancel',
        'model-market.toast.usingOfflineCatalog',
      ];
      const results: Record<string, string> = {};
      for (const key of keys) {
        results[key] = await t(key);
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

  const getDownloadState = (itemId: string) => {
    return downloads.find(d => d.id === itemId);
  };

  return (
    <div>
      <div className="tabs">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            className={tab === tb.key ? 'active' : ''}
            onClick={() => setTab(tb.key)}
          >
            {translations[tb.label] || tb.label}
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
          {translations['model-market.toast.usingOfflineCatalog'] || 'Using offline catalog'}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">当前 Tab 下暂无可用能力。尝试刷新或切换其他 Tab。</div>
      ) : (
        <div className="card-grid">
          {items.map((item) => {
            const downloadState = getDownloadState(item.id);
            const isDownloading = downloadState && downloadState.state === 'downloading';
            const isPaused = downloadState && downloadState.state === 'paused';

            return (
              <div key={item.id} className="card">
                <h3>{item.name?.[lang as 'zh-CN' | 'en-US'] || item.name?.['zh-CN'] || item.id}</h3>
                {item.description && (
                  <p style={{ color: '#6b7280', fontSize: 14, margin: '8px 0' }}>
                    {item.description?.[lang as 'zh-CN' | 'en-US'] || item.description?.['zh-CN']}
                  </p>
                )}
                <div className="meta">
                  {item.kind} · {item.version} · {formatSize(item.size_bytes)}
                </div>
                <div style={{ margin: '8px 0' }}>
                  {item.recommended && (
                    <span className="tag" style={{ background: '#3b82f6', color: 'white' }}>
                      {translations['model-market.model.recommended'] || '推荐'}
                    </span>
                  )}
                  {item.license?.name && (
                    <span className="tag" style={{ background: '#e5e7eb', marginLeft: 4 }}>
                      {item.license.name}
                    </span>
                  )}
                  {item.author && (
                    <span className="tag" style={{ background: '#e5e7eb', marginLeft: 4 }}>
                      {item.author}
                    </span>
                  )}
                </div>

                {downloadState && (
                  <div style={{ margin: '8px 0', padding: 8, background: '#f3f4f6', borderRadius: 4 }}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {downloadState.state === 'downloading' && '下载中...'}
                      {downloadState.state === 'paused' && '已暂停'}
                      {downloadState.state === 'done' && '已完成'}
                      {downloadState.state === 'failed' && '下载失败'}
                    </div>
                    {downloadState.state === 'downloading' && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ background: '#e5e7eb', height: 4, borderRadius: 2 }}>
                          <div
                            style={{
                              background: '#3b82f6',
                              height: '100%',
                              borderRadius: 2,
                              width: `${(downloadState.downloaded_bytes / downloadState.total_bytes) * 100}%`
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                          {formatSize(downloadState.downloaded_bytes)} / {formatSize(downloadState.total_bytes)}
                          {downloadState.speed_bps && ` · ${(downloadState.speed_bps / 1024 / 1024).toFixed(1)} MB/s`}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  {!downloadState && (
                    <button
                      onClick={async () => {
                        console.log('[MarketPage] Starting download:', item.id);
                        try {
                          await window.hedgehog?.capabilityMarket?.startDownload?.(item.id);
                          console.log('[MarketPage] Download started successfully');
                        } catch (err) {
                          console.error('[MarketPage] Download failed:', err);
                          alert('下载失败: ' + ((err as any)?.message || err));
                        }
                      }}
                    >
                      {translations['model-market.action.download'] || '下载'}
                    </button>
                  )}
                  {isDownloading && (
                    <>
                      <button onClick={() => window.hedgehog?.capabilityMarket?.pauseDownload?.(item.id)}>
                        {translations['model-market.action.pause'] || '暂停'}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => window.hedgehog?.capabilityMarket?.cancelDownload?.(item.id)}
                        style={{ marginLeft: 8 }}
                      >
                        {translations['model-market.action.cancel'] || '取消'}
                      </button>
                    </>
                  )}
                  {isPaused && (
                    <>
                      <button onClick={() => window.hedgehog?.capabilityMarket?.resumeDownload?.(item.id)}>
                        {translations['model-market.action.resume'] || '继续'}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => window.hedgehog?.capabilityMarket?.cancelDownload?.(item.id)}
                        style={{ marginLeft: 8 }}
                      >
                        {translations['model-market.action.cancel'] || '取消'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DownloadBar downloads={downloads} />
    </div>
  );
}
