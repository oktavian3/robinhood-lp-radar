'use client';
import { useState, useEffect } from 'react';
import { apiGet } from '@/lib/api';
import Overview from '@/components/Overview';
import Opportunities from '@/components/Opportunities';
import Planner from '@/components/Planner';
import Positions from '@/components/Positions';
import Performance from '@/components/Performance';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'planner', label: 'Planner' },
  { id: 'positions', label: 'Positions' },
  { id: 'performance', label: 'Performance' },
];

const PAGE_META: Record<string, { title: string; desc: string }> = {
  overview: {
    title: 'DASHBOARD',
    desc: 'Real-time Robinhood Chain liquidity pool intelligence. Monitor pools, volume, and health.',
  },
  opportunities: {
    title: 'LP OPPORTUNITIES',
    desc: 'Find concentrated liquidity setups ranked by fee efficiency, range durability, and estimated net return.',
  },
  planner: {
    title: 'RANGE PLANNER',
    desc: 'Design and backtest concentrated liquidity ranges with adaptive volatility modeling.',
  },
  positions: {
    title: 'POSITIONS',
    desc: 'Track active paper positions, accrued fees, impermanent loss, and rebalance history.',
  },
  performance: {
    title: 'PERFORMANCE',
    desc: 'Track record of all LP recommendations. 7-day and 30-day cohort performance by strategy type.',
  },
};

export default function HomePage() {
  const [tab, setTab] = useState('overview');
  const [block, setBlock] = useState<number>(0);

  useEffect(() => {
    async function loadBlock() {
      try {
        const d = await apiGet<{ latestStoredBlock: number }>('/blocks/latest');
        setBlock(d.latestStoredBlock);
      } catch {}
    }
    loadBlock();
    const iv = setInterval(loadBlock, 15000);
    return () => clearInterval(iv);
  }, []);

  const meta = PAGE_META[tab] || PAGE_META.overview;

  return (
    <>
      {/* Sub-navigation */}
      <nav className="main-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {block > 0 ? `#${block.toLocaleString()}` : ''}
        </div>
      </nav>

      {/* Page header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-header-title">{meta.title}</h1>
          <p className="page-header-desc">{meta.desc}</p>
        </div>
        <div className="page-header-actions">
          <span className="network-badge">
            <span className="indicator-dot" style={{ width: 5, height: 5 }} />
            Robinhood Chain
          </span>
        </div>
      </div>

      {/* Page content */}
      <div className="page-content fade-in" key={tab}>
        {tab === 'overview' && <Overview />}
        {tab === 'opportunities' && <Opportunities />}
        {tab === 'planner' && <Planner />}
        {tab === 'positions' && <Positions />}
        {tab === 'performance' && <Performance />}
      </div>
    </>
  );
}
