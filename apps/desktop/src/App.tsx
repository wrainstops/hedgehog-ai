import React, { useEffect, useMemo, useState } from 'react';
import MarketPage from './pages/MarketPage';
import InstalledPage from './pages/InstalledPage';
import ConversationPage from './pages/ConversationPage';
import SettingsPage from './pages/SettingsPage';

type PageKey = 'conversation' | 'market' | 'installed' | 'settings';

const NAV_LABELS: Record<PageKey, string> = {
  conversation: 'nav.conversation',
  market: 'nav.capabilityMarket',
  installed: 'nav.myInstalled',
  settings: 'nav.settings',
};

// 轻量的 React 侧 i18n hook：通过 preload 暴露的 window.hedgehog.t
// 为避免闪烁，这里做一层缓存。
function useI18n() {
  const [lang, setLang] = useState<string>('zh-CN');
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    window.hedgehog?.getLang?.().then((l: string) => l && setLang(l));
    return window.hedgehog?.onLangChange?.(setLang) ?? (() => {});
  }, []);

  return {
    lang,
    setLang: (l: string) => window.hedgehog?.setLang?.(l),
    t: (key: string, params?: Record<string, string | number>) => {
      // 主进程中是真实翻译值；这里仅在渲染侧做一层显示同步
      // 我们直接把 key 展示出来便于开发
      return window.hedgehog?.t?.(key, params) ?? key;
    },
    refresh: () => forceUpdate((n) => n + 1),
  };
}

export default function App() {
  const [page, setPage] = useState<PageKey>('market');
  const { t } = useI18n();

  const title = useMemo(() => {
    switch (page) {
      case 'conversation': return '对话';
      case 'market': return '能力市场';
      case 'installed': return '已安装';
      case 'settings': return '设置';
    }
  }, [page]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Hedgehog AI</h1>
        <ul>
          {(Object.keys(NAV_LABELS) as PageKey[]).map((k) => (
            <li
              key={k}
              className={page === k ? 'active' : ''}
              onClick={() => setPage(k)}
            >
              {t(NAV_LABELS[k])}
            </li>
          ))}
        </ul>
      </aside>
      <main className="main">
        <h2>{t(title === '对话' ? 'nav.conversation' :
              title === '能力市场' ? 'nav.capabilityMarket' :
              title === '已安装' ? 'nav.myInstalled' :
              'nav.settings')}</h2>
        {page === 'market' && <MarketPage />}
        {page === 'installed' && <InstalledPage />}
        {page === 'conversation' && <ConversationPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
