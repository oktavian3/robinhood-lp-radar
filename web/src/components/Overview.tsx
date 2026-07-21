'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtAddr, fmtUsd, fmtNum } from '@/lib/api';
import type { PoolCounts, SourceHealth, BlockInfo } from '@/types';

export default function OverviewPage() {
  const [counts, setCounts] = useState<PoolCounts | null>(null);
  const [block, setBlock] = useState<BlockInfo | null>(null);
  const [health, setHealth] = useState<SourceHealth[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const [c, b, h] = await Promise.all([
          apiGet<PoolCounts & { total: number; eligible: number; rejected: number }>('/pools/counts'),
          apiGet<{ latestStoredBlock: number }>('/blocks/latest'),
          apiGet<{ sources: SourceHealth[] }>('/health'),
        ]);
        setCounts(c as any);
        setBlock(b);
        setHealth(h.sources);
      } catch (e) { console.error(e); }
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="grid grid-5">
      <div className="card">
        <h3>Pools</h3>
        <div className="value">{counts?.total ?? '--'}</div>
      </div>
      <div className="card">
        <h3>Active</h3>
        <div className="value" style={{ color: 'var(--green)' }}>{counts?.eligible ?? '--'}</div>
      </div>
      <div className="card">
        <h3>Rejected</h3>
        <div className="value" style={{ color: 'var(--red)' }}>{counts?.rejected ?? '--'}</div>
      </div>
      <div className="card">
        <h3>Block</h3>
        <div className="value">{block ? fmtNum(block.latestStoredBlock) : '--'}</div>
      </div>
      <div className="card">
        <h3>Health</h3>
        <div className="value" style={{ color: 'var(--green)', fontSize: 16 }}>
          {health.filter(s => !s.last_error).length}/{health.length}
        </div>
      </div>
      <div className="card" style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        <h3>Data Source Health</h3>
        <div style={{ fontSize: 12, marginTop: 8 }}>
          {health.map(s => (
            <div key={s.source_id}>
              {s.last_error ? '🔴' : s.last_success_at ? '🟢' : '⚪'} {s.source_id}
              {' '}{s.last_error || 'OK'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
