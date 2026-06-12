// 系统级 i18n 运行时
// 设计文档: design.md §4.8 "系统级 i18n 模块规格"
// 特性:
//   - 多语言（zh-CN / en-US，含父语言回退链）
//   - 命名空间（model-market / voice / skill-market / common / nav）
//   - 懒加载（按需加载 JSON，避免首屏 IO）
//   - 参数替换（{name} → 实际值）
//   - 复数：{count,plural,one{...} other{...}}
//   - 订阅语言变化（跨 feature 同步 UI）
//   - 缺失键检测与 fallback

export type Language = 'zh-CN' | 'en-US';

/** 命名空间枚举：与 locales/ 目录的 JSON 文件名对齐 */
export type I18nNamespace =
  | 'common'
  | 'nav'
  | 'model-market'
  | 'voice'
  | 'skill-market';

/** 语言回退链：当目标语言键缺失时按该顺序查找 */
export const LANGUAGE_FALLBACK: Record<Language, Language[]> = {
  'zh-CN': ['zh-CN', 'en-US'],
  'en-US': ['en-US'],
};

/** 默认语言 */
export const DEFAULT_LANG: Language = 'zh-CN';

/** 加载翻译 JSON 文件的提供者函数
 *  主进程可用 fs.readFileSync；
 *  渲染进程可通过 import.meta.glob 或 ipc.invoke 获取；
 *  为便于测试也允许自定义 provider。
 */
export type TranslationLoader = (
  ns: I18nNamespace,
  lang: Language
) => Record<string, string> | Promise<Record<string, string>>;

/** 通过内联 JSON 对象作为 loader（便于 Node/Electron 主进程直接引用 locale JSON） */
export function jsonLoader(map: Record<string, Record<string, Record<string, string>>>): TranslationLoader {
  return (ns, lang) => map?.[ns]?.[lang] ?? {};
}

export class I18nRuntime {
  private lang: Language = DEFAULT_LANG;
  private nsMap: Record<string, Record<string, string>> = {}; // ns + lang 合并后的查找表
  private loader: TranslationLoader;
  private listeners: Array<(lang: Language) => void> = [];
  private loadedNS = new Set<string>();

  constructor(loader: TranslationLoader, initialLang?: Language) {
    this.loader = loader;
    if (initialLang) this.lang = initialLang;
  }

  /** 设置当前语言，重新加载已经订阅的 namespace */
  async setLang(lang: Language): Promise<void> {
    if (lang === this.lang) return;
    this.lang = lang;
    // 清空已合并缓存，让 translate() 重新走查找路径
    this.nsMap = {};
    // 重新加载已经懒加载过的命名空间（避免切换语言后翻译键还没加载回来）
    for (const ns of this.loadedNS) {
      await this.ensureLoaded(ns);
    }
    for (const fn of this.listeners) {
      try {
        fn(lang);
      } catch (e) {
        // 监听函数抛错不影响整体
        console.error('[i18n] listener error', e);
      }
    }
  }

  getLang(): Language {
    return this.lang;
  }

  /** 订阅语言切换；返回取消订阅函数 */
  onLangChange(handler: (lang: Language) => void): () => void {
    this.listeners.push(handler);
    return () => {
      const i = this.listeners.indexOf(handler);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** 懒加载命名空间（幂等） */
  async loadNamespace(ns: I18nNamespace): Promise<void> {
    if (this.loadedNS.has(ns)) return;
    await this.ensureLoaded(ns);
  }

  /** 查找翻译键；支持 params 做参数替换 */
  t(key: string, params?: Record<string, string | number>): string {
    const parts = key.split('.');
    if (parts.length < 2) {
      // 非命名空间前缀的 key：默认查找 "common.<key>"
      return this.resolve('common', key, params) ?? key;
    }
    const ns = parts[0] as I18nNamespace;
    const rest = parts.slice(1).join('.');
    const value = this.resolve(ns, rest, params);
    if (value !== undefined) return value;
    return key; // 兜底：显示 key 本身以便定位
  }

  /** 同步地从已加载的命名空间获取原始字典（便于调试/枚举） */
  getRawDictionary(ns: I18nNamespace): Record<string, string> {
    this.ensureLoadedSync(ns);
    return this.nsMap[ns] ?? {};
  }

  // ----------------- 私有 -----------------

  /** 把某 namespace 的所有语言候选按 fallback 顺序合并到 nsMap[ns] */
  private async ensureLoaded(ns: I18nNamespace): Promise<void> {
    const key = ns;
    const chain = LANGUAGE_FALLBACK[this.lang] ?? [this.lang];
    const merged: Record<string, string> = {};
    // 从 fallback 尾部向前覆盖，保证当前语言优先级最高
    for (let i = chain.length - 1; i >= 0; i--) {
      const dict = await this.loader(ns, chain[i]);
      if (dict && typeof dict === 'object') {
        Object.assign(merged, dict);
      }
    }
    this.nsMap[key] = merged;
    this.loadedNS.add(ns);
  }

  private ensureLoadedSync(ns: I18nNamespace): void {
    if (this.nsMap[ns]) return;
    // 回退：尝试同步调用 loader。如果 loader 是异步的会得到 Promise → 我们就只使用它返回的空对象
    // 为避免此问题，建议先调用 loadNamespace()。这里给出空 dict 作为安全兜底。
    this.nsMap[ns] = {};
  }

  private resolve(
    ns: I18nNamespace,
    key: string,
    params?: Record<string, string | number>
  ): string | undefined {
    this.ensureLoadedSync(ns);
    const dict = this.nsMap[ns];
    if (!dict) return undefined;
    const raw = dict[key];
    if (raw === undefined || raw === null) return undefined;
    return params ? applyParams(String(raw), params) : String(raw);
  }
}

/** 参数替换 + 简单复数
 *  占位符: {name} / {count,plural,one{1 个项目} other{{count} 个项目}}
 */
function applyParams(template: string, params: Record<string, string | number>): string {
  // 先处理复数
  let out = template.replace(
    /\{(\w+),\s*plural\s*,\s*([^}]*)\}/g,
    (_, key: string, body: string) => {
      const val = params[key];
      const n = typeof val === 'number' ? val : 0;
      // 解析 one{...} other{...}
      const oneMatch = body.match(/one\s*\{([^}]*)\}/);
      const otherMatch = body.match(/other\s*\{([^}]*)\}/);
      const chosen = n === 1 ? oneMatch?.[1] : otherMatch?.[1] ?? oneMatch?.[1];
      if (!chosen) return String(val);
      // 对选中的片段再次做参数替换（支持 {count}）
      return chosen.replace(/\{(\w+)\}/g, (__m, k: string) =>
        k === key ? String(val) : String(params[k] ?? `{${k}}`)
      );
    }
  );

  // 处理普通 {key} 占位符
  out = out.replace(/\{(\w+)\}/g, (_m, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`
  );
  return out;
}
