'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtAddr, fmtTimeAgo } from '@/lib/api';
import type { Position } from '@/types';

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  useEffect(() => {
    async function load() {
      try { const d = await apiGet<{ positions: Position[] }>('/positions'); setPositions(d.positions || []); } catch (e) { console.error(e); }
    }
    load(); const iv = setInterval(load, 15000); return () => clearInterval(iv);
  }, []);

  if (positions.length === 0) return <div className="card"><h3>Paper Positions</h3><div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>No active positions</div></div>;

  return (
    <div className="card">
      <h3>Paper Positions</h3>
      <div style={{ overflow: 'auto', marginTop: 8 }}>
        <table>
          <thead><tr><th>Pool</th><th>Strategy</th><th>Capital</th><th>Value</th><th>PnL</th><th>Fees</th><th>IL</th><th>In Range</th><th>Age</th><th>Status</th></tr></thead>
          <tbody>
            {positions.map((p, i) => {
              const s = p.latestSnapshot || {};
              const pnl = Number(s.net_pnl_usd || 0);
              return (
                <tr key={i}>
                  <td>{fmtAddr(p.token0)}/{fmtAddr(p.token1)}</td>
                  <td>{p.strategy?.replace(/_/g, ' ').slice(0, 15)}</td>
                  <td>${Number(p.initial_capital_usd).toFixed(0)}</td>
                  <td>${Number(s.position_value_usd || 0).toFixed(0)}</td>
                  <td style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</td>
                  <td>${Number(s.accrued_fees_usd || 0).toFixed(2)}</td>
                  <td>${Number(s.impermanent_loss_usd || 0).toFixed(2)}</td>
                  <td>{s.in_range ? '🟢' : '🔴'}</td>
                  <td style={{ fontSize: 10 }}>{fmtTimeAgo(p.opened_at)}</td>
                  <td>{p.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
