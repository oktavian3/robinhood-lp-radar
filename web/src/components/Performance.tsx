'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtUsd } from '@/lib/api';

type TrackRecord = {
  totalRecommendations: number;
  winRate: number | null;
  avgFee: number | null;
  avgIl: number | null;
  avgNet: number | null;
  performanceByStrategy: Record<string, { count: number; wins: number; net: number }> | null;
};

export default function Performance() {
  const [record, setRecord] = useState<TrackRecord | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const d = await apiGet<{ record: TrackRecord }>('/track-record');
        setRecord(d.record);
      } catch {}
    }
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  if (!record) {
    return (
      <div className="card">
        <div className="card-label">Performance</div>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="skeleton" style={{ width: 200, height: 20, margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  const winPct = record.winRate ? Math.round(record.winRate * 100) : 0;
  const strategies = record.performanceByStrategy ? Object.entries(record.performanceByStrategy) : [];

  return (
    <>
      {/* Summary stats */}
      <div className="stats-grid">
        <div className="card">
          <div className="card-label">Recommendations</div>
          <div className="card-value">{record.totalRecommendations || 0}</div>
        </div>
        <div className="card">
          <div className="card-label">Win Rate</div>
          <div className="card-value" style={{ color: winPct > 50 ? 'var(--positive)' : 'var(--negative)' }}>
            {winPct}%
          </div>
        </div>
        <div className="card">
          <div className="card-label">Avg Fee</div>
          <div className="card-value" style={{ color: 'var(--positive)' }}>${fmtUsd(record.avgFee ?? 0)}</div>
        </div>
        <div className="card">
          <div className="card-label">Avg IL</div>
          <div className="card-value" style={{ color: 'var(--negative)' }}>${fmtUsd(record.avgIl ?? 0)}</div>
        </div>
        <div className="card">
          <div className="card-label">Avg Net</div>
          <div className="card-value" style={{ color: (record.avgNet ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
            ${fmtUsd(record.avgNet ?? 0)}
          </div>
        </div>
      </div>

      {/* By strategy */}
      {strategies.length > 0 && (
        <div className="card">
          <div className="card-label">Performance by Strategy</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Strategy</th><th>Count</th><th>Wins</th><th>Win Rate</th><th>Net PnL</th></tr>
              </thead>
              <tbody>
                {strategies.map(([name, data]) => (
                  <tr key={name}>
                    <td style={{ fontWeight: 500 }}>{name.replace(/_/g, ' ')}</td>
                    <td>{data.count}</td>
                    <td>{data.wins}</td>
                    <td>{data.count > 0 ? `${Math.round((data.wins / data.count) * 100)}%` : '--'}</td>
                    <td style={{ color: data.net >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                      ${fmtUsd(data.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
