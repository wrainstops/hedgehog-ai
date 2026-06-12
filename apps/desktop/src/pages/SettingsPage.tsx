import React, { useEffect, useState } from 'react';

export default function SettingsPage() {
  const [lang, setLang] = useState<string>('zh-CN');

  useEffect(() => {
    window.hedgehog?.getLang?.().then((l: string) => l && setLang(l));
  }, []);

  const t = (k: string) => window.hedgehog?.t?.(k) ?? k;

  return (
    <div style={{ maxWidth: 640 }}>
      <section style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>语言</h3>
        <select
          value={lang}
          onChange={(e) => {
            const v = e.target.value;
            setLang(v);
            window.hedgehog?.setLang?.(v);
          }}
          style={{ padding: 6, borderRadius: 6 }}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English</option>
        </select>
      </section>

      <section style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
        <h3 style={{ marginTop: 0 }}>关于</h3>
        <div style={{ color: '#475569' }}>
          Hedgehog AI — 本地 LLM 桌面应用。能力市场 / 语音对话 / 技能市场。
        </div>
      </section>

      <div style={{ marginTop: 12, color: '#6b7280', fontSize: 13 }}>
        i18n 示例：
        <ul>
          <li>{t('common.confirm')} / {t('common.cancel')}</li>
          <li>{t('model-market.title')}</li>
          <li>{t('voice.title')}</li>
          <li>{t('skill-market.title')}</li>
        </ul>
      </div>
    </div>
  );
}
