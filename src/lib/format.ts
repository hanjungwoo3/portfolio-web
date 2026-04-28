export function formatSigned(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

export function signColor(n: number): string {
  if (n > 0) return "text-rose-600";
  if (n < 0) return "text-blue-600";
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

// ─────────── KST 시각 (사용자 timezone 무관) ───────────
// UTC + 9시간 한 ms 를 Date 로 만들고, getUTC* 메서드로 KST 시각 추출.
// 주의: getHours/getDay (로컬) 는 사용 X — 사용자 OS 시간대에 영향받아 어긋남.

export function nowKst(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// "YYYY-MM-DD" KST 날짜 문자열
export function nowKstDateStr(): string {
  return nowKst().toISOString().slice(0, 10);
}

// KST 시(0~23)
export function nowKstHour(): number {
  return nowKst().getUTCHours();
}

// 자정 ~ 프리마켓 시작(08:00 KST) 전: Toss 가 어제 데이터 반환 → "어제의 어제보다" 표시
export function isEarlyMorningKst(): boolean {
  return nowKstHour() < 8;
}
