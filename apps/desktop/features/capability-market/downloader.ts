// 下载引擎
// 支持:
//   - Range 断点续传
//   - 流式写盘 + 实时 sha256
//   - zip 解压（当 item.download.needsUnzip === true 时）
//   - 失败自动切换 download.mirrors（仅简单顺序切换，非指数退避）
//   - 并发队列：同一时间只下一个，其他 queued
//   - 速度 / ETA 计算（10 秒滑动窗口）

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import type { CatalogItem, DownloadState, ItemKind } from '@hedgehog/protocol';
import type { Storage } from '@hedgehog/storage';

export interface DownloaderDeps {
  storage: Storage;
  dirs: {
    userData: string;
    llmsDir: string;
    asrsDir: string;
    ttssDir: string;
    skillsDir: string;
  };
  onUpdate: (states: DownloadState[]) => void;
}

type TaskStatus = 'queued' | 'downloading' | 'extracting' | 'paused' | 'failed' | 'done';

interface Task {
  item: CatalogItem;
  kind: ItemKind;
  url: string;
  mirrors: string[];
  mirrorIndex: number;
  targetPath: string;        // 最终保存路径（文件 or 目录）
  tmpPath: string;           // 下载临时文件（.download 后缀）
  totalBytes: number;
  downloadedBytes: number;
  startedAt: number;
  speedSamples: Array<{ t: number; bytes: number }>;
  status: TaskStatus;
  error?: string;
  cancelRequested?: boolean;
  resumeFrom: number;
  hash: crypto.Hash;
}

function targetDirForKind(deps: DownloaderDeps, kind: ItemKind): string {
  switch (kind) {
    case 'llm': return deps.dirs.llmsDir;
    case 'asr': return deps.dirs.asrsDir;
    case 'tts': return deps.dirs.ttssDir;
    case 'skill': return deps.dirs.skillsDir;
  }
}

export class DownloadManager {
  private deps: DownloaderDeps;
  private tasks = new Map<string, Task>();
  private activeId: string | null = null;

  constructor(deps: DownloaderDeps) {
    this.deps = deps;
  }

  /** catalog 中找到 item 并启动下载 */
  enqueue(item: CatalogItem): void {
    if (this.tasks.has(item.id)) {
      // 已存在：如果是 failed/done，允许重新下载
      const t = this.tasks.get(item.id)!;
      if (t.status === 'failed' || t.status === 'done') {
        this.tasks.delete(item.id);
      } else {
        return;
      }
    }
    const dir = targetDirForKind(this.deps, item.kind);
    fs.mkdirSync(dir, { recursive: true });
    const needsUnzip = item.download.needsUnzip;
    // 文件目标：zip 文件解压到 {dir}/{id}-{version}/ 目录；直接文件放 {dir}/{filename}
    const targetPath = needsUnzip
      ? path.join(dir, `${item.id}-${item.version}`)
      : path.join(dir, item.download.filename || item.id);
    const tmpPath = path.join(dir, `${item.download.filename || item.id}.download`);

    const task: Task = {
      item,
      kind: item.kind,
      url: item.download.url,
      mirrors: item.download.mirrors || [],
      mirrorIndex: 0,
      targetPath,
      tmpPath,
      totalBytes: item.size_bytes,
      downloadedBytes: 0,
      startedAt: Date.now(),
      speedSamples: [],
      status: 'queued',
      resumeFrom: 0,
      hash: crypto.createHash('sha256'),
    };
    this.tasks.set(item.id, task);
    // 同步到 storage（持久化 queue state）
    this.deps.storage.upsertDownload({
      id: item.id,
      kind: item.kind,
      state: 'queued',
      total_bytes: task.totalBytes,
      downloaded_bytes: 0,
      speed_bps: 0,
      started_at: task.startedAt,
      target_path: task.targetPath,
      url: task.url,
      mirror_index: 0,
    });
    this.emitUpdate();
    // 尝试启动一个任务
    this.maybeRunNext();
  }

  pause(id: string): void {
    const t = this.tasks.get(id);
    if (!t || t.status === 'paused' || t.status === 'done' || t.status === 'failed') return;
    // 下载中的任务会在下次 chunk 后检查 status。这里直接切换状态。
    t.status = 'paused';
    this.emitUpdate();
  }

