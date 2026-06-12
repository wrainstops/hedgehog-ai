// 存储层封装：SQLite 四张表（local_items / downloads / settings / installed_skills）
// 由 Electron 主进程初始化，渲染进程通过 IPC 访问

import Database from 'better-sqlite3';
import type {
  ItemKind,
  DownloadState,
  DownloadStateStatus,
  LocalItem,
} from '@hedgehog/protocol';

export interface StorageOptions {
  /** SQLite 数据库文件路径 */
  dbPath: string;
}

interface DownloadRow {
  id: string;
  kind: ItemKind;
  state: DownloadStateStatus;
  total_bytes: number;
  downloaded_bytes: number;
  speed_bps: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  target_path: string;
  url: string;
  mirror_index: number;
}

export class Storage {
  private db: Database.Database;

  constructor(opts: StorageOptions) {
    this.db = new Database(opts.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables(): void {
    const db = this.db;

    // 本地已安装能力注册表（LLM / ASR / TTS / Skill 统一）
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_items (
        id TEXT NOT NULL,
        version TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        size_bytes INTEGER,
        install_path TEXT NOT NULL,
        sha256 TEXT,
        downloaded_at INTEGER,
        is_current INTEGER DEFAULT 0,
        is_manual_import INTEGER DEFAULT 0,
        PRIMARY KEY (id, version, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_local_items_kind ON local_items(kind);
    `);

    // 下载进度表（断点续传核心数据源）
    db.exec(`
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        total_bytes INTEGER NOT NULL,
        downloaded_bytes INTEGER DEFAULT 0,
        speed_bps INTEGER DEFAULT 0,
        started_at INTEGER,
        finished_at INTEGER,
        error TEXT,
        target_path TEXT NOT NULL,
        url TEXT NOT NULL,
        mirror_index INTEGER DEFAULT 0
      );
    `);

    // 技能注册表（更细粒度，含 enabled / permissions / manifest_sha256）
    db.exec(`
      CREATE TABLE IF NOT EXISTS installed_skills (
        id TEXT NOT NULL,
        version TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'skill',
        install_path TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        installed_at INTEGER,
        manifest_sha256 TEXT,
        permissions TEXT,
        PRIMARY KEY (id, version)
      );
    `);

    // 通用设置
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  getRaw(): Database.Database {
    return this.db;
  }

  // ----------------- settings -----------------

  getSetting(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  // ----------------- local_items -----------------

  insertLocalItem(item: LocalItem): void {
    this.db
      .prepare(
        `INSERT INTO local_items (id, version, kind, name, size_bytes, install_path, sha256, downloaded_at, is_current, is_manual_import)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id, version, kind) DO UPDATE SET
           name = excluded.name,
           size_bytes = excluded.size_bytes,
           install_path = excluded.install_path,
           sha256 = excluded.sha256,
           downloaded_at = excluded.downloaded_at,
           is_current = excluded.is_current,
           is_manual_import = excluded.is_manual_import`
      )
      .run(
        item.id,
        item.version,
        item.kind,
        item.name,
        item.size_bytes ?? null,
        item.install_path,
        item.sha256 ?? null,
        item.downloaded_at,
        item.is_current,
        item.is_manual_import
      );
  }

  listLocalItems(kind?: ItemKind): LocalItem[] {
    const rows = kind
      ? (this.db
          .prepare('SELECT * FROM local_items WHERE kind = ? ORDER BY downloaded_at DESC')
          .all(kind) as LocalItem[])
      : (this.db
          .prepare('SELECT * FROM local_items ORDER BY kind, downloaded_at DESC')
          .all() as LocalItem[]);
    return rows;
  }

  deleteLocalItem(kind: ItemKind, id: string, version: string): void {
    this.db
      .prepare('DELETE FROM local_items WHERE kind = ? AND id = ? AND version = ?')
      .run(kind, id, version);
  }

  /**
   * 把某个 item 设为该 kind 下的 "当前使用项"
   * 同 kind 其他项 is_current 置 0
   */
  setCurrentItem(kind: ItemKind, id: string, version: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE local_items SET is_current = 0 WHERE kind = ?').run(kind);
      this.db
        .prepare(
          'UPDATE local_items SET is_current = 1 WHERE kind = ? AND id = ? AND version = ?'
        )
        .run(kind, id, version);
    });
    tx();
  }

  getCurrentItem(kind: ItemKind): LocalItem | null {
    const row = this.db
      .prepare('SELECT * FROM local_items WHERE kind = ? AND is_current = 1 LIMIT 1')
      .get(kind) as LocalItem | undefined;
    return row ?? null;
  }

  // ----------------- downloads -----------------

  upsertDownload(download: {
    id: string;
    kind: ItemKind;
    state: DownloadStateStatus;
    total_bytes: number;
    downloaded_bytes: number;
    speed_bps: number;
    started_at?: number;
    finished_at?: number;
    error?: string | null;
    target_path: string;
    url: string;
    mirror_index?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO downloads (id, kind, state, total_bytes, downloaded_bytes, speed_bps, started_at, finished_at, error, target_path, url, mirror_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           total_bytes = excluded.total_bytes,
           downloaded_bytes = excluded.downloaded_bytes,
           speed_bps = excluded.speed_bps,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           error = excluded.error,
           target_path = excluded.target_path,
           url = excluded.url,
           mirror_index = excluded.mirror_index`
      )
      .run(
        download.id,
        download.kind,
        download.state,
        download.total_bytes,
        download.downloaded_bytes,
        download.speed_bps,
        download.started_at ?? null,
        download.finished_at ?? null,
        download.error ?? null,
        download.target_path,
        download.url,
        download.mirror_index ?? 0
      );
  }

  updateDownloadProgress(id: string, downloaded_bytes: number, speed_bps: number): void {
    this.db
      .prepare('UPDATE downloads SET downloaded_bytes = ?, speed_bps = ? WHERE id = ?')
      .run(downloaded_bytes, speed_bps, id);
  }

  updateDownloadState(id: string, state: DownloadStateStatus, error?: string | null): void {
    const now = state === 'done' ? Date.now() : undefined;
    if (now) {
      this.db
        .prepare(
          'UPDATE downloads SET state = ?, error = ?, finished_at = ? WHERE id = ?'
        )
        .run(state, error ?? null, now, id);
    } else {
      this.db
        .prepare('UPDATE downloads SET state = ?, error = ? WHERE id = ?')
        .run(state, error ?? null, id);
    }
  }

  listDownloads(): DownloadState[] {
    const rows = this.db.prepare('SELECT * FROM downloads ORDER BY started_at DESC').all() as DownloadRow[];
    return rows.map(r => ({
      id: r.id,
      kind: r.kind,
      state: r.state,
      total_bytes: r.total_bytes,
      downloaded_bytes: r.downloaded_bytes,
      speed_bps: r.speed_bps,
      error: r.error ?? undefined,
    }));
  }

  getDownload(id: string): DownloadState | null {
    const row = this.db
      .prepare('SELECT * FROM downloads WHERE id = ?')
      .get(id) as DownloadRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      total_bytes: row.total_bytes,
      downloaded_bytes: row.downloaded_bytes,
      speed_bps: row.speed_bps,
      error: row.error ?? undefined,
    };
  }

