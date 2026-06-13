// ticker → 종목명 영구 저장소(localStorage).
//   보유에 없는(거래만 있는) 종목명을 코드 대신 표시하기 위함. 토스 가져오기 등에서 채움.

const KEY = "portfolio_ticker_names";

export function getTickerNames(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v as Record<string, string> : {};
  } catch {
    return {};
  }
}

// ticker→name 들을 병합 저장 (코드와 동일하거나 빈 이름은 무시)
export function rememberTickerNames(pairs: { ticker: string; name: string }[]): void {
  const m = getTickerNames();
  let changed = false;
  for (const { ticker, name } of pairs) {
    const tk = (ticker ?? "").trim();
    const nm = (name ?? "").trim();
    if (!tk || !nm || nm === tk) continue;
    if (m[tk] !== nm) { m[tk] = nm; changed = true; }
  }
  if (changed) {
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* noop */ }
  }
}
