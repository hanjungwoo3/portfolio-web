// 코스피200 선물 장중 기록기 — 앱이 켜져 있는 동안(어느 탭이든) 1분마다 한 번(사용자 2026-11-03 "외국인 K200 선물 2단계").
//   ① 시장 미결제약정·선물가(한경, 무료 — 웹·앱 모두)  ② 외국인 순매수 계약(한국투자, 앱+연동일 때만 — 지연 없음)
//   둘 다 무료 출처에 장중 이력이 없어 직접 쌓는다. 날짜(KST)가 바뀌면 버린다. 주간 선물장 08:45~15:46 만.
import { fetchKrFuturesLive } from "./api";
import { fetchKisK200FutInvestor, kisFutAvailable } from "./kisFutures";

export interface OiPt { t: string; oi: number; p: number }
export interface FrgnPt { t: string; c: number }   // 외국인 누적 순매수(계약)
const OI_KEY = "k200_oi_intraday", FR_KEY = "k200_frgn_kis";
export const TAPE_EVENT = "k200-tape";
const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
function load<T>(key: string): T[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); return v?.date === kstDate() ? v.pts : []; } catch { return []; }
}
function push<T extends { t: string }>(key: string, pt: T) {
  const pts = load<T>(key);
  const next = pts.length && pts[pts.length - 1].t === pt.t ? [...pts.slice(0, -1), pt] : [...pts, pt];
  try { localStorage.setItem(key, JSON.stringify({ date: kstDate(), pts: next })); } catch { /* 용량 — 이번만 */ }
}
export const loadOiTape = () => load<OiPt>(OI_KEY);
export const loadFrgnTape = () => load<FrgnPt>(FR_KEY);

let started = false;
export function startFuturesTape(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = async () => {
    const k = new Date(Date.now() + 9 * 3600_000);
    const dow = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
    if (dow === 0 || dow === 6 || m < 8 * 60 + 45 || m > 15 * 60 + 46) return;
    const t = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
    let changed = false;
    try {
      const f = await fetchKrFuturesLive("kospi200");
      if (f && f.oi > 0 && f.price > 0) { push<OiPt>(OI_KEY, { t, oi: f.oi, p: f.price }); changed = true; }
    } catch { /* 다음 분에 */ }
    if (kisFutAvailable()) {
      try {
        const r = await fetchKisK200FutInvestor();
        if (r) { push<FrgnPt>(FR_KEY, { t, c: r.frgnQty }); changed = true; }
      } catch { /* 다음 분에 */ }
    }
    if (changed) window.dispatchEvent(new Event(TAPE_EVENT));
  };
  void tick();
  setInterval(() => { void tick(); }, 60_000);   // 숨겨 둔 창에서도 — 그래야 장 시작부터 이어진다
}
