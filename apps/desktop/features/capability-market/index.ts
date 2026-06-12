// 能力市场 feature 入口：由 main.cjs 通过 dynamic import 调用 register()
// 依赖全局 hedgehogContext（由 main.cjs 启动时设置）

import { ipcMain, BrowserWindow } from 'electron';
import * as ipcModule from './ipc';

declare const global: any;

export function register(): void {
  const ctx = (global as any).hedgehogContext;
  if (!ctx) {
    console.warn('[capability-market] no hedgehogContext — skipped registration');
    return;
  }
  const { storage, dirs } = ctx;

  // fallback catalog 文件路径：
  //   apps/desktop/resources/fallback-models.json（运行时打包进 dist 旁边）
  // 为避免 electron 打包时路径不同，这里相对 userData 上两级 + 项目根查找
  const tryPaths = [
    require('node:path').join(__dirname, '..', '..', 'resources', 'fallback-models.json'),
    require('node:path').join(require('node:path').dirname(process.argv0), 'resources', 'fallback-models.json'),
  ];
  const fs = require('node:fs');
  let fallback = tryPaths.find((p) => fs.existsSync(p)) || undefined;

  ipcModule.register({
    ipcMain,
    storage,
    dirs,
    fallbackCatalogPath: fallback,
    catalogUrl: storage.getSetting('catalog_url') || undefined,
    getMainWindow: () => {
      const wins = BrowserWindow.getAllWindows();
      return wins[0] || null;
    },
  });
  console.log('[capability-market] feature registered');
}