  resume(id: string): void {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'paused') return;
    t.status = 'queued';
    this.emitUpdate();
    this.maybeRunNext();
  }

  cancel(id: string): void {
    const t = this.tasks.get(id);
    if (!t) return;
    t.cancelRequested = true;
    if (t.status === 'downloading') {
      // 通过设置状态间接让 runLoop 下次 break
      t.status = 'paused';
    }
    try { fs.unlinkSync(t.tmpPath); } catch {}
    this.tasks.delete(id);
    this.deps.storage.deleteDownload(id);
    this.emitUpdate();
  }

  getStates(): DownloadState[] {
    return Array.from(this.tasks.values()).map((t) => ({
      id: t.item.id,
      kind: t.kind,
      state: t.status,
      total_bytes: t.totalBytes,
      downloaded_bytes: t.downloadedBytes,
      speed_bps: this.computeSpeed(t),
      error: t.error,
    }));
  }

  private emitUpdate(): void {
    this.deps.onUpdate(this.getStates());
  }

  private computeSpeed(t: Task): number {
    const now = Date.now();
    // 10 秒滑动窗口
    while (t.speedSamples.length && now - t.speedSamples[0].t > 10_000) {
      t.speedSamples.shift();
    }
    const windowStart = t.speedSamples[0]?.t ?? now;
    const totalInWindow = t.speedSamples.reduce((s, v) => s + v.bytes, 0);
    const elapsedSec = Math.max(1, (now - windowStart) / 1000);
    return Math.floor(totalInWindow / elapsedSec);
  }

  private maybeRunNext(): void {
    if (this.activeId) return;
    // 取第一个 queued 任务
    let next: Task | null = null;
    for (const t of this.tasks.values()) {
      if (t.status === 'queued') { next = t; break; }
    }
    if (!next) return;
    this.activeId = next.item.id;
    next.status = 'downloading';
    this.emitUpdate();
    this.runTask(next).catch((err) => {
      console.error('[downloader] task failed', next?.item.id, err);
    });
  }

  private async runTask(t: Task): Promise<void> {
    try {
      // 1. 已下载部分则从断点续传
      if (fs.existsSync(t.tmpPath)) {
        const stat = fs.statSync(t.tmpPath);
        t.downloadedBytes = stat.size;
        t.resumeFrom = stat.size;
      } else {
        t.downloadedBytes = 0;
        t.resumeFrom = 0;
      }

      // 2. 为已下载字节算 hash（resume 场景）
      if (t.downloadedBytes > 0) {
        const fd = fs.openSync(t.tmpPath, 'r');
        const buf = Buffer.alloc(64 * 1024);
        let read = 0;
        while (read < t.downloadedBytes) {
          const n = fs.readSync(fd, buf, 0, Math.min(buf.length, t.downloadedBytes - read), read);
          if (n <= 0) break;
          t.hash.update(buf.subarray(0, n));
          read += n;
        }
        fs.closeSync(fd);
      }

      const needsUnzip = !!t.item.download.needsUnzip;

      // 3. 拉文件（支持自动切换 mirrors）
      let attempt = 0;
      let succeed = false;
      const urls = [t.url, ...t.mirrors];
      while (attempt < urls.length && !succeed) {
        const url = urls[attempt];
        t.mirrorIndex = attempt;
        try {
          await this.fetchHttp(t, url, needsUnzip);
          succeed = true;
        } catch (err: any) {
          console.warn('[downloader] url failed', url, err?.message || err);
          attempt += 1;
          // 失败且还有 mirror：尝试下一个
          if (attempt < urls.length) continue;
          throw err;
        }
      }

      // 4. 校验 sha256
      const sha = t.hash.digest('hex');
      if (t.item.download.sha256 && sha !== t.item.download.sha256) {
        throw new Error(`sha256 mismatch: expected ${t.item.download.sha256}, got ${sha}`);
      }

      // 5. （zip 情况）解压到 targetPath
      if (needsUnzip) {
        t.status = 'extracting';
        this.emitUpdate();
        await unzipTo(t.tmpPath, t.targetPath);
        try { fs.unlinkSync(t.tmpPath); } catch {}
      } else {
        // 直接重命名
        fs.renameSync(t.tmpPath, t.targetPath);
      }

      // 6. 成功：写注册表 + 状态 done
      this.deps.storage.insertLocalItem({
        id: t.item.id,
        version: t.item.version,
        kind: t.kind,
        name: (t.item.name && (t.item.name as any)['zh-CN']) || t.item.id,
        install_path: t.targetPath,
        size_bytes: t.totalBytes,
        sha256: sha,
        is_current: 0,
        downloaded_at: Date.now(),
        is_manual_import: 0,
      });

      t.status = 'done';
      this.emitUpdate();
    } catch (err: any) {
      t.status = 'failed';
      t.error = err?.message || String(err);
      this.emitUpdate();
    } finally {
      this.activeId = null;
      // 尝试下一个
      this.maybeRunNext();
    }
  }

  private async fetchHttp(t: Task, url: string, _needsUnzip: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const isHttps = url.startsWith('https:');
      const client = isHttps ? https : http;
      const parsed = new URL(url);
      const opts: any = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers: t.resumeFrom > 0 ? { Range: `bytes=${t.resumeFrom}-` } : {},
        timeout: 30_000,
      };

      const req = client.get(opts, (res) => {
        // 200 OK / 206 Partial Content
        if (!res.statusCode || (res.statusCode !== 200 && res.statusCode !== 206)) {
          const err = new Error(`HTTP ${res.statusCode}`);
          res.resume();
          reject(err);
          return;
        }
        if (res.statusCode === 200 && t.downloadedBytes > 0) {
          // 服务器不支持 range，从 0 开始
          t.downloadedBytes = 0;
          t.resumeFrom = 0;
          t.hash = crypto.createHash('sha256');
          try { fs.truncateSync(t.tmpPath, 0); } catch {}
        }

        // 取 content-length 更新 totalBytes（只在 size_bytes 为 0 时覆盖）
        if (!t.totalBytes && res.headers['content-length']) {
          const cl = parseInt(res.headers['content-length'] as string, 10);
          if (!Number.isNaN(cl)) t.totalBytes = cl + t.downloadedBytes;
        }

        const file = fs.createWriteStream(t.tmpPath, {
          flags: t.downloadedBytes > 0 ? 'r+' : 'w',
          start: t.downloadedBytes,
        });

        let startedChunkAt = Date.now();
        let chunkWindowBytes = 0;

        res.on('data', (chunk: Buffer) => {
          if (t.status !== 'downloading') {
            // 用户暂停 / 取消 → 停止写盘
            res.destroy();
            return;
          }
          t.downloadedBytes += chunk.length;
          t.hash.update(chunk);
          file.write(chunk);

          chunkWindowBytes += chunk.length;
          const now = Date.now();
          if (now - startedChunkAt > 500) {
            t.speedSamples.push({ t: now, bytes: chunkWindowBytes });
            chunkWindowBytes = 0;
            startedChunkAt = now;
            this.emitUpdate();
          }
        });

        res.on('end', () => {
          file.end(() => {
            if (t.status === 'downloading') resolve();
            else reject(new Error('task cancelled or paused during transfer'));
          });
        });
        res.on('error', (e) => {
          try { file.destroy(); } catch {}
          reject(e);
        });
        file.on('error', (e) => {
          res.destroy();
          reject(e);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('timeout'));
      });
      req.end();
    });
  }
}

// -------- 简易 zip 解压：用 node:zlib 逐 entry 解 --------
// 不依赖第三方库，避免 native 模块安装失败。
// 支持：deflate / stored。其他方法（bzip2, lzma 等）跳过。
async function unzipTo(zipFile: string, targetDir: string): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const buf = fs.readFileSync(zipFile);

  // ZIP 格式解析：扫描 local file header 签名 0x04034b50
  let offset = 0;
  while (offset < buf.length - 30) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const compression = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const uncompressedSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buf.slice(dataStart, dataStart + compressedSize);

    const outPath = path.join(targetDir, name);
    if (name.endsWith('/')) {
      await fs.promises.mkdir(outPath, { recursive: true });
    } else {
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      let decompressed: Buffer;
      if (compression === 0) {
        decompressed = compressed;
      } else if (compression === 8) {
        decompressed = zlib.inflateRawSync(compressed, { chunkSize: 128 * 1024 });
      } else {
        throw new Error(`unsupported compression method: ${compression}`);
      }
      await fs.promises.writeFile(outPath, decompressed);
    }
    offset = dataStart + compressedSize;
  }
}
