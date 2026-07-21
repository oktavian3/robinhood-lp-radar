'use client';
import { useState } from 'react';
import { apiGet, fmtAddr } from '@/lib/api';
import type { SearchResult } from '@/types';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');

  async function doSearch() {
    const q = query.trim();
    if (!q || q.length < 20) { setError('Enter a valid EVM address (0x...)'); return; }
    setError(''); setResult(null);
    try {
      const d = await apiGet<SearchResult>(`/search?q=${q}`);
      setResult(d);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="card">
      <h3>Search by Contract Address</h3>
      <div className="search-row">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="0x... (token, v2/v3 pool, or v4 pool ID)" />
        <button className="btn-primary" onClick={doSearch}>Search</button>
      </div>
      {error && <div style={{ color: 'var(--red)', marginTop: 12, fontSize: 12 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 12 }}>
          {result.poolFound ? (
            <>
              <div style={{ fontSize: 13, padding: '8px 0' }}>
                <b>{result.pool?.token0?.slice(0, 6)} / {result.pool?.token1?.slice(0, 6)}</b> | {result.pool?.protocol} | fee={result.pool?.fee ? `${result.pool.fee / 10000}%` : 'N/A'} | status={result.pool?.status}
              </div>
              {result.ranges?.length ? result.ranges.map((r, i) => (
                <div key={i} style={{ padding: '4px 0 4px 16px', borderLeft: '2px solid var(--accent)', margin: '4px 0', fontSize: 12 }}>
                  #{i + 1}: <b>{r.strategy}</b> | {r.lower} - {r.upper} | ticks {r.ticks} | 24h={r.prob24h} | net={r.net} | conf={r.confidence}
                </div>
              )) : <div style={{ color: 'var(--muted)', fontSize: 12 }}>Waiting for candle data...</div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, padding: '8px 0' }}><b>{result.tokenSymbol || fmtAddr(result.query)}</b> — {result.tokenPools?.length || 0} pools found</div>
              {result.tokenPools?.map((p, i) => (
                <div key={i} style={{ padding: '4px 0 4px 16px', fontSize: 12 }}>
                  {p.protocol} | <b>{p.token0_symbol || fmtAddr(p.token0)}</b>/{p.token1_symbol || fmtAddr(p.token1)} | fee={p.fee ? `${p.fee / 10000}%` : 'N/A'} | {p.status}
                </div>
              ))}
              {!result.tokenPools?.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No pools found for this address</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
