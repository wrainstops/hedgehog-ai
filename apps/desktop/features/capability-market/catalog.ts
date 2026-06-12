// 能力市场 catalog 加载器
// - 默认从 settings.catalog_url 拉取（OSS / 任何静态文件服务器均可）
// - 失败时回退到内置 fallback-models.json
// - 成功后写入 userData/catalog-cache.json 做离线缓存

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import type { Catalog, CatalogItem, ItemKind } from '@hedgehog/protocol';

export interface CatalogResult {
  items: CatalogItem[];
  updated_at: string;
  source: 'online' | 'fallback' | 'cache';
}

interface CatalogLoadOptions {
  userData: string;
  fallbackCatalogPath?: string;
  catalogUrl?: string;
  kind?: ItemKind;
  force?: boolean;
}

const CACHE_NAME = 'catalog-cache.json';

function readLocal(path_: string): Catalog | null {
  try {
    const raw = fs.readFileSync(path_, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(userData: string, data: Catalog): void {
  try {
    fs.writeFileSync(path.join(userData, CACHE_NAME), JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[catalog] writeCache failed', e);
  }
}

function httpGetJson(url: string): Promise<Catalog | null> {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: 8000 }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

export async function loadCatalog(opts: CatalogLoadOptions): Promise<CatalogResult> {
  const { userData, fallbackCatalogPath, catalogUrl, kind, force } = opts;

  // 1. 先尝试在线加载（除非 force=false 时允许先用缓存）
  let online: Catalog | null = null;
  if (catalogUrl) {
    online = await httpGetJson(catalogUrl);
    if (online) {
      writeCache(userData, online);
      return {
        items: filterByKind(online.items, kind),
        updated_at: online.updated_at,
        source: 'online',
      };
    }
  }

  // 2. 回退到缓存
  if (!force) {
    const cached = readLocal(path.join(userData, CACHE_NAME));
    if (cached) {
      return {
        items: filterByKind(cached.items, kind),
        updated_at: cached.updated_at,
        source: 'cache',
      };
    }
  }

  // 3. 最后用内置 fallback
  if (fallbackCatalogPath) {
    const fallback = readLocal(fallbackCatalogPath);
    if (fallback) {
      return {
        items: filterByKind(fallback.items, kind),
        updated_at: fallback.updated_at,
        source: 'fallback',
      };
    }
  }

  return { items: [], updated_at: new Date().toISOString(), source: 'fallback' };
}

function filterByKind(items: CatalogItem[], kind?: ItemKind): CatalogItem[] {
  if (!kind) return items;
  return items.filter((it) => it.kind === kind);
}
