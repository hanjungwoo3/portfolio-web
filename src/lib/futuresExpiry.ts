// 코스피200 선물·옵션 동시만기(네 마녀의 날) — 3·6·9·12월 둘째 목요일(KST).
//   만기일엔 차익거래 청산·프로그램 매매로 현물 변동성↑, 마감 동시호가 급변.
const KST_OFFSET = 9 * 3600_000;
function nowKst(): Date { return new Date(Date.now() + KST_OFFSET); }

// y년 m0월(0-based)의 둘째 목요일(UTC 자정 기준 날짜값)
function secondThursday(y: number, m0: number): Date {
  const first = new Date(Date.UTC(y, m0, 1));
  const dow = first.getUTCDay();                 // 0=일 … 4=목
  const day = 1 + ((4 - dow + 7) % 7) + 7;        // 첫 목요일 + 7
  return new Date(Date.UTC(y, m0, day));
}

export interface ExpiryInfo { date: Date; daysLeft: number; isToday: boolean }
// 오늘(KST) 기준 다가오는(당일 포함) 선물·옵션 동시만기.
export function nextFuturesExpiry(): ExpiryInfo {
  const now = nowKst();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cands: Date[] = [];
  for (const yy of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    for (const m of [2, 5, 8, 11]) cands.push(secondThursday(yy, m));   // 3·6·9·12월
  }
  const next = cands.find(d => d.getTime() >= todayUtc) ?? cands[0];
  const daysLeft = Math.round((next.getTime() - todayUtc) / 86400000);
  return { date: next, daysLeft, isToday: daysLeft === 0 };
}
