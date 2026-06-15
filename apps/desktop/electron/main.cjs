// Electron 主进程入口
// - SQLite (better-sqlite3) 存设置 / 下载状态 / 本地能力注册表
// - IPC 暴露 window.hedgehog.* API（preload.cjs 已定义）
// - 能力市场 catalog：HTTP + 内置 fallback + userData cache

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const llm = require('./features/llm/index.cjs');
const skill = require('./features/skill/index.cjs');

// --- 初始化目录 & SQLite ---
const userData = app.getPath('userData');
const llmsDir = path.join(userData, 'llms');
const asrsDir = path.join(userData, 'asrs');
const ttssDir = path.join(userData, 'tts');
const skillsDir = path.join(userData, 'skills');
for (const d of [llmsDir, asrsDir, ttssDir, skillsDir]) fs.mkdirSync(d, { recursive: true });

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.warn('[main] better-sqlite3 not installed — using JSON-file fallback storage');
}

const Storage = (() => {
  if (Database) {
    const db = new Database(path.join(userData, 'hedgehog.sqlite'));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_items (
        id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL,
        name TEXT NOT NULL, size_bytes INTEGER, install_path TEXT NOT NULL,
        sha256 TEXT, downloaded_at INTEGER,
        is_current INTEGER DEFAULT 0, is_manual_import INTEGER DEFAULT 0,
        PRIMARY KEY (id, version, kind)
      );
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL,
        total_bytes INTEGER NOT NULL, downloaded_bytes INTEGER DEFAULT 0,
        speed_bps INTEGER DEFAULT 0, started_at INTEGER,
        finished_at INTEGER, error TEXT, target_path TEXT NOT NULL,
        url TEXT NOT NULL, mirror_index INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT
      );
    `);
    return {
      getSetting: (k) => {
        const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
        return r ? r.value : null;
      },
      setSetting: (k, v) => {
        db.prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run(k, v);
      },
      deleteSetting: (k) => {
        db.prepare('DELETE FROM settings WHERE key = ?').run(k);
      },
      listLocalItems: (kind) => {
        if (kind) return db.prepare('SELECT * FROM local_items WHERE kind = ? ORDER BY downloaded_at DESC').all(kind);
        return db.prepare('SELECT * FROM local_items ORDER BY kind, downloaded_at DESC').all();
      },
      insertLocalItem: (it) => {
        db.prepare(
          `INSERT INTO local_items (id, version, kind, name, size_bytes, install_path, sha256, downloaded_at, is_current, is_manual_import)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id, version, kind) DO UPDATE SET
             name = excluded.name, size_bytes = excluded.size_bytes,
             install_path = excluded.install_path, sha256 = excluded.sha256,
             downloaded_at = excluded.downloaded_at, is_current = excluded.is_current`
        ).run(it.id, it.version, it.kind, it.name, it.size_bytes || null, it.install_path, it.sha256 || null, it.downloaded_at, it.is_current || 0, it.is_manual_import || 0);
      },
      setCurrentItem: (kind, id, version) => {
        db.prepare('UPDATE local_items SET is_current = 0 WHERE kind = ?').run(kind);
        db.prepare('UPDATE local_items SET is_current = 1 WHERE kind = ? AND id = ? AND version = ?').run(kind, id, version);
      },
      deleteLocalItem: (kind, id, version) => {
        db.prepare('DELETE FROM local_items WHERE kind = ? AND id = ? AND version = ?').run(kind, id, version);
      },
      upsertDownload: (d) => {
        db.prepare(
          `INSERT INTO downloads (id, kind, state, total_bytes, downloaded_bytes, speed_bps, started_at, finished_at, error, target_path, url, mirror_index)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, downloaded_bytes = excluded.downloaded_bytes,
             speed_bps = excluded.speed_bps, error = excluded.error`
        ).run(d.id, d.kind, d.state, d.total_bytes, d.downloaded_bytes, d.speed_bps, d.started_at || null, d.finished_at || null, d.error || null, d.target_path, d.url, d.mirror_index || 0);
      },
      deleteDownload: (id) => db.prepare('DELETE FROM downloads WHERE id = ?').run(id),
    };
  }
  // JSON fallback
  const dbFile = path.join(userData, 'hedgehog-fallback.json');
  let data = { local_items: [], downloads: [], settings: {} };
  try { data = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  return {
    getSetting: (k) => data.settings[k] ?? null,
    setSetting: (k, v) => { data.settings[k] = v; save(); },
    deleteSetting: (k) => { delete data.settings[k]; save(); },
    listLocalItems: (kind) => kind ? data.local_items.filter(i => i.kind === kind) : data.local_items,
    insertLocalItem: (it) => {
      const idx = data.local_items.findIndex(x => x.id === it.id && x.version === it.version && x.kind === it.kind);
      if (idx >= 0) data.local_items[idx] = { ...data.local_items[idx], ...it };
      else data.local_items.push(it);
      save();
    },
    setCurrentItem: (kind, id, version) => {
      for (const it of data.local_items) if (it.kind === kind) it.is_current = 0;
      const t = data.local_items.find(x => x.kind === kind && x.id === id && x.version === version);
      if (t) t.is_current = 1;
      save();
    },
    deleteLocalItem: (kind, id, version) => {
      data.local_items = data.local_items.filter(x => !(x.kind === kind && x.id === id && x.version === version));
      save();
    },
    upsertDownload: (d) => {
      const idx = data.downloads.findIndex(x => x.id === d.id);
      if (idx >= 0) data.downloads[idx] = { ...data.downloads[idx], ...d };
      else data.downloads.push(d);
      save();
    },
    deleteDownload: (id) => { data.downloads = data.downloads.filter(x => x.id !== id); save(); },
  };
})();

// --- i18n 简易实现 ---
function loadMessages(lang) {
  const namespaces = ['common', 'nav', 'model-market', 'voice', 'skill-market'];
  const result = {};
  // __dirname 是 apps/desktop/electron/，需要上 3 级到项目根目录
  const localeDirs = [
    path.join(__dirname, '..', '..', '..', 'packages', 'i18n', 'locales', lang),
    path.join(userData, 'locales', lang),
  ];
  console.log('[i18n] Loading from:', localeDirs[0]);
  for (const ns of namespaces) {
    for (const dir of localeDirs) {
      const file = path.join(dir, `${ns}.json`);
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        // 为每个键添加命名空间前缀
        for (const [key, value] of Object.entries(parsed)) {
          result[`${ns}.${key}`] = value;
        }
      } catch (err) {
        console.log('[i18n] Failed to load:', file, err?.message);
      }
    }
  }
  console.log('[i18n] Loaded', Object.keys(result).length, 'translation keys');
  return result;
}

let i18nCache = { lang: 'zh-CN', dict: {} };
function getI18nDict(lang) {
  console.log('[i18n main] getI18nDict called with:', lang, 'cached lang:', i18nCache.lang);
  if (i18nCache.lang === lang && Object.keys(i18nCache.dict).length > 0) {
    console.log('[i18n main] Returning cached dict with', Object.keys(i18nCache.dict).length, 'keys');
    return i18nCache.dict;
  }
  console.log('[i18n main] Loading fresh translations...');
  const primary = loadMessages(lang);
  console.log('[i18n main] Primary dict keys:', Object.keys(primary).length);
  const fallback = loadMessages('zh-CN');
  console.log('[i18n main] Fallback dict keys:', Object.keys(fallback).length);
  const dict = { ...fallback, ...primary };
  console.log('[i18n main] Merged dict keys:', Object.keys(dict).length, 'nav.settings:', dict['nav.settings']);
  i18nCache = { lang, dict };
  return dict;
}
function translate(key, params) {
  const currentLang = Storage.getSetting('i18n.lang') || 'zh-CN';
  console.log('[i18n main] translate called, key:', key, 'currentLang:', currentLang);
  const dict = getI18nDict(currentLang);
  let raw = dict[key] ?? key;
  console.log('[i18n main] translate result:', key, '->', raw);
  if (params) {
    for (const [k, v] of Object.entries(params)) raw = raw.split('{' + k + '}').join(String(v));
  }
  return raw;
}

// --- Catalog（能力市场列表） ---
const CATALOG_URL_DEFAULT = '';
let inMemoryCatalog = [];

function resolveFallbackPath() {
  const tryPaths = [
    path.join(__dirname, '..', 'resources', 'fallback-models.json'),
    path.join(__dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'fallback-models.json'),
  ];
  const found = tryPaths.find(p => {
    const exists = fs.existsSync(p);
    console.log('[i18n] Checking fallback path:', p, exists ? '✓' : '✗');
    return exists;
  });
  return found;
}

function httpGetJson(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: 8000 }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return resolve(null); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function loadCatalog({ kind, force } = {}) {
  const url = Storage.getSetting('catalog_url') || CATALOG_URL_DEFAULT;
  const cacheFile = path.join(userData, 'catalog-cache.json');
  // 1. online
  if (!force && url) {
    const data = await httpGetJson(url);
    if (data) {
      fs.writeFileSync(cacheFile, JSON.stringify(data));
      inMemoryCatalog = data.items || [];
      return { items: (data.items || []).filter(i => !kind || i.kind === kind), updated_at: data.updated_at, source: 'online' };
    }
  }
  // 2. cache
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    inMemoryCatalog = cached.items || [];
    return { items: inMemoryCatalog.filter(i => !kind || i.kind === kind), updated_at: cached.updated_at, source: 'cache' };
  } catch {}
  // 3. fallback
  const fallbackFile = resolveFallbackPath();
  if (fallbackFile) {
    try {
      const fb = JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
      inMemoryCatalog = fb.items || [];
      return { items: inMemoryCatalog.filter(i => !kind || i.kind === kind), updated_at: fb.updated_at, source: 'fallback' };
    } catch {}
  }
  inMemoryCatalog = [];
  return { items: [], updated_at: new Date().toISOString(), source: 'fallback' };
}

// --- 下载引擎 ---
// 默认下载路径（在 userData 下）
const defaultLlmsDir = path.join(userData, 'llms');
const defaultAsrsDir = path.join(userData, 'asrs');
const defaultTtssDir = path.join(userData, 'tts');
const defaultSkillsDir = path.join(userData, 'skills');

// 获取当前下载路径配置
function getKindDir(kind) {
  const customBase = Storage.getSetting('download.base_path');
  if (customBase) {
    return path.join(customBase, kind);
  }
  return ({
    llm: defaultLlmsDir,
    asr: defaultAsrsDir,
    tts: defaultTtssDir,
    skill: defaultSkillsDir,
  })[kind] || userData;
}

// 确保下载目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const tasks = new Map();   // id -> task
let activeTaskId = null;

// 获取所有下载路径配置
ipcMain.handle('settings:getDownloadPaths', () => {
  const customBase = Storage.getSetting('download.base_path');
  return {
    basePath: customBase || userData,
    isCustom: !!customBase,
    llmsDir: path.join(customBase || userData, 'llm'),
    asrsDir: path.join(customBase || userData, 'asr'),
    ttssDir: path.join(customBase || userData, 'tts'),
    skillsDir: path.join(customBase || userData, 'skill'),
  };
});

// 设置自定义下载路径
ipcMain.handle('settings:setDownloadPath', (_e, basePath) => {
  if (basePath && basePath !== userData) {
    Storage.setSetting('download.base_path', basePath);
    // 确保新路径存在
    ensureDir(path.join(basePath, 'llm'));
    ensureDir(path.join(basePath, 'asr'));
    ensureDir(path.join(basePath, 'tts'));
    ensureDir(path.join(basePath, 'skill'));
  } else {
    Storage.deleteSetting('download.base_path');
    // 确保默认路径存在
    for (const d of [defaultLlmsDir, defaultAsrsDir, defaultTtssDir, defaultSkillsDir]) {
      ensureDir(d);
    }
  }
  return true;
});

// Dialog IPC handlers
ipcMain.handle('dialog:showOpenDialog', async (_e, options) => {
  const mainWin = BrowserWindow.getAllWindows()[0];
  return await dialog.showOpenDialog(mainWin, options);
});

ipcMain.handle('dialog:showSaveDialog', async (_e, options) => {
  const mainWin = BrowserWindow.getAllWindows()[0];
  return await dialog.showSaveDialog(mainWin, options);
});

ipcMain.handle('dialog:showMessageBox', async (_e, options) => {
  const mainWin = BrowserWindow.getAllWindows()[0];
  return await dialog.showMessageBox(mainWin, options);
});

function pushDownloadUpdate() {
  const mainWin = BrowserWindow.getAllWindows()[0];
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.webContents.send('capability-market:downloadsUpdated',
    Array.from(tasks.values()).map(t => ({
      id: t.item.id, kind: t.item.kind, state: t.status,
      total_bytes: t.totalBytes, downloaded_bytes: t.downloadedBytes, speed_bps: t.speed,
      error: t.error,
    })));
}

async function runTask(t) {
  t.status = 'downloading';
  pushDownloadUpdate();
  try {
    // resume from partial file
    if (fs.existsSync(t.tmpPath)) {
      t.downloadedBytes = fs.statSync(t.tmpPath).size;
    } else {
      t.downloadedBytes = 0;
    }
    // fetch
    const urls = [t.url, ...(t.mirrors || [])];
    let success = false;
    for (let attempt = 0; attempt < urls.length && !success; attempt++) {
      t.url = urls[attempt];
      console.log('[download] Attempting to download from:', t.url);
      try {
        await fetchWithRange(t);
        success = true;
        console.log('[download] Download completed successfully');
      } catch (e) {
        console.error('[download] Download failed:', e?.message || e);
        t.error = e?.message || String(e);
        pushDownloadUpdate();
      }
    }
    if (!success) throw new Error(t.error || 'all mirrors failed');
    // unzip if needsUnzip
    if (t.item.download?.needsUnzip) {
      t.status = 'extracting';
      pushDownloadUpdate();
      await unzipTo(t.tmpPath, t.targetPath);
      fs.unlinkSync(t.tmpPath);
    } else {
      fs.renameSync(t.tmpPath, t.targetPath);
    }
    // register in local_items
    Storage.insertLocalItem({
      id: t.item.id, version: t.item.version, kind: t.item.kind,
      name: (t.item.name && (t.item.name['zh-CN'] || t.item.name['en-US'])) || t.item.id,
      size_bytes: t.totalBytes, install_path: t.targetPath,
      sha256: t.sha, downloaded_at: Date.now(), is_current: 0, is_manual_import: 0,
    });
    t.status = 'done';
    console.log('[download] Task completed:', t.item.id);
    pushDownloadUpdate();
  } catch (err) {
    console.error('[download] Task failed:', err?.message || err);
    t.status = 'failed';
    t.error = err?.message || String(err);
    pushDownloadUpdate();
  } finally {
    activeTaskId = null;
    maybeRunNext();
  }
}

function fetchWithRange(t) {
  return new Promise((resolve, reject) => {
    const client = t.url.startsWith('https:') ? https : http;
    const u = new URL(t.url);
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(t.downloadedBytes > 0 ? { Range: `bytes=${t.downloadedBytes}-` } : {})
      },
      timeout: 30_000
    };
    let hash = crypto.createHash('sha256');
    // 已有部分写入 → hash
    if (t.downloadedBytes > 0 && fs.existsSync(t.tmpPath)) {
      const fd = fs.openSync(t.tmpPath, 'r');
      const buf = Buffer.alloc(64 * 1024);
      let read = 0;
      while (read < t.downloadedBytes) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, t.downloadedBytes - read), read);
        if (n <= 0) break;
        hash.update(buf.subarray(0, n));
        read += n;
      }
      fs.closeSync(fd);
    }
    const req = client.get(opts, (res) => {
      console.log('[download] Response status:', res.statusCode, 'URL:', t.url);

      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers.location;
        if (location) {
          console.log('[download] Redirecting to:', location);
          t.url = location;
          res.resume();
          fetchWithRange(t).then(resolve).catch(reject);
          return;
        }
      }

      if (!res.statusCode || (res.statusCode !== 200 && res.statusCode !== 206)) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (res.statusCode === 200 && t.downloadedBytes > 0) {
        // server doesn't support range
        t.downloadedBytes = 0;
        hash = crypto.createHash('sha256');
        fs.truncateSync(t.tmpPath, 0);
      }
      if (!t.totalBytes) {
        const cl = res.headers['content-length'];
        if (cl) t.totalBytes = parseInt(cl, 10) + t.downloadedBytes;
      }
      const file = fs.createWriteStream(t.tmpPath, { flags: t.downloadedBytes > 0 ? 'r+' : 'w', start: t.downloadedBytes });
      let speed = 0;
      let lastReport = Date.now();
      let windowBytes = 0;
      res.on('data', (chunk) => {
        if (t.status !== 'downloading') { res.destroy(); return; }
        t.downloadedBytes += chunk.length;
        windowBytes += chunk.length;
        hash.update(chunk);
        file.write(chunk);
        const now = Date.now();
        if (now - lastReport > 400) {
          speed = Math.floor(windowBytes / ((now - lastReport) / 1000) || 1);
          t.speed = speed;
          windowBytes = 0;
          lastReport = now;
          pushDownloadUpdate();
        }
      });
      res.on('end', () => {
        file.end(() => {
          t.sha = hash.digest('hex');
          if (t.item.download?.sha256 && t.sha !== t.item.download.sha256) {
            return reject(new Error('sha256 mismatch'));
          }
          resolve();
        });
      });
      res.on('error', (e) => { try { file.destroy(); } catch {}; reject(e); });
      file.on('error', (e) => { res.destroy(); reject(e); });
    });
    req.on('error', (e) => {
      console.error('[download] Request error:', e?.message || e);
      reject(e);
    });
    req.on('timeout', () => {
      console.error('[download] Request timeout');
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

async function unzipTo(zipFile, targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const buf = fs.readFileSync(zipFile);
  let offset = 0;
  while (offset < buf.length - 30) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const compression = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buf.slice(dataStart, dataStart + compressedSize);
    const outPath = path.join(targetDir, name);
    if (name.endsWith('/')) {
      fs.mkdirSync(outPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      let decompressed;
      if (compression === 0) decompressed = compressed;
      else if (compression === 8) decompressed = zlib.inflateRawSync(compressed);
      else throw new Error(`unsupported zip compression ${compression}`);
      fs.writeFileSync(outPath, decompressed);
    }
    offset = dataStart + compressedSize;
  }
}

function maybeRunNext() {
  if (activeTaskId) return;
  const t = Array.from(tasks.values()).find(x => x.status === 'queued');
  if (!t) return;
  activeTaskId = t.item.id;
  runTask(t);
}

function enqueue(item) {
  console.log('[download] enqueue called with item:', JSON.stringify(item, null, 2));
  
  if (tasks.has(item.id)) {
    const t = tasks.get(item.id);
    if (t.status === 'failed' || t.status === 'done') tasks.delete(item.id);
    else return;
  }
  
  const existingItems = Storage.listLocalItems(item.kind);
  const isAlreadyDownloaded = existingItems.some(
    x => x.id === item.id && x.version === item.version
  );
  if (isAlreadyDownloaded) {
    console.log('[download] Item already downloaded:', item.id, item.version);
    return;
  }
  const dir = getKindDir(item.kind);
  console.log('[download] getKindDir for', item.kind, '->', dir);
  ensureDir(dir);
  const needsUnzip = !!item.download?.needsUnzip;
  const targetPath = needsUnzip ? path.join(dir, `${item.id}-${item.version}`)
                                : path.join(dir, item.download?.filename || item.id);
  const tmpPath = path.join(dir, `${item.download?.filename || item.id}.download`);
  console.log('[download] targetPath:', targetPath);
  console.log('[download] tmpPath:', tmpPath);
  const task = {
    item, kind: item.kind, url: item.download?.url, mirrors: item.download?.mirrors || [],
    targetPath, tmpPath, totalBytes: item.size_bytes, downloadedBytes: 0,
    speed: 0, status: 'queued', sha: null,
  };
  tasks.set(item.id, task);
  Storage.upsertDownload({
    id: item.id, kind: item.kind, state: 'queued',
    total_bytes: item.size_bytes, downloaded_bytes: 0, speed_bps: 0,
    started_at: Date.now(), target_path: targetPath, url: item.download?.url, mirror_index: 0,
  });
  pushDownloadUpdate();
  maybeRunNext();
}

// --- window ---
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  // ---- IPC handlers ----
  skill.register();
  // filesystem
  ipcMain.handle('shell:openPath', (_e, p) => { try { shell.showItemInFolder(p); return true; } catch { return false; } });

  // i18n
  ipcMain.handle('i18n:getLang', () => Storage.getSetting('i18n.lang') || 'zh-CN');
  ipcMain.handle('i18n:setLang', async (_e, lang) => {
    const oldLang = Storage.getSetting('i18n.lang') || 'zh-CN';
    Storage.setSetting('i18n.lang', lang);
    i18nCache = { lang, dict: {} };
    // 广播语言变化到所有窗口
    if (oldLang !== lang) {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('i18n:changed', lang);
        }
      });
    }
    return true;
  });
  ipcMain.handle('i18n:t', (_e, key, params) => translate(key, params));

  // settings
  ipcMain.handle('settings:get', (_e, k) => Storage.getSetting(k));
  ipcMain.handle('settings:set', (_e, k, v) => { Storage.setSetting(k, v); return true; });

  // capability-market
  ipcMain.handle('capability-market:getCatalog', async (_e, opts) => {
    const r = await loadCatalog(opts || {});
    return r;
  });
  ipcMain.handle('capability-market:refreshCatalog', async (_e, opts) => loadCatalog({ ...(opts || {}), force: true }));
  ipcMain.handle('capability-market:listLocalItems', (_e, opts) => Storage.listLocalItems(opts?.kind));
  ipcMain.handle('capability-market:setCurrentItem', (_e, kind, id, version) => { Storage.setCurrentItem(kind, id, version); return true; });
  ipcMain.handle('capability-market:deleteLocalItem', (_e, kind, id, version) => {
    const list = Storage.listLocalItems(kind);
    const t = list.find(x => x.id === id && x.version === version);
    if (t?.install_path) {
      try {
        const stat = fs.statSync(t.install_path);
        if (stat.isDirectory()) fs.rmSync(t.install_path, { recursive: true, force: true });
        else fs.unlinkSync(t.install_path);
      } catch {}
    }
    Storage.deleteLocalItem(kind, id, version);
    return true;
  });
  ipcMain.handle('capability-market:importLocalFile', (_e, kind, filePath) => {
    const stat = fs.statSync(filePath);
    const item = {
      id: `imported-${kind}-${Date.now()}`, version: '1.0.0', kind,
      name: filePath.split(/[\\/]/).pop() || 'imported',
      install_path: filePath, size_bytes: stat.size || 0,
      downloaded_at: Date.now(), is_current: 0, is_manual_import: 1,
    };
    Storage.insertLocalItem(item);
    return item;
  });
  ipcMain.handle('capability-market:startDownload', (_e, id) => {
    console.log('[download] startDownload called with id:', id);
    console.log('[download] inMemoryCatalog has', inMemoryCatalog.length, 'items');
    const item = inMemoryCatalog.find(x => x.id === id);
    if (!item) {
      console.log('[download] Item not found in catalog:', id);
      throw new Error(`unknown item: ${id}`);
    }
    console.log('[download] Found item:', item.id, item.name);
    enqueue(item);
    return true;
  });
  ipcMain.handle('capability-market:pauseDownload', (_e, id) => { const t = tasks.get(id); if (t && t.status === 'downloading') t.status = 'paused'; pushDownloadUpdate(); return true; });
  ipcMain.handle('capability-market:resumeDownload', (_e, id) => { const t = tasks.get(id); if (t && t.status === 'paused') { t.status = 'queued'; pushDownloadUpdate(); maybeRunNext(); } return true; });
  ipcMain.handle('capability-market:cancelDownload', (_e, id) => {
    const t = tasks.get(id);
    if (t) {
      if (t.status === 'downloading') t.status = 'paused';
      try { fs.unlinkSync(t.tmpPath); } catch {}
      tasks.delete(id);
    }
    Storage.deleteDownload(id);
    pushDownloadUpdate();
    return true;
  });

  // voice placeholder (无模型时不做真实识别)
  ipcMain.handle('voice:startRecording', () => ({ ok: true, hint: 'voice placeholder' }));
  ipcMain.handle('voice:stopRecording', () => ({ text: '' }));
  ipcMain.handle('voice:cancelRecording', () => true);
  ipcMain.handle('voice:getState', () => ({ status: 'idle' }));

  // LLM 推理
  ipcMain.handle('llm:getState', () => llm.getState());
  ipcMain.handle('llm:load', async (_e, itemId, modelPath, opts) => {
    return llm.loadModel(itemId, modelPath, opts || {});
  });
  ipcMain.handle('llm:unload', () => llm.unloadModel());
  ipcMain.handle('llm:generate', async (_e, messages, options) => {
    const mainWin = BrowserWindow.getAllWindows()[0];
    const onToken = (text) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('llm:token', text);
      }
    };
    const result = await llm.generate(messages || [], onToken, options || {});
    return result;
  });
  ipcMain.handle('llm:stop', () => { llm.stopGeneration(); return true; });

  // 启动 UI
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
