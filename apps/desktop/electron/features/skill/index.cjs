// 技能运行时 - HTTP Proxy Executor
//
// 每个技能的目录结构：
//   userData/skills/<id>-<version>/
//     skill.json
//     (可选：其他资源文件)
//
// skill.json 示例：
// {
//   "id": "weather-cn",
//   "version": "1.0.0",
//   "name": "天气查询（中国）",
//   "description": "查询中国城市的天气",
//   "runtime": "http-proxy",
//   "permissions": { "network": ["https://wttr.in"] },
//   "tools": [
//     {
//       "name": "get_weather",
//       "description": "查询指定城市的天气",
//       "endpoint": "https://wttr.in/{city}?format=j1",
//       "method": "GET",
//       "input_schema": {
//         "type": "object",
//         "properties": { "city": { "type": "string" } },
//         "required": ["city"]
//       },
//       "response_path": "current_condition.0"     // （可选）从响应里取某字段返回
//     }
//   ]
// }
//
// 主进程暴露 IPC：
//   skill:listAll            -> 列出已安装的所有技能
//   skill:enable  (id, ver)  -> 启用
//   skill:disable (id, ver)  -> 停用
//   skill:uninstall(id, ver) -> 卸载（删除目录）
//   skill:invoke (id, ver, toolName, args) -> 调用一个工具
//
// 权限策略：
//   - 只允许访问 skill.json 中 permissions.network 声明的 host
//   - http-proxy executor 不允许执行任意代码，只允许发 HTTP 请求

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { app, ipcMain } = require('electron');

// 内存状态：已加载的 skills manifest 缓存（Map<"id@version", SkillManifest>）
const loadedManifests = new Map();
// 启用状态（同步写入本地库，持久化；使用一个简单 JSON 文件）
let enabledFile = '';
let enabledCache = {};  // { "id@version": true/false }

/**
 * 技能 manifest 的 TypeScript 接口（仅供开发者参考，JS 中做运行时校验）
 */
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return 'invalid manifest (not an object)';
  if (!manifest.id || typeof manifest.id !== 'string') return 'invalid manifest: missing id';
  if (!manifest.version || typeof manifest.version !== 'string') return 'invalid manifest: missing version';
  if (!manifest.runtime || manifest.runtime !== 'http-proxy') return 'invalid manifest: only http-proxy supported';
  if (!Array.isArray(manifest.tools)) return 'invalid manifest: missing tools[]';
  for (const t of manifest.tools) {
    if (!t.name || !t.endpoint) return `invalid tool: ${JSON.stringify(t)}`;
  }
  return null;
}

function getKey(id, version) { return `${id}@${version}`; }

function loadEnabled() {
  try {
    if (!enabledFile) return;
    if (!fs.existsSync(enabledFile)) { enabledCache = {}; return; }
    enabledCache = JSON.parse(fs.readFileSync(enabledFile, 'utf8'));
  } catch { enabledCache = {}; }
}

function saveEnabled() {
  try { fs.writeFileSync(enabledFile, JSON.stringify(enabledCache)); } catch {}
}

function getSkillsDir() {
  return path.join(app.getPath('userData'), 'skills');
}

/** 扫描 skillsDir，读取并解析所有子目录下的 skill.json */
function listAll() {
  const skillsDir = getSkillsDir();
  const results = [];
  if (!fs.existsSync(skillsDir)) return results;
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(skillsDir, entry.name, 'skill.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const err = validateManifest(manifest);
      if (err) { console.warn('[skill]', entry.name, err); continue; }
      const key = getKey(manifest.id, manifest.version);
      loadedManifests.set(key, { ...manifest, install_path: path.join(skillsDir, entry.name) });
      results.push({
        id: manifest.id,
        version: manifest.version,
        runtime: manifest.runtime,
        name: manifest.name,
        description: manifest.description,
        install_path: path.join(skillsDir, entry.name),
        tools: manifest.tools,
        permissions: manifest.permissions || {},
        enabled: enabledCache[key] !== false,  // 默认 true
      });
    } catch (e) {
      console.warn('[skill] failed to load', entry.name, e);
    }
  }
  return results;
}

function enable(id, version) {
  enabledCache[getKey(id, version)] = true;
  saveEnabled();
  return true;
}

