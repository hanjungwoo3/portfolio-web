// 억원 금액 표시 한 벌 — "+80억", "−4.5억", 1만억 넘으면 "−1조4501억"(사용자 2026-11-11 "금액은 단위를 넣고 80억, −1조4501억")
export function fmtEok(v: number, sign = true): string {
  const a = Math.abs(v), sg = !sign ? (v < 0 ? "−" : "") : v > 0 ? "+" : v < 0 ? "−" : "";
  if (a >= 1e4) { const jo = Math.floor(a / 1e4), r = Math.round(a - jo * 1e4); return `${sg}${jo}조${r ? `${r}억` : ""}`; }
  return `${sg}${a >= 10 || a === 0 ? Math.round(a).toLocaleString() : a.toFixed(1)}억`;
}
