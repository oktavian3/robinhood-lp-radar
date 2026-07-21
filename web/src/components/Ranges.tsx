'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtAddr } from '@/lib/api';
import type { RangeResult } from '@/types';

export default function RangesPage() {
  const [ranges, setRanges] = useState<RangeResult[]>([]);
  useEffect(() => {
    async function load() {
      try {
        const d = await apiGet<{ ranges: RangeResult[] }>('/ranges');
        setRanges(d.ranges || []);
      } catch (e) { console.error(e); }
    }
    load(); const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  if (ranges.length === 0) return <div className="card"><h3>Range Engine — Best Setups</h3><div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>Range engine waiting for candles...</div></div>;

  return (
    <div className="card">
      <h3>Range Engine — Best Setups</h3>
      <div style={{ overflow: 'auto', marginTop: 8 }}>
        <table>
          <thead><tr><th>Pool</th><th>Strategy</th><th>Lower</th><th>Upper</th><th>Ticks</th><th>In Range</th><th>24h Prob</th><th>Fees</th><th>Net</th><th>vs Hold</th><th>Conf</th><th>Duration</th></tr></thead>
          <tbody>
            {ranges.flatMap((p, pi) =>
              p.ranges.map((r, ri) => (
                <tr key={`${pi}-${ri}`}>
                  <td><b>{p.pair}</b></td>
                  <td>{r.label}</td>
                  <td style={{ fontSize: 10 }}>{r.lowerPrice}</td>
                  <td style={{ fontSize: 10 }}>{r.upperPrice}</td>
                  <td className="addr">{r.tickLower}/{r.tickUpper}</td>
                  <td>{r.timeInRange}</td>
                  <td>{r.prob24h}</td>
                  <td>{r.fees}</td>
                  <td><b>{r.net}</b></td>
                  <td>{r.vsHold}</td>
                  <td>{r.confidence}</td>
                  <td style={{ fontSize: 10 }}>{r.duration}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
