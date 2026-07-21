'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtUsd } from '@/lib/api';
import type { RankingPool } from '@/types';

export default function Top10Page() {
  const [rankings, setRankings] = useState<RankingPool[]>([]);
  useEffect(() => {
    async function load() {
      try {
        const d = await apiGet<{ rankings: RankingPool[] }>('/rankings');
        setRankings(d.rankings || []);
      } catch (e) { console.error(e); }
    }
    load(); const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  if (rankings.length === 0) return <div className="card"><h3>Top 10 Scored Pools</h3><div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>Waiting for data accumulation...</div></div>;

  const aprColor = (v: number) => v > 500 ? 'var(--green)' : v > 100 ? '#8bc34a' : v > 30 ? 'var(--accent)' : 'var(--muted)';

  return (
    <div className="card">
      <h3>Top 10 Scored Pools</h3>
      <div style={{ overflow: 'auto', marginTop: 8 }}>
        <table>
          <thead><tr><th>#</th><th>Pair</th><th>Proto</th><th>Score</th><th>Vol 24h</th><th>TVL</th><th>APR</th><th>FDV</th><th>Txns</th><th>Conf</th></tr></thead>
          <tbody>
            {rankings.slice(0, 10).map((p, i) => (
              <tr key={p.pool_address || p.pool_id || i}>
                <td>{i + 1}</td>
                <td><b>{p.token0_symbol}</b>/{p.token1_symbol}</td>
                <td><span className={`tag tag-${p.protocol}`}>{p.protocol}</span></td>
                <td><b>{p.score}</b></td>
                <td>{fmtUsd(p.volume_24h)}</td>
                <td>{fmtUsd(p.tvl_usd)}</td>
                <td>{p.apr_pct != null ? <b style={{ color: aprColor(p.apr_pct) }}>{p.apr_pct}%</b> : '--'}</td>
                <td>{fmtUsd(p.market_cap)}</td>
                <td style={{ fontSize: 10 }}>{p.txns_24h ? `${fmtUsd(p.txns_24h)} tx` : '--'}</td>
                <td>{p.confidence}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
