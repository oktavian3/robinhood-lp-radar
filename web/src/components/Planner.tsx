'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtUsd, formatPrice } from '@/lib/api';

type RangeData = {
  pair: string;
  ranges: Array<{
    label: string;
    lowerPrice: string;
    upperPrice: string;
    tickLower: string;
    tickUpper: string;
    timeInRange: string;
    prob24h: string;
    fees: string;
    net: string;
    vsHold: string;
    confidence: string;
    duration: string;
  }>;
};

type QuickRangeResult = {
  symbol: string;
  currentPrice: number;
  priceChange24h: number | null;
  vol24h: number;
  tvlUsd: number;
  estApr: number;
  volRatio: number;
  bestPool: { pair: string; address: string; vol: number; tvl: number; fee: number; dexUrl: string };
  ranges: Array<{ num: number; label: string; lowerPrice: number; upperPrice: number; tickLower: number; tickUpper: number; spreadPct: number; il: string }>;
  allPools: Array<{ pair: string; vol: number; tvl: number; fee: number }>;
};

export default function Planner() {
  const [ranges, setRanges] = useState<RangeData[]>([]);
  const [query, setQuery] = useState('');
  const [quickResult, setQuickResult] = useState<QuickRangeResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadRanges() {
      try {
        const d = await apiGet<{ ranges: RangeData[] }>('/ranges');
        setRanges(d.ranges || []);
      } catch {}
    }
    loadRanges();
    const iv = setInterval(loadRanges, 30000);
    return () => clearInterval(iv);
  }, []);

  async function analyzeToken() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setQuickResult(null);
    try {
      const d = await apiGet<QuickRangeResult>(`/range-token?q=${encodeURIComponent(q)}`);
      setQuickResult(d);
    } catch {}
    setLoading(false);
  }

  return (
    <>
      {/* Quick range analyzer */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Token symbol or contract address (0x...)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyzeToken()}
          />
          <button className="btn btn-lime" onClick={analyzeToken} disabled={loading}>
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </div>

      {/* Quick result */}
      {quickResult && <QuickRangeResultView data={quickResult} />}

      {/* Engine ranges */}
      <div className="card" style={{ marginTop: quickResult ? 20 : 0 }}>
        <div className="card-label">Range Engine — Best Setups</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pool</th>
                <th>Strategy</th>
                <th>Lower</th>
                <th>Upper</th>
                <th>Ticks</th>
                <th>24h Prob</th>
                <th>Net</th>
                <th>Conf</th>
              </tr>
            </thead>
            <tbody>
              {ranges.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Range engine building candles...
                </td></tr>
              )}
              {ranges.flatMap(p =>
                p.ranges.map((r, i) => (
                  <tr key={`${p.pair}-${i}`}>
                    <td><b>{p.pair}</b></td>
                    <td style={{ color: i === 0 ? 'var(--lime)' : undefined, fontWeight: i === 0 ? 600 : undefined }}>
                      {r.label}
                    </td>
                    <td className="mono">{r.lowerPrice}</td>
                    <td className="mono">{r.upperPrice}</td>
                    <td className="addr">{r.tickLower}/{r.tickUpper}</td>
                    <td>{r.prob24h}</td>
                    <td><b>{r.net}</b></td>
                    <td>{r.confidence}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function QuickRangeResultView({ data }: { data: QuickRangeResult }) {
  const chg = data.priceChange24h != null
    ? `${data.priceChange24h > 0 ? '+' : ''}${data.priceChange24h.toFixed(1)}%`
    : 'N/A';

  function spreadColor(s: number): string {
    if (s < 20) return 'var(--positive)';
    if (s < 100) return 'var(--warning)';
    return 'var(--negative)';
  }

  return (
    <>
      <div className="pools-grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-label">{data.symbol} — Price Analysis</div>
          <div style={{ marginTop: 12 }}>
            <Row label="Price" value={`$${formatPrice(data.currentPrice)}`} />
            <Row label="24h Change" value={chg} color={data.priceChange24h && data.priceChange24h > 0 ? 'var(--positive)' : 'var(--negative)'} />
            <Row label="Vol 24h" value={`$${fmtUsd(data.vol24h)}`} />
            <Row label="TVL" value={`$${fmtUsd(data.tvlUsd)}`} />
            <Row label="Est APR" value={`${data.estApr.toFixed(1)}%`} color="var(--lime)" />
          </div>
        </div>
        <div className="card">
          <div className="card-label">Best Pool — {data.bestPool.pair}</div>
          <div style={{ marginTop: 12, fontSize: 12 }}>
            <Row label="Address" value={`${data.bestPool.address.slice(0, 10)}...${data.bestPool.address.slice(-6)}`} mono />
            <Row label="Vol 24h" value={`$${fmtUsd(data.bestPool.vol)}`} />
            <Row label="TVL" value={`$${fmtUsd(data.bestPool.tvl)}`} />
            <Row label="Fee" value={`${data.bestPool.fee / 10000}%`} />
            <Row label="Vol/TVL" value={`${data.volRatio.toFixed(1)}x`} />
          </div>
        </div>
      </div>

      {/* Candidate ranges */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-label">{data.symbol} — Range Analysis</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Current price: <span className="mono" style={{ color: 'var(--text-primary)' }}>
            ${data.currentPrice.toLocaleString(undefined, { minimumSignificantDigits: 4 })}
          </span>
          &nbsp;· {data.bestPool.pair} · {data.bestPool.fee / 10000}% fee pool
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Strategy</th><th>Lower</th><th>Upper</th><th>Spread</th><th>IL Est</th></tr>
            </thead>
            <tbody>
              {data.ranges.map(r => (
                <tr key={r.num}>
                  <td>{r.num}</td>
                  <td style={{ fontWeight: r.num === 1 ? 600 : undefined, color: r.num === 1 ? 'var(--lime)' : 'var(--text-secondary)' }}>
                    {r.label}
                  </td>
                  <td className="mono">${formatPrice(r.lowerPrice)}</td>
                  <td className="mono">${formatPrice(r.upperPrice)}</td>
                  <td style={{ color: spreadColor(r.spreadPct) }}>{r.spreadPct.toFixed(1)}%</td>
                  <td style={{ color: parseFloat(r.il) < -10 ? 'var(--negative)' : parseFloat(r.il) < -5 ? 'var(--warning)' : 'var(--positive)' }}>
                    {r.il}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verdict */}
      <div className={`verdict ${data.volRatio > 5 ? 'verdict-positive' : data.volRatio > 1 ? 'verdict-warning' : 'verdict-negative'}`}>
        <div className="card-label" style={{ marginBottom: 4 }}>Verdict</div>
        <div style={{ fontSize: 13 }}>
          {data.volRatio > 5
            ? `✅ HIGH VOLUME — Worth LPing! Vol/TVL ${data.volRatio.toFixed(1)}x`
            : data.volRatio > 1
            ? `⚠️ Moderate volume (${data.volRatio.toFixed(1)}x)`
            : `❌ Low volume (${data.volRatio.toFixed(1)}x)`}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: mono ? 11 : 12 }}>
        {value}
      </span>
    </div>
  );
}
