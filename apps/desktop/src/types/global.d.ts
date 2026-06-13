// Electron preload 暴露的 API 类型声明

declare global {
  interface Window {
    hedgehog?: {
      // 能力市场
      capabilityMarket: {
        getCatalog: (opts?: { kind?: string }) => Promise<{
          items: any[];
          updated_at: string;
          source: 'online' | 'cache' | 'fallback';
        }>;
        refreshCatalog: (opts?: { kind?: string }) => Promise<{
          items: any[];
          updated_at: string;
          source: 'online' | 'cache' | 'fallback';
        }>;
        listLocalItems: (opts?: { kind?: string }) => Promise<any[]>;
        setCurrentItem: (kind: string, id: string, version: string) => Promise<boolean>;
        deleteLocalItem: (kind: string, id: string, version: string) => Promise<boolean>;
        startDownload: (id: string) => Promise<boolean>;
        pauseDownload: (id: string) => Promise<boolean>;
        resumeDownload: (id: string) => Promise<boolean>;
        cancelDownload: (id: string) => Promise<boolean>;
        onDownloadProgress: (callback: (downloads: any[]) => void) => () => void;
      };

      // LLM 推理
      llm: {
        getState: () => Promise<{
          loaded: boolean;
          modelId?: string;
          modelPath?: string;
        }>;
        load: (id: string, installPath: string, opts?: {
          contextSize?: number;
          threads?: number;
          gpuLayers?: number;
        }) => Promise<boolean>;
        unload: () => Promise<boolean>;
        generate: (messages: Array<{
          role: 'system' | 'user' | 'assistant';
          content: string;
        }>, opts?: {
          maxTokens?: number;
          temperature?: number;
          topP?: number;
        }) => Promise<{
          text: string;
          tokensPerSecond?: number;
        }>;
        stop: () => Promise<boolean>;
        onToken: (callback: (text: string) => void) => () => void;
      };

      // 技能运行时
      skill: {
        listAll: () => Promise<any[]>;
        listEnabled: () => Promise<any[]>;
        enable: (id: string, version: string) => Promise<boolean>;
        disable: (id: string, version: string) => Promise<boolean>;
        uninstall: (id: string, version: string) => Promise<boolean>;
        invoke: (id: string, version: string, toolName: string, args: any) => Promise<{
          ok: boolean;
          data?: any;
          error?: string;
        }>;
      };

      // 文件系统
      shell: {
        openPath: (filePath: string) => Promise<boolean>;
      };

      // i18n
      i18n: {
        getLang: () => Promise<string>;
        setLang: (lang: string) => Promise<boolean>;
        t: (key: string, params?: Record<string, string | number>) => Promise<string>;
        onLangChange: (callback: (lang: string) => void) => () => void;
      };
    };
  }
}

export {};