function disable(id, version) {
  enabledCache[getKey(id, version)] = false;
  saveEnabled();
  return true;
}

function uninstall(id, version) {
  const key = getKey(id, version);
  const existing = loadedManifests.get(key);
  if (existing && existing.install_path && fs.existsSync(existing.install_path)) {
    try { fs.rmSync(existing.install_path, { recursive: true, force: true }); } catch (e) { console.warn('[skill] uninstall failed', e); return false; }
  }
  loadedManifests.delete(key);
  delete enabledCache[key];
  saveEnabled();
  return true;
}

function findTool(manifest, toolName) {
  return (manifest.tools || []).find(t => t.name === toolName);
}

function validateHost(manifest, urlString) {
  const allowList = (manifest.permissions?.network || []);
  if (!allowList.length) return false;
  let url;
  try { url = new URL(urlString); } catch { return false; }
  for (const pattern of allowList) {
    // 支持精确匹配或 "https://api.example.com" 前缀匹配（scheme + host + optional path prefix）
    if (urlString === pattern || urlString.startsWith(pattern)) return true;
    // 也允许只声明 host
    if (pattern === url.host) return true;
  }
  return false;
}

function renderTemplate(str, args) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => (args && args[k] != null ? String(args[k]) : ''));
}

// 从嵌套对象按点号路径取值（current_condition.0 -> obj.current_condition[0]）
function pickByPath(obj, pathStr) {
  if (!pathStr) return obj;
  return pathStr.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/** 调用一个技能工具；返回 {ok, data, error?} */
async function invoke(id, version, toolName, args) {
  const key = getKey(id, version);
  let manifest = loadedManifests.get(key);
  if (!manifest) {
    // 尝试懒加载
    listAll();
    manifest = loadedManifests.get(key);
  }
  if (!manifest) return { ok: false, error: `skill ${key} not found` };
  if (enabledCache[key] === false) return { ok: false, error: 'skill disabled' };

  const tool = findTool(manifest, toolName);
  if (!tool) return { ok: false, error: `tool "${toolName}" not found in skill` };

  // 参数校验（简化版）：检查 required 字段是否存在
  const required = tool.input_schema?.required || [];
  for (const r of required) {
    if (args == null || args[r] == null || args[r] === '') {
      return { ok: false, error: `missing required arg: ${r}` };
    }
  }

  const finalUrl = renderTemplate(tool.endpoint, args);
  if (!validateHost(manifest, finalUrl)) {
    return { ok: false, error: `URL not allowed by permissions: ${finalUrl}` };
  }

  const method = (tool.method || 'GET').toUpperCase();
  let body = undefined;
  let headers = { 'Content-Type': 'application/json', 'User-Agent': 'hedgehog-ai' };
  if (method !== 'GET' && method !== 'HEAD' && args) body = JSON.stringify(args);

  try {
    const data = await httpRequest(finalUrl, { method, headers, body });
    const parsed = JSON.parse(data);
    return { ok: true, data: pickByPath(parsed, tool.response_path) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function httpRequest(urlStr, opts) {
  return new Promise<string>((resolve, reject) => {
    const client = urlStr.startsWith('https:') ? https : http;
    const u = new URL(urlStr);
    const req = client.request({
      hostname: u.hostname,
      port: u.port || (urlStr.startsWith('https:') ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method,
      headers: opts.headers,
      timeout: 10_000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** 在 Electron 主进程初始化 IPC handlers */
function registerHandlers() {
  enabledFile = path.join(app.getPath('userData'), 'skills-enabled.json');
  loadEnabled();

  ipcMain.handle('skill:listAll', () => listAll());
  ipcMain.handle('skill:listEnabled', () => listAll().filter(s => s.enabled !== false));
  ipcMain.handle('skill:enable', (_e, id, version) => enable(id, version));
  ipcMain.handle('skill:disable', (_e, id, version) => disable(id, version));
  ipcMain.handle('skill:uninstall', (_e, id, version) => uninstall(id, version));
  ipcMain.handle('skill:invoke', (_e, id, version, toolName, args) => invoke(id, version, toolName, args));
}

// 暴露 register 给 main.cjs 调用
module.exports = { register: registerHandlers };
