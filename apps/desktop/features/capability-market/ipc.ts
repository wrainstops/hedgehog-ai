// 能力市场 IPC 通道注册
// - 渲染侧：window.hedgehog.capabilityMarket.*
// - 主进程：ipcMain.handle('capability-market:*', ...)

import type { BrowserWindow, IpcMain } from 'electron';
import type { Storage } from '@hedgehog/storage';
import { loadCatalog } from './catalog';
import { DownloadManager } from './downloader';
import type { CatalogItem, DownloadState, LocalItem } from '@hedgehog/protocol';

export interface RegistryDeps {
  ipcMain: IpcMain;
  storage: Storage;
  dirs: {
    userData: string;
    llmsDir: string;
    asrsDir: string;
    ttssDir: string;
  };
  fallbackCatalogPath?: string;
  catalogUrl?: string;
  getMainWindow: () => BrowserWindow | null;
}

export function register(deps: RegistryDeps): void {
  const { ipcMain, storage, dirs, fallbackCatalogPath, catalogUrl, getMainWindow } = deps;

  // catalog 缓存：内存中保留最新一次加载结果
  let lastItems: CatalogItem[] = [];

  const downloader = new DownloadManager({
    storage,
    dirs,
    onUpdate: (states: DownloadState[]) => {
      const w = getMainWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('capability-market:downloadsUpdated', states);
      }
    },
  });

  ipcMain.handle('capability-market:getCatalog', async (_e, opts) => {
    const res = await loadCatalog({
      userData: dirs.userData,
      fallbackCatalogPath,
      catalogUrl,
      kind: opts?.kind,
      force: false,
    });
    lastItems = res.items;
    return res;
  });

  ipcMain.handle('capability-market:refreshCatalog', async (_e, opts) => {
    const res = await loadCatalog({
      userData: dirs.userData,
      fallbackCatalogPath,
      catalogUrl,
      kind: opts?.kind,
      force: true,
    });
    lastItems = res.items;
    return res;
  });

  ipcMain.handle('capability-market:listLocalItems', (_e, opts) => {
    return storage.listLocalItems(opts?.kind) as LocalItem[];
  });

  ipcMain.handle('capability-market:setCurrentItem', (_e, kind, id, version) => {
    storage.setCurrentItem(kind, id, version);
    return true;
  });

  ipcMain.handle('capability-market:deleteLocalItem', (_e, kind, id, version) => {
    const list = storage.listLocalItems(kind);
    const target = list.find((x) => x.id === id && x.version === version);
    if (target?.install_path) {
      try {
        const fs = require('node:fs');
        if (fs.statSync(target.install_path).isDirectory()) {
          fs.rmSync(target.install_path, { recursive: true, force: true });
        } else {
          fs.unlinkSync(target.install_path);
        }
      } catch (err) {
        console.warn('[market] delete file failed', err);
      }
    }
    storage.deleteLocalItem(kind, id, version);
    return true;
  });

  ipcMain.handle('capability-market:importLocalFile', (_e, kind, filePath) => {
    const fs = require('node:fs');
    const stat = fs.statSync(filePath);
    const item: LocalItem = {
      id: `imported-${kind}-${Date.now()}`,
      version: '1.0.0',
      kind,
      name: filePath.split(/[\\/]/).pop() || 'imported',
      install_path: filePath,
      size_bytes: stat.size || 0,
      downloaded_at: Date.now(),
      is_current: 0,
      is_manual_import: 1,
    };
    storage.insertLocalItem(item);
    return item;
  });

  // 下载：通过 id 找 catalog item，然后 enqueue
  function findItemById(id: string): CatalogItem | undefined {
    return lastItems.find((x) => x.id === id);
  }

  ipcMain.handle('capability-market:startDownload', (_e, id) => {
    const item = findItemById(id);
    if (!item) throw new Error(`unknown item: ${id}`);
    downloader.enqueue(item);
    return true;
  });

  ipcMain.handle('capability-market:pauseDownload', (_e, id) => {
    downloader.pause(id);
    return true;
  });

  ipcMain.handle('capability-market:resumeDownload', (_e, id) => {
    downloader.resume(id);
    return true;
  });

  ipcMain.handle('capability-market:cancelDownload', (_e, id) => {
    downloader.cancel(id);
    return true;
  });
}
