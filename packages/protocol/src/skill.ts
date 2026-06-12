// 技能市场模块类型定义

import type { ItemKind } from './capability-market';

/** 三类 executor */
export type SkillRuntime = 'http-proxy' | 'node-script' | 'json-config';

/** 工具定义（agent-runtime 用来构建 system prompt 的 tool 描述） */
export interface SkillTool {
  name: string;
  description: { 'zh-CN': string; 'en-US': string; [k: string]: string };
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** 已安装技能（安装到 userData/skills/<id>/<version>/） */
export interface InstalledSkill {
  id: string;
  version: string;
  kind: ItemKind;
  name: { 'zh-CN': string; 'en-US': string; [k: string]: string } | string;
  runtime: SkillRuntime;
  install_path: string;
  tools: SkillTool[];
  permissions: {
    network?: string[];
    fs?: string[];
    child_process?: string[];
  };
  enabled: number;
  installed_at: number;
  manifest_sha256?: string;
}

/** 主进程 → 渲染侧暴露的 SkillManager API */
export interface SkillAPI {
  listEnabled(): Promise<InstalledSkill[]>;
  listAll(): Promise<InstalledSkill[]>;
  enable(id: string, version: string): Promise<void>;
  disable(id: string, version: string): Promise<void>;
  uninstall(id: string, version: string): Promise<void>;
  invoke(id: string, version: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** 调用结果（供 agent-runtime 使用） */
export interface InvokeResult {
  skillId: string;
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** skill.json manifest（磁盘文件结构） */
export interface SkillManifest {
  id: string;
  version: string;
  name: { 'zh-CN': string; 'en-US': string; [k: string]: string };
  description: { 'zh-CN': string; 'en-US': string; [k: string]: string };
  runtime: SkillRuntime;
  permissions?: InstalledSkill['permissions'];
  tools: SkillTool[];
  /** 可选：自带的少量 i18n 字符串 */
  i18n?: Record<string, Record<string, string>>;
}
