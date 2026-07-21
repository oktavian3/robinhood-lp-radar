'use client';
import { useState } from 'react';
import { apiGet, fmtUsd } from '@/lib/api';
import type { QuickRange } from '@/types';

export default function RangeTokenPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QuickRange | null>(null);
  const [error, setError] = useState('');

  async function analyze() {
    const q = query.trim();
    if (!q) return;
    setLoading(true); setError(''); setData(null);
    try {
      const d = await apiGet<QuickRange>(`/range-token?q=${encodeURIComponent(q)}`);
      setData(d);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  const chg = data?.priceChange24h;
  const chgStr = chg != null ? `${chg > 0 ? '+' : ''}${chg}%${Math.abs(chg) > 50 ? ' ⚡' : ''}` : 'N/A';

  return (
    <>
      <div className="card">
        <h3>🔥 Quick Range Analysis — DEX Screener</h3>
        <div className="search-row">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && analyze()} placeholder="Token symbol or contract address (0x...)" />
          <button className="btn-primary" onClick={analyze} disabled={loading}>{loading ? 'Analyzing...' : 'Analyze'}</button>
        </div>
      </div>

      {error && <div className="card" style={{ borderLeft: '3px solid var(--red)', marginTop: 12 }}><div style={{ color: 'var(--red)' }}>{error}</div></div>}

      {data && (
        <>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div className="card">
              <h3>{data.symbol} — Price Analysis</h3>
              <div className="info-grid">
                <div><span className="label">Price</span><span className="val">${Number(data.currentPrice).toFixed(6)}</span></div>
                <div><span className="label">24h Change</span><span className="val" style={{ color: (chg ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{chgStr}</span></div>
                <div><span className="label">Vol 24h</span><span className="val">{fmtUsd(data.vol24h)}</span></div>
                <div><span className="label">TVL</span><span className="val">{fmtUsd(data.tvlUsd)}</span></div>
                <div><span className="label">Est APR</span><span className="val" style={{ color: 'var(--green)' }}>{data.estApr.toFixed(1)}%</span></div>
              </div>
            </div>
            <div className="card">
              <h3>Best Pool — {data.bestPool.pair}</h3>
              <div className="info-grid" style={{ fontSize: 11 }}>
                <div><span className="label">Address</span><span className="addr">{data.bestPool.address.slice(0, 10)}...{data.bestPool.address.slice(-6)}</span></div>
                <div><span className="label">Vol 24h</span><span className="val">{fmtUsd(data.bestPool.vol)}</span></div>
                <div><span className="label">TVL</span><span className="val">{fmtUsd(data.bestPool.tvl)}</span></div>
                <div><span className="label">Fee</span><span className="val">{data.bestPool.fee / 10000}% ({data.bestPool.fee}bps)</span></div>
                <div><span className="label">Vol/TVL</span><span className="val">{data.volRatio.toFixed(1)}x</span></div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>Candidate Ranges — Adaptive {(data.estApr * 0.1).toFixed(0)}% volatility factor</h3>
            <div style={{ overflow: 'auto', marginTop: 8 }}>
              <table>
                <thead><tr><th>#</th><th>Strategy</th><th>Lower Price</th><th>Upper Price</th><th>Tick Range</th><th>Spread</th><th>IL Est</th></tr></thead>
                <tbody>
                  {data.ranges.map(r => {
                    const il = parseFloat(r.il);
                    return (
                      <tr key={r.num}>
                        <td>{r.num}</td>
                        <td><b>{r.label}</b></td>
                        <td>${r.lowerPrice.toFixed(6)}</td>
                        <td>${r.upperPrice.toFixed(6)}</td>
                        <td className="addr">{r.tickLower}/{r.tickUpper}</td>
                        <td>{r.spreadPct}%</td>
                        <td style={{ color: il < -10 ? 'var(--red)' : il < -5 ? 'var(--yellow)' : 'var(--green)' }}>{r.il}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {data.allPools.length > 1 && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>All Pools — {data.symbol}</h3>
              <div style={{ overflow: 'auto', marginTop: 8 }}>
                <table>
                  <thead><tr><th>#</th><th>Pool</th><th>Vol 24h</th><th>TVL</th><th>Fee</th></tr></thead>
                  <tbody>
                    {data.allPools.slice(0, 8).map((p, i) => (
                      <tr key={p.address || i}>
                        <td>{i + 1}</td>
                        <td>{p.pair}</td>
                        <td>{fmtUsd(p.vol)}</td>
                        <td>{fmtUsd(p.tvl)}</td>
                        <td>{p.fee / 10000}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card verdict" style={{ marginTop: 12, borderLeft: `3px solid ${data.volRatio > 5 ? 'var(--green)' : data.volRatio > 1 ? 'var(--yellow)' : 'var(--red)'}` }}>
            <h3>Verdict</h3>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              {data.volRatio > 5 ? `✅ HIGH VOLUME — Worth LPing! Vol/TVL ${data.volRatio.toFixed(1)}x` :
               data.volRatio > 1 ? `⚠️ Moderate volume (${data.volRatio.toFixed(1)}x)` :
               `❌ Low volume (${data.volRatio.toFixed(1)}x)`}
            </div>
            {data.volRatio > 1 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                → Narrow: capital efficient, rebalance 6-12h<br />
                → Balanced: best balance, rebalance 12-24h<br />
                → Wide: safer, rebalance 24-48h
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
