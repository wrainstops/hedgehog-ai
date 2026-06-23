import React, { useEffect, useState } from 'react';

interface LocalModel { id: string; kind: string; name: string; install_path: string; size_bytes?: number; }

export default function InstalledPage() {
  const [models, setModels] = useState<LocalModel[]>([]);

  useEffect(() => {
    window.hedgehog?.capabilityMarket?.listLocalItems?.({ kind: 'llm' }).then(setModels);
  }, []);

  const refresh = () => {
    window.hedgehog?.capabilityMarket?.listLocalItems?.({ kind: 'llm' }).then(setModels);
  };

  const handleLoad = (m: LocalModel) => {
    window.hedgehog.llm.load(m.id, m.install_path, { contextSize: 4096, threads: 4, gpuLayers: 0 })
      .then((res: any) => {
        if (res?.ok) alert('模型已加载');
        else alert('加载失败: ' + (res?.error || 'unknown'));
      });
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
    </div>
  );
}

function card(): React.CSSProperties {
  return { background: '#fff', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb' };
}
function btn(bg: string, color: string): React.CSSProperties {
  return { padding: '6px 12px', borderRadius: 6, cursor: 'pointer', background: bg, color, border: '1px solid #d0d7de' };
}