'use client';
import { usePathname, useRouter } from 'next/navigation';

const tabs = [
  { id: '', label: 'Overview' },
  { id: 'top10', label: 'Top 10' },
  { id: 'ranges', label: 'Range Engine' },
  { id: 'trending', label: 'Trending' },
  { id: 'range-token', label: 'Range' },
  { id: 'positions', label: 'Positions' },
  { id: 'track-record', label: 'Track Record' },
  { id: 'search', label: 'Search' },
];

export default function Nav() {
  const path = usePathname().replace('/', '');
  const router = useRouter();
  return (
    <nav className="nav">
      {tabs.map(t => (
        <button key={t.id} className={path === t.id ? 'active' : ''} onClick={() => router.push(`/${t.id}`)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
