'use client';
import { useState, useEffect } from 'react';
import { apiGet, fmtNum } from '@/lib/api';
import Overview from '@/components/Overview';
import Top10 from '@/components/Top10';
import Ranges from '@/components/Ranges';
import Trending from '@/components/Trending';
import RangeToken from '@/components/RangeToken';
import Positions from '@/components/Positions';
import TrackRecord from '@/components/TrackRecord';
import Search from '@/components/Search';

export default function HomePage() {
  const [tab, setTab] = useState('overview');
  const [block, setBlock] = useState(0);

  useEffect(() => {
    async function loadBlock() {
      try { const d = await apiGet<{ latestStoredBlock: number }>('/blocks/latest'); setBlock(d.latestStoredBlock); } catch (e) {}
    }
    loadBlock(); const iv = setInterval(loadBlock, 15000);
    return () => clearInterval(iv);
  }, []);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'top10', label: 'Top 10' },
    { id: 'ranges', label: 'Range Engine' },
    { id: 'trending', label: 'Trending' },
    { id: 'range-token', label: 'Range' },
    { id: 'positions', label: 'Positions' },
    { id: 'track-record', label: 'Track Record' },
    { id: 'search', label: 'Search' },
  ];

  return (
    <>
      <nav className="nav">
        {tabs.map(t => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>

      {tab === 'overview' && <Overview />}
      {tab === 'top10' && <Top10 />}
      {tab === 'ranges' && <Ranges />}
      {tab === 'trending' && <Trending onAnalyze={(addr, sym) => { setTab('range-token'); }} />}
      {tab === 'range-token' && <RangeToken />}
      {tab === 'positions' && <Positions />}
      {tab === 'track-record' && <TrackRecord />}
      {tab === 'search' && <Search />}
    </>
  );
}
