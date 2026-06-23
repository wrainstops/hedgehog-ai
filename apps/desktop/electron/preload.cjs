// Electron 渲染进程 preload 脚本（contextBridge 暴露安全 API）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hedgehog', {
  // 能力市场
  capabilityMarket: {
    getCatalog: (opts) => ipcRenderer.invoke('capability-market:getCatalog', opts),
    refreshCatalog: (opts) => ipcRenderer.invoke('capability-market:refreshCatalog', opts),
    listLocalItems: (opts) => ipcRenderer.invoke('capability-market:listLocalItems', opts),
    setCurrentItem: (kind, id, version) => ipcRenderer.invoke('capability-market:setCurrentItem', kind, id, version),
    deleteLocalItem: (kind, id, version) => ipcRenderer.invoke('capability-market:deleteLocalItem', kind, id, version),
    startDownload: (id) => ipcRenderer.invoke('capability-market:startDownload', id),
    pauseDownload: (id) => ipcRenderer.invoke('capability-market:pauseDownload', id),
    resumeDownload: (id) => ipcRenderer.invoke('capability-market:resumeDownload', id),
    cancelDownload: (id) => ipcRenderer.invoke('capability-market:cancelDownload', id),
    onDownloadProgress: (callback) => {
      // pushDownloadUpdate sends array of downloads
      const handler = (_e, downloads) => {
        console.log('[preload] Received downloads update:', downloads);
        callback(downloads);
      };
      ipcRenderer.on('capability-market:downloadsUpdated', handler);
      return () => ipcRenderer.removeListener('capability-market:downloadsUpdated', handler);
    }
  },

  // LLM 推理
  llm: {
    getState: () => ipcRenderer.invoke('llm:getState'),
    load: (id, installPath, opts) => ipcRenderer.invoke('llm:load', id, installPath, opts),
    unload: () => ipcRenderer.invoke('llm:unload'),
    generate: (messages, opts) => ipcRenderer.invoke('llm:generate', messages, opts),
    stop: () => ipcRenderer.invoke('llm:stop'),
    onToken: (callback) => {
      const handler = (_e, text) => callback(text);
      ipcRenderer.on('llm:token', handler);
      return () => ipcRenderer.removeListener('llm:token', handler);
    }
  },

  // 文件系统
  shell: {
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath)
  },

  // 对话框
  dialog: {
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),
  },

  // i18n
  i18n: {
    getLang: () => ipcRenderer.invoke('i18n:getLang'),
    setLang: (lang) => ipcRenderer.invoke('i18n:setLang', lang),
    t: (key, params) => ipcRenderer.invoke('i18n:t', key, params),
    onLangChange: (callback) => {
      const handler = (_e, lang) => callback(lang);
      ipcRenderer.on('i18n:changed', handler);
      return () => ipcRenderer.removeListener('i18n:changed', handler);
    }
  },

  // 设置
  settings: {
    getDownloadPaths: () => ipcRenderer.invoke('settings:getDownloadPaths'),
    setDownloadPath: (basePath) => ipcRenderer.invoke('settings:setDownloadPath', basePath),
  }
});