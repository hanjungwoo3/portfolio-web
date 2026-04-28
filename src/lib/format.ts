export function formatSigned(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

export function signColor(n: number): string {
  if (n > 0) return "text-rose-600";   // 빨강 = 상승 (한국시장)
  if (n < 0) return "text-blue-600";   // 파랑 = 하락
  return "text-gray-500";
}

export function signBg(n: number): string {
  if (n > 0) return "bg-rose-50";
  if (n < 0) return "bg-blue-50";
  return "bg-gray-50";
}

export function formatVolume(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString();
}

// KST 현재 시각 (Android tzdata 호환과 동일 패턴)
export function nowKst(): Date {
  const now = new Date();
  return new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60_000);
}

export function isEarlyMorningKst(): boolean {
  return nowKst().getHours() < 8;
}
