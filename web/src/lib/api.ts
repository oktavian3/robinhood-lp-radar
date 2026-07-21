const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || 'https://api.avetrace.xyz/lp')
  : 'http://localhost:7474';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function fmtAddr(a: string): string {
  return !a || a.length < 20 ? (a || '--') : `${a.slice(0, 6)}...${a.slice(-4)}`;
}
export function fmtTimeAgo(d: string): string {
  return d ? `${Math.floor((Date.now() - new Date(d).getTime()) / 1000)}s ago` : 'never';
}
export function fmtUsd(n: number): string {
  if (!n) return '--';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}
export function fmtNum(n: number): string {
  return n ? n.toLocaleString() : '0';
}
