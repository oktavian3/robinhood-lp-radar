'use client';
import { useState, useEffect } from 'react';
import { apiGet } from '@/lib/api';
import type { TrackRecord } from '@/types';

export default function TrackRecordPage() {
  const [rec, setRec] = useState<TrackRecord | null>(null);
  useEffect(() => {
    async function load() {
      try { const d = await apiGet<{ record: TrackRecord }>('/track-record'); setRec(d.record); } catch (e) { console.error(e); }
    }
    load(); const iv = setInterval(load, 30000); return () => clearInterval(iv);
  }, []);

  if (!rec) return <div className="card"><h3>Track Record</h3><div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>No data yet</div></div>;

  return (
    <>
      <div className="grid grid-5">
        <div className="card"><h3>Recommendations</h3><div className="value">{rec.totalRecommendations || 0}</div></div>
        <div className="card"><h3>Win Rate</h3><div className="value" style={{ color: 'var(--green)' }}>{(rec.winRate ? Math.round(rec.winRate * 100) : 0)}%</div></div>
        <div className="card"><h3>Avg Fee</h3><div className="value">${rec.avgFee?.toFixed(2) || '0.00'}</div></div>
        <div className="card"><h3>Avg IL</h3><div className="value" style={{ color: 'var(--red)' }}>${rec.avgIl?.toFixed(2) || '0.00'}</div></div>
        <div className="card"><h3>Avg Net</h3><div className="value">${rec.avgNet?.toFixed(2) || '0.00'}</div></div>
      </div>
      {rec.performanceByStrategy && Object.keys(rec.performanceByStrategy).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Performance by Strategy</h3>
          {Object.entries(rec.performanceByStrategy).map(([k, v]) => (
            <div key={k} style={{ padding: '4px 0', fontSize: 12 }}>{k}: {v.count} positions · win {v.wins}/{v.count} · net ${v.net.toFixed(2)}</div>
          ))}
        </div>
      )}
    </>
  );
}
