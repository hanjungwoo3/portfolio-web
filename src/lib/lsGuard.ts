// localStorage 가 가득 차면(약 5MB) 저장이 조용히 실패한다 — 반도체 수급 체결·프로그램 기록이 09:31 에 멈추고
//   새로고침마다 다시 받는 원인으로 보였다(사용자 2026-11-24). 저장 실패 시: 다시 받을 수 있는 캐시만 지우고 한 번 더.
//   어떤 키가 큰지 화면에 보여 줄 수 있게 상위 목록도 낸다.

/** 지워도 되는 것 — 서버에서 다시 받는 목록·캐시(내 종목·거래·설정·로그인·오늘 기록은 건드리지 않는다) */
const DISPOSABLE = /(cache|_ts$|theme_|etf_|heat|krx_notices|tile|sector_rank|valuation|consensus|earnings|disclosure|news|warning|seohak|holdings_list|list_v|_prev$)/i;
const KEEP = /^(semi_tickflow_|prog_kis_|us_tickflow_|k200_|portfolio_|gdrive|kis_|toss_|broker|halt_alert|index_drawer|schedule_tab|sector_summary|us_semi)/;

export function lsTop(n = 5): { key: string; kb: number }[] {
  const out: { key: string; kb: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out.push({ key: k, kb: Math.round(((localStorage.getItem(k) ?? "").length * 2) / 1024) });
    }
  } catch { /* 없음 */ }
  return out.sort((a, b) => b.kb - a.kb).slice(0, n);
}
export function lsTotalKb(): number { return lsTop(10000).reduce((a, x) => a + x.kb, 0); }

let lastFail: string | undefined;
export const lsLastFail = () => lastFail;

/** 저장 — 가득 차면 지워도 되는 큰 캐시부터 지우고 다시. 그래도 안 되면 false */
export function lsSet(key: string, val: string): boolean {
  try { localStorage.setItem(key, val); return true; } catch { /* 가득 */ }
  const victims = lsTop(10000).filter(x => x.key !== key && DISPOSABLE.test(x.key) && !KEEP.test(x.key));
  for (const v of victims) {
    try { localStorage.removeItem(v.key); } catch { /* */ }
    try { localStorage.setItem(key, val); lastFail = undefined; return true; } catch { /* 아직 */ }
  }
  lastFail = `저장 공간 가득(${lsTotalKb()}KB) — 큰 항목: ${lsTop(5).map(x => `${x.key} ${x.kb}KB`).join(", ")}`;
  return false;
}
