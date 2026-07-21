'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtAddr, fmtUsd } from '@/lib/api';

type PaperPosition = {
  id: number;
  poolAddress: string | null;
  token0: string;
  token1: string;
  strategy: string | null;
  initial_capital_usd: number;
  status: string;
  opened_at: string;
  latestSnapshot: {
    position_value_usd: number;
    accrued_fees_usd: number;
    impermanent_loss_usd: number;
    net_pnl_usd: number;
    in_range: boolean;
  } | null;
};

export default function Positions() {
  const [positions, setPositions] = useState<PaperPosition[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const d = await apiGet<{ positions: PaperPosition[] }>('/positions');
        setPositions(d.positions || []);
      } catch {}
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  const totalValue = positions.reduce((s, p) => s + (p.latestSnapshot?.position_value_usd ?? 0), 0);
  const totalFees = positions.reduce((s, p) => s + (p.latestSnapshot?.accrued_fees_usd ?? 0), 0);
  const totalPnl = positions.reduce((s, p) => s + (p.latestSnapshot?.net_pnl_usd ?? 0), 0);
  const inRange = positions.filter(p => p.latestSnapshot?.in_range).length;

  return (
    <>
      {/* Summary stats */}
      <div className="stats-grid">
        <div className="card">
          <div className="card-label">Active Positions</div>
          <div className="card-value">{positions.length}</div>
        </div>
        <div className="card">
          <div className="card-label">Total Value</div>
          <div className="card-value" style={{ color: 'var(--lime)' }}>${fmtUsd(totalValue)}</div>
        </div>
        <div className="card">
          <div className="card-label">Accrued Fees</div>
          <div className="card-value" style={{ color: 'var(--positive)' }}>${fmtUsd(totalFees)}</div>
        </div>
        <div className="card">
          <div className="card-label">Net PnL</div>
          <div className="card-value" style={{ color: totalPnl >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {totalPnl >= 0 ? '+' : ''}${fmtUsd(totalPnl)}
          </div>
        </div>
        <div className="card">
          <div className="card-label">In Range</div>
          <div className="card-value" style={{ color: 'var(--positive)' }}>
            {inRange}/{positions.length}
          </div>
        </div>
      </div>

      {/* Positions table */}
      <div className="card">
        <div className="card-label">Paper Positions</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pool</th>
                <th>Capital</th>
                <th>Value</th>
                <th>PnL</th>
                <th>Fees</th>
                <th>IL</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  No active paper positions
                </td></tr>
              )}
              {positions.map(p => {
                const s = p.latestSnapshot || { position_value_usd: 0, net_pnl_usd: 0, accrued_fees_usd: 0, impermanent_loss_usd: 0, in_range: false };
                const pnl = Number(s.net_pnl_usd || 0);
                return (
                  <tr key={p.id}>
                    <td>
                      <b>{fmtAddr(p.token0)}</b>/{fmtAddr(p.token1)}
                    </td>
                    <td>${fmtUsd(p.initial_capital_usd)}</td>
                    <td>${fmtUsd(s.position_value_usd ?? 0)}</td>
                    <td style={{ color: pnl >= 0 ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </td>
                    <td style={{ color: 'var(--positive)' }}>${fmtUsd(s.accrued_fees_usd ?? 0)}</td>
                    <td style={{ color: 'var(--negative)' }}>${fmtUsd(s.impermanent_loss_usd ?? 0)}</td>
                    <td>{s.in_range ? '🟢 In Range' : '🔴 Out of Range'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
