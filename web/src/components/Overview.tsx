'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtNum } from '@/lib/api';

type PoolCounts = { total: number; eligible: number; rejected: number; byProtocol: { v2: number; v3: number; v4: number } };
type SourceHealth = { source_id: string; last_error: string | null; last_success_at: string | null };

export default function Overview() {
  const [counts, setCounts] = useState<PoolCounts | null>(null);
  const [block, setBlock] = useState<number>(0);
  const [health, setHealth] = useState<SourceHealth[]>([]);
  const [positions, setPositions] = useState<number>(0);

  useEffect(() => {
    async function load() {
      try {
        const [c, b, h] = await Promise.all([
          apiGet<PoolCounts>('/pools/counts'),
          apiGet<{ latestStoredBlock: number }>('/blocks/latest'),
          apiGet<{ sources: SourceHealth[] }>('/health'),
        ]);
        setCounts(c);
        setBlock(b.latestStoredBlock);
        setHealth(h.sources);
      } catch {}
      try {
        const p = await apiGet<{ positions: any[] }>('/positions');
        setPositions(p.positions?.length || 0);
      } catch {}
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  const okSources = health.filter(s => !s.last_error).length;

  return (
    <>
      {/* Stats row */}
      <div className="stats-grid">
        <StatCard label="Total Pools" value={fmtNum(counts?.total ?? 0)} sub={`${counts?.byProtocol?.v3 ?? 0} v3 · ${counts?.byProtocol?.v4 ?? 0} v4 · ${counts?.byProtocol?.v2 ?? 0} v2`} />
        <StatCard label="Active" value={fmtNum(counts?.eligible ?? 0)} color="var(--positive)" sub="Eligible for LP" />
        <StatCard label="Block" value={block ? fmtNum(block) : '--'} sub="Latest indexed" />
        <StatCard label="Health" value={`${okSources}/${health.length}`} color={okSources === health.length ? 'var(--positive)' : 'var(--negative)'} sub="Data sources online" />
        <StatCard label="Positions" value={fmtNum(positions)} sub="Paper positions" />
      </div>

      {/* Source health */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-label">Data Source Health</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          {health.length === 0 && <div className="skeleton" style={{ width: 200, height: 20 }} />}
          {health.map(s => {
            const ok = !s.last_error && s.last_success_at;
            return (
              <div key={s.source_id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: ok ? 'var(--positive)' : s.last_error ? 'var(--negative)' : 'var(--text-muted)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                {s.source_id}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent activity / quick links */}
      <div className="pools-grid">
        <div className="card">
          <div className="card-label">Latest Block Activity</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            {block > 0 ? (
              <>Indexer running · Block #{fmtNum(block)}</>
            ) : (
              <span className="skeleton" style={{ width: 180, height: 16, display: 'inline-block' }} />
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Network</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            Robinhood Chain · Chain ID: 4663
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}
