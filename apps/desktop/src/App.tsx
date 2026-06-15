import React, { useEffect, useCallback, useState } from 'react';
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

// React i18n hook：通过 preload 暴露的 window.hedgehog.i18n API
function useI18n() {
  const [lang, setLang] = useState<string>('zh-CN');
  const [cache, setCache] = useState<Record<string, string>>({});

  useEffect(() => {
    // 获取初始语言
    window.hedgehog?.i18n?.getLang?.().then((l: string) => {
      console.log('[i18n] Initial lang:', l);
      l && setLang(l);
    });

    // 监听语言变化
    const unsubscribe = window.hedgehog?.i18n?.onLangChange?.((newLang: string) => {
      console.log('[i18n] Lang changed to:', newLang);
      setLang(newLang);
      setCache({}); // 清空缓存
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  // t 函数
  const t = async (key: string, params?: Record<string, string | number>): Promise<string> => {
    console.log('[i18n.t] Called with key:', key, 'cache length:', Object.keys(cache).length);
    if (cache[key]) {
      console.log('[i18n.t] Returning from cache:', cache[key]);
      return cache[key];
    }
    console.log('[i18n.t] Fetching from main process...');
    const result = await window.hedgehog?.i18n?.t?.(key, params);
    console.log('[i18n.t] Got result from main:', key, '->', result);
    setCache((prev) => ({ ...prev, [key]: result ?? key }));
    return result ?? key;
  };

  return {
    lang,
    setLang: async (l: string) => {
      await window.hedgehog?.i18n?.setLang?.(l);
    },
    t,
  };
}

export default function App() {
  const [page, setPage] = useState<PageKey>('market');
  const { lang, t } = useI18n();
  const [navLabels, setNavLabels] = useState<Record<PageKey, string>>({
    conversation: '对话',
    market: '能力市场',
    installed: '已安装',
    settings: '设置',
  });
  const [pageTitle, setPageTitle] = useState<string>('能力市场');

  // 加载导航标签翻译 - 只依赖 lang
  useEffect(() => {
    console.log('[App] Loading nav labels for lang:', lang);
    const loadLabels = async () => {
      const labels: Record<PageKey, string> = {} as Record<PageKey, string>;
      for (const key of Object.keys(NAV_LABELS) as PageKey[]) {
        console.log('[App] Getting translation for:', NAV_LABELS[key]);
        const label = await t(NAV_LABELS[key]);
        console.log('[App] Loaded label:', NAV_LABELS[key], '->', label);
        labels[key] = label;
      }
      console.log('[App] Setting navLabels:', labels);
      setNavLabels(labels);

      // 更新页面标题
      const titleKey = NAV_LABELS[page];
      const title = await t(titleKey);
      console.log('[App] Setting pageTitle:', title);
      setPageTitle(title);
    };
    loadLabels();
  }, [lang, page]);

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
              {navLabels[k]}
            </li>
          ))}
        </ul>
      </aside>
      <main className="main">
        <h2>{pageTitle}</h2>
        {page === 'market' && <section><MarketPage /></section>}
        {page === 'installed' && <section><InstalledPage /></section>}
        {page === 'conversation' && <section><ConversationPage /></section>}
        {page === 'settings' && <section><SettingsPage /></section>}
      </main>
    </div>
  );
}
