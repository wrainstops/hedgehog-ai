import React, { useEffect, useState } from 'react';

export default function SettingsPage() {
  const [lang, setLang] = useState<string>('zh-CN');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [downloadPaths, setDownloadPaths] = useState<{
    basePath: string;
    isCustom: boolean;
    llmsDir: string;
    asrsDir: string;
    ttssDir: string;
    skillsDir: string;
  } | null>(null);

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

  // 加载下载路径配置
  useEffect(() => {
    window.hedgehog?.settings?.getDownloadPaths?.().then((paths: any) => {
      setDownloadPaths(paths);
    });
  }, []);

  const handleLangChange = async (newLang: string) => {
    setLang(newLang);
    await window.hedgehog?.i18n?.setLang?.(newLang);
  };

  const handleChooseDownloadPath = async () => {
    // 使用 Electron 的 dialog API（如果可用）
    const result = await window.hedgehog?.dialog?.showOpenDialog?.({
      properties: ['openDirectory'],
      title: '选择下载路径',
    });

    if (result?.filePaths?.[0]) {
      const newPath = result.filePaths[0];
      await window.hedgehog?.settings?.setDownloadPath?.(newPath);
      // 刷新路径显示
      const paths = await window.hedgehog?.settings?.getDownloadPaths?.();
      setDownloadPaths(paths);
    }
  };

  const handleResetDownloadPath = async () => {
    await window.hedgehog?.settings?.setDownloadPath?.('');
    // 刷新路径显示
    const paths = await window.hedgehog?.settings?.getDownloadPaths?.();
    setDownloadPaths(paths);
  };

  const handleOpenDownloadPath = async () => {
    if (downloadPaths?.basePath) {
      await window.hedgehog?.shell?.openPath?.(downloadPaths.basePath);
    }
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

      <section style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>下载路径 / Download Path</h3>
        {downloadPaths ? (
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
                当前路径 {downloadPaths.isCustom ? '(自定义)' : '(默认)'}
              </div>
              <code style={{ display: 'block', padding: 8, background: '#f3f4f6', borderRadius: 4, fontSize: 13, wordBreak: 'break-all' }}>
                {downloadPaths.basePath}
              </code>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>子目录：</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                <li>LLM 模型: <code>{downloadPaths.llmsDir}</code></li>
                <li>ASR 模型: <code>{downloadPaths.asrsDir}</code></li>
                <li>TTS 模型: <code>{downloadPaths.ttssDir}</code></li>
                <li>技能: <code>{downloadPaths.skillsDir}</code></li>
              </ul>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handleChooseDownloadPath}
                style={{
                  padding: '8px 16px',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                选择自定义路径
              </button>
              {downloadPaths.isCustom && (
                <button
                  onClick={handleResetDownloadPath}
                  style={{
                    padding: '8px 16px',
                    background: '#6b7280',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer'
                  }}
                >
                  恢复默认路径
                </button>
              )}
              <button
                onClick={handleOpenDownloadPath}
                style={{
                  padding: '8px 16px',
                  background: '#fff',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                打开当前路径
              </button>
            </div>
          </div>
        ) : (
          <div style={{ color: '#6b7280' }}>加载中...</div>
        )}
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
