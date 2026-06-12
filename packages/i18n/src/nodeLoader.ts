// Node/Electron 环境下的翻译文件加载器
// 用 fs 读取 JSON 文件，并允许用户传入 locale 的根路径
// Electron 主进程:
//   import { createNodeLoader } from '@hedgehog/i18n/src/nodeLoader';
//   const loader = createNodeLoader(path.join(__dirname, '..', 'locales'));
//   const i18n = new I18nRuntime(loader, userLang);

import fs from 'node:fs';
import path from 'node:path';
import type { I18nNamespace, Language, TranslationLoader } from './index.js';

export function createNodeLoader(localeRoot: string): TranslationLoader {
  return (ns: I18nNamespace, lang: Language) => {
    const file = path.join(localeRoot, lang, `${ns}.json`);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[i18n] cannot load ${file}:`, err);
      return {};
    }
  };
}