  deleteDownload(id: string): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
  }

  // ----------------- installed_skills -----------------

  insertInstalledSkill(opts: {
    id: string;
    version: string;
    install_path: string;
    manifest_sha256?: string;
    permissions?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO installed_skills (id, version, kind, install_path, enabled, installed_at, manifest_sha256, permissions)
         VALUES (?, ?, 'skill', ?, 1, ?, ?, ?)
         ON CONFLICT(id, version) DO UPDATE SET
           install_path = excluded.install_path,
           manifest_sha256 = excluded.manifest_sha256,
           permissions = excluded.permissions`
      )
      .run(
        opts.id,
        opts.version,
        opts.install_path,
        Date.now(),
        opts.manifest_sha256 ?? null,
        opts.permissions ? JSON.stringify(opts.permissions) : null
      );
  }

  setSkillEnabled(id: string, version: string, enabled: number): void {
    this.db
      .prepare('UPDATE installed_skills SET enabled = ? WHERE id = ? AND version = ?')
      .run(enabled, id, version);
  }

  listInstalledSkills(): Array<{
    id: string;
    version: string;
    install_path: string;
    enabled: number;
    installed_at: number;
    manifest_sha256: string | null;
    permissions: string | null;
  }> {
    return this.db
      .prepare('SELECT * FROM installed_skills ORDER BY installed_at DESC')
      .all() as Array<{
      id: string;
      version: string;
      install_path: string;
      enabled: number;
      installed_at: number;
      manifest_sha256: string | null;
      permissions: string | null;
    }>;
  }

  deleteInstalledSkill(id: string, version: string): void {
    this.db
      .prepare('DELETE FROM installed_skills WHERE id = ? AND version = ?')
      .run(id, version);
  }
}
