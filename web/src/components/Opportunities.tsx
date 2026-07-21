'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtUsd } from '@/lib/api';

type RankedPool = {
  poolId: number;
  protocol: string;
  poolAddress: string | null;
  token0: string;
  token1: string;
  fee: number | null;
  score: number;
  confidence: number;
  riskLevel: string;
  volume_24h: number | null;
  tvl_usd: number | null;
  apr_pct: number | null;
  fdv_usd: number | null;
  base_token_symbol: string | null;
  quote_token_symbol: string | null;
  txns_24h: number | null;
};

function aprColor(apr: number | null): string {
  if (!apr || apr < 100) return 'var(--text-muted)';
  if (apr > 1000) return 'var(--lime)';
  if (apr > 500) return 'var(--warning)';
  return 'var(--purple-soft)';
}

function riskTag(level: string) {
  const colors: Record<string, string> = {
    low: 'var(--positive)',
    medium: 'var(--warning)',
    high: 'var(--negative)',
  };
  return <span style={{ color: colors[level] || 'var(--text-muted)', fontSize: 10 }}>{level.toUpperCase()}</span>;
}

export default function Opportunities() {
  const [rankings, setRankings] = useState<RankedPool[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const d = await apiGet<{ rankings: RankedPool[] }>('/rankings');
        setRankings(d.rankings || []);
      } catch {}
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  return (
    <>
      {/* Top recommendation highlight */}
      {rankings.length > 0 && (
        <div className="card card-highlight" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="card-label" style={{ color: 'rgba(0,0,0,0.5)' }}>Top Recommendation</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: '#000', marginTop: 4 }}>
                {rankings[0].base_token_symbol || '?'}/{rankings[0].quote_token_symbol || '?'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', marginTop: 4 }}>
                APR {rankings[0].apr_pct?.toFixed(1)}% · TVL ${fmtUsd(rankings[0].tvl_usd ?? 0)} · Vol ${fmtUsd(rankings[0].volume_24h ?? 0)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="card-value" style={{ color: '#000', fontSize: 28 }}>
                {rankings[0].score}
              </div>
              <div className="card-label" style={{ color: 'rgba(0,0,0,0.5)' }}>Score</div>
            </div>
          </div>
        </div>
      )}

      {/* Ranking table */}
      <div className="card">
        <div className="card-label">All Opportunities</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Pool</th>
                <th>Proto</th>
                <th>Vol 24h</th>
                <th>TVL</th>
                <th>APR</th>
                <th>Score</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rankings.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Loading opportunities...
                </td></tr>
              )}
              {rankings.map((p, i) => (
                <tr key={p.poolId}>
                  <td>
                    <span className={`rank-num ${i < 3 ? `rank-${i + 1}` : ''}`}>
                      {i === 0 ? '★' : i + 1}
                    </span>
                  </td>
                  <td>
                    <b>{p.base_token_symbol || '?'}</b>/{p.quote_token_symbol || '?'}
                  </td>
                  <td><span className={`card-badge card-badge-${p.protocol}`}>{p.protocol}</span></td>
                  <td>{fmtUsd(p.volume_24h ?? 0)}</td>
                <td>{fmtUsd(p.tvl_usd ?? 0)}</td>
                  <td style={{ color: aprColor(p.apr_pct), fontWeight: 600 }}>
                    {p.apr_pct?.toFixed(1)}%
                  </td>
                  <td><b>{p.score}</b></td>
                  <td>{riskTag(p.riskLevel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
