import React, { useEffect, useState } from 'react';

export default function SettingsPage() {
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

  // 加载翻译示例
  useEffect(() => {
    const loadTranslations = async () => {
      const keys = ['common.confirm', 'common.cancel', 'model-market.title', 'voice.title', 'skill-market.title'];
      const results: Record<string, string> = {};
      for (const key of keys) {
        results[key] = await window.hedgehog?.i18n?.t?.(key) ?? key;
      }
      setTranslations(results);
    };
    loadTranslations();
  }, [lang]);

  const handleLangChange = async (newLang: string) => {
    setLang(newLang);
    await window.hedgehog?.i18n?.setLang?.(newLang);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <section style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>语言 / Language</h3>
        <select
          value={lang}
          onChange={(e) => handleLangChange(e.target.value)}
          style={{ padding: 6, borderRadius: 6 }}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English</option>
        </select>
      </section>

      <section style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
        <h3 style={{ marginTop: 0 }}>关于 / About</h3>
        <div style={{ color: '#475569' }}>
          Hedgehog AI — 本地 LLM 桌面应用。能力市场 / 语音对话 / 技能市场。
        </div>
      </section>

      <div style={{ marginTop: 12, color: '#6b7280', fontSize: 13 }}>
        i18n 示例 / i18n Examples:
        <ul>
          <li>{translations['common.confirm']} / {translations['common.cancel']}</li>
          <li>{translations['model-market.title']}</li>
          <li>{translations['voice.title']}</li>
          <li>{translations['skill-market.title']}</li>
        </ul>
      </div>
    </div>
  );
}
