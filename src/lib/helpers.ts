export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function formatTimestamp(d: Date): string {
  return d.toISOString();
}

// Safe string conversion — handles BigInt, Buffer, etc.
export function safeStr(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.toLowerCase();
  if (typeof v === "bigint") return "0x" + v.toString(16).padStart(64, "0");
  if (Buffer.isBuffer(v)) return "0x" + v.toString("hex");
  return String(v).toLowerCase();
}
