'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtUsd, fmtNum } from '@/lib/api';
import type { TrendingToken } from '@/types';

export default function TrendingPage({ onAnalyze }: { onAnalyze?: (addr: string, sym: string) => void }) {
  const [tokens, setTokens] = useState<TrendingToken[]>([]);
  useEffect(() => {
    async function load() {
      try {
        const d = await apiGet<{ trending: TrendingToken[] }>('/trending');
        setTokens((d.trending || []).filter(t => t.volume24hUsd > 1000));
      } catch (e) { console.error(e); }
    }
    load(); const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  const aprColor = (v: number) => v > 5000 ? 'var(--green)' : v > 1000 ? '#8bc34a' : v > 100 ? 'var(--accent)' : 'var(--muted)';

  return (
    <div className="card">
      <h3>🔥 Trending Tokens — Robinhood Chain</h3>
      <div style={{ overflow: 'auto', marginTop: 8 }}>
        <table>
          <thead><tr><th>#</th><th>Token</th><th>Vol 24h</th><th>TVL</th><th>APR</th><th>MCap</th><th>Txns</th></tr></thead>
          <tbody>
            {tokens.slice(0, 20).map((t, i) => (
              <tr key={t.tokenAddress || i}
                  onClick={() => onAnalyze?.(t.tokenAddress, t.symbol)}
                  style={{ cursor: 'pointer' }}>
                <td>{t.priority || i + 1}</td>
                <td><b>{t.symbol}</b></td>
                <td>{fmtUsd(t.volume24hUsd)}</td>
                <td>{fmtUsd(t.tvlUsd)}</td>
                <td>{t.totalApr ? <b style={{ color: aprColor(t.totalApr) }}>{t.totalApr}%</b> : '--'}</td>
                <td>{fmtUsd(t.mcap)}</td>
                <td style={{ fontSize: 10 }}>{fmtNum(t.txns24h)} tx</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
