import React, { useEffect, useState } from 'react';

interface LocalModel { id: string; kind: string; name: string; install_path: string; size_bytes?: number; }
interface SkillTool { name: string; description: string; endpoint: string; method?: string; input_schema?: any; response_path?: string; }
interface SkillInfo { id: string; version: string; name: string; description: string; runtime: string; install_path: string; tools: SkillTool[]; permissions: any; enabled: boolean; }

export default function InstalledPage() {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [invoking, setInvoking] = useState<string | null>(null);

  useEffect(() => {
    window.hedgehog?.capabilityMarket?.listLocalItems?.({ kind: 'llm' }).then(setModels);
    window.hedgehog?.skill?.listAll?.().then(setSkills);
  }, []);

  const refresh = () => {
    window.hedgehog?.capabilityMarket?.listLocalItems?.({ kind: 'llm' }).then(setModels);
    window.hedgehog?.skill?.listAll?.().then(setSkills);
  };

  const toggleSkill = (s: SkillInfo) => {
    if (s.enabled) window.hedgehog.skill.disable(s.id, s.version);
    else window.hedgehog.skill.enable(s.id, s.version);
    refresh();
  };

  const uninstallSkill = (s: SkillInfo) => {
    if (!confirm(`确认卸载技能 ${s.name}?`)) return;
    window.hedgehog.skill.uninstall(s.id, s.version).then(refresh);
  };

  const handleLoad = (m: LocalModel) => {
    window.hedgehog.llm.load(m.id, m.install_path, { contextSize: 4096, threads: 4, gpuLayers: 0 })
      .then((res: any) => {
        if (res?.ok) alert('模型已加载');
        else alert('加载失败: ' + (res?.error || 'unknown'));
      });
  };

  const invokeSample = async (skill: SkillInfo) => {
    const tool = skill.tools[0];
    if (!tool) return;
    setInvoking(`${skill.id}:${tool.name}`);
    setInvokeResult(null);
    // 简单填充示例参数：如果 schema required 中有字段，先让用户用 prompt 填
    const args: any = {};
    const required = tool.input_schema?.required || [];
    if (required.length > 0) {
      for (const r of required) {
        const v = prompt(`请输入参数 "${r}" (技能:${skill.name} / 工具:${tool.name})`);
        if (!v) { setInvoking(null); return; }
        args[r] = v;
      }
    }
    const res: any = await window.hedgehog.skill.invoke(skill.id, skill.version, tool.name, args);
    setInvokeResult(JSON.stringify(res, null, 2));
    setInvoking(null);
  };

  return (
    <div>
      <h2 style={{ margin: '8px 0' }}>本地模型</h2>
      {models.length === 0 && <div style={{ color: '#6b7280' }}>还没有本地模型。请去"能力市场"下载，或通过下面按钮导入。</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {models.map(m => (
          <div key={m.id} style={card()}>
            <div style={{ fontWeight: 600 }}>{m.name}</div>
            <div style={{ color: '#6b7280', fontSize: 12, margin: '4px 0 8px' }}>{m.install_path}</div>
            <button style={btn('#1d4ed8', '#fff')} onClick={() => handleLoad(m)}>加载</button>{' '}
            <button style={btn('#fff', '#111827')} onClick={() => window.hedgehog.shell.openPath(m.install_path)}>所在目录</button>{' '}
            <button style={btn('#fff', '#ef4444')} onClick={() => {
              if (confirm('确认删除？')) {
                window.hedgehog.capabilityMarket.deleteLocalItem(m.kind, m.id, m.version).then(refresh);
              }
            }}>删除</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
        <h2 style={{ margin: '8px 0' }}>已安装技能</h2>
      </div>
      {skills.length === 0 && <div style={{ color: '#6b7280' }}>暂无已安装技能。请去"能力市场"下载一个技能，或把包含 skill.json 的目录放到应用数据目录下的 skills/ 文件夹。</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {skills.map(s => (
          <div key={`${s.id}-${s.version}`} style={card()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600 }}>{s.name} <span style={{ color: '#6b7280', fontSize: 12 }}>@{s.version}</span></div>
              <span style={{ color: s.enabled ? '#10b981' : '#6b7280', fontSize: 12 }}>{s.enabled ? '已启用' : '已禁用'}</span>
            </div>
            <div style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>{s.description}</div>
            <div style={{ margin: '4px 0', fontSize: 12, color: '#374151' }}>运行方式：{s.runtime}</div>
            {s.tools?.length > 0 && (
              <div style={{ margin: '6px 0', fontSize: 12 }}>
                <b>工具：</b>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {s.tools.map(t => <li key={t.name}>{t.name} — {t.description}</li>)}
                </ul>
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <button style={btn('#1d4ed8', '#fff')} onClick={() => invokeSample(s)} disabled={!!invoking}>
                {invoking === `${s.id}:${s.tools[0]?.name}` ? '调用中…' : '测试调用'}
              </button>{' '}
              <button style={btn('#fff', '#111827')} onClick={() => toggleSkill(s)}>{s.enabled ? '禁用' : '启用'}</button>{' '}
              <button style={btn('#fff', '#ef4444')} onClick={() => uninstallSkill(s)}>卸载</button>
            </div>
          </div>
        ))}
      </div>

      {invokeResult && (
        <div style={{ marginTop: 16, background: '#f9fafb', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>调用结果：</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{invokeResult}</pre>
        </div>
      )}
    </div>
  );
}

function card(): React.CSSProperties {
  return { background: '#fff', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb' };
}
function btn(bg: string, color: string): React.CSSProperties {
  return { padding: '6px 12px', borderRadius: 6, cursor: 'pointer', background: bg, color, border: '1px solid #d0d7de' };
}
