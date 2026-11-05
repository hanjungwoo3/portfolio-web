// 코스피200 선물 장중 기록기 — 앱이 켜져 있는 동안(어느 탭이든) 1분마다 한 번(사용자 2026-11-03 "외국인 K200 선물 2단계").
//   ① 시장 미결제약정·선물가(한경, 무료 — 웹·앱 모두)  ② 외국인 순매수 계약(한국투자, 앱+연동일 때만 — 지연 없음)
//   둘 다 무료 출처에 장중 이력이 없어 직접 쌓는다. 날짜(KST)가 바뀌면 버린다. 주간 선물장 08:45~15:46 만.
import { fetchKrFuturesLive } from "./api";
import { fetchKisK200FutInvestor, kisFutAvailable } from "./kisFutures";
import { kisGet } from "./broker";

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

// ── 반도체 프로그램 매매(한국투자 종목별 프로그램매매추이 FHPPG04650101 — 실측 2026-11-03 실전 키) ──
//   삼성전자·SK하이닉스 프로그램 누적 순매수(원 → 억원)를 1분마다. 응답이 최근 30건(체결 시각별)이라 처음엔 그걸로 앞을 메운다.
export interface ProgPt { t: string; v: number; b?: number; s?: number }   // v = 누적 순매수, b·s = 누적 매수·매도(억원, 사용자 2026-11-05 "매수/매도 같이")
export const PROG_CODES = [["005930", "삼성전자"], ["000660", "SK하이닉스"]] as const;
const progKey = (code: string) => `prog_kis_${code}`;
export const loadProgTape = (code: string) => load<ProgPt>(progKey(code));
interface ProgRow { bsop_hour?: string; whol_smtn_ntby_tr_pbmn?: string; whol_smtn_shnu_tr_pbmn?: string; whol_smtn_seln_tr_pbmn?: string }
async function recordProgram(code: string): Promise<boolean> {
  const { body } = await kisGet<{ rt_cd?: string; output?: ProgRow[] }>(
    "/uapi/domestic-stock/v1/quotations/program-trade-by-stock", "FHPPG04650101", { FID_COND_MRKT_DIV_CODE: "UN", FID_INPUT_ISCD: code });   // UN = 통합(KRX+NXT) — 프리·애프터도(실측 2026-11-04 08:05 삼성 −137억)
  const rows = (body.output ?? []).filter(r => r.bsop_hour && r.whol_smtn_ntby_tr_pbmn != null);
  if (!rows.length) return false;
  // 시각 오름차순 → 분마다 마지막 값. 프리 08:00 ~ 애프터 20:00
  const byMin = new Map<string, ProgPt>();
  for (const r of [...rows].sort((a, b) => a.bsop_hour!.localeCompare(b.bsop_hour!))) {
    const h = r.bsop_hour!, t = `${h.slice(0, 2)}:${h.slice(2, 4)}`;
    if (t < "08:00" || t > "20:00") continue;
    byMin.set(t, { t, v: Number(r.whol_smtn_ntby_tr_pbmn) / 1e8, b: Number(r.whol_smtn_shnu_tr_pbmn) / 1e8 || undefined, s: Number(r.whol_smtn_seln_tr_pbmn) / 1e8 || undefined });
  }
  if (!byMin.size) return false;
  const have = new Map(load<ProgPt>(progKey(code)).map(p => [p.t, p]));
  for (const [t, p] of byMin) have.set(t, p);
  const pts = [...have].sort((a, b) => a[0].localeCompare(b[0])).map(([, p]) => p);
  try { localStorage.setItem(progKey(code), JSON.stringify({ date: kstDate(), pts })); } catch { /* 용량 */ }
  return true;
}

let started = false;
export function startFuturesTape(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = async () => {
    const k = new Date(Date.now() + 9 * 3600_000);
    const dow = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
    if (dow === 0 || dow === 6 || m < 8 * 60 || m > 20 * 60 + 2) return;
    const futOpen = m >= 8 * 60 + 45 && m <= 15 * 60 + 46;   // 주간 선물장 — 미결제·외국인 선물은 이 안에서만
    const t = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
    let changed = false;
    if (futOpen) try {
      const f = await fetchKrFuturesLive("kospi200");
      if (f && f.oi > 0 && f.price > 0) { push<OiPt>(OI_KEY, { t, oi: f.oi, p: f.price }); changed = true; }
    } catch { /* 다음 분에 */ }
    if (futOpen && kisFutAvailable()) {
      try {
        const r = await fetchKisK200FutInvestor();
        if (r) { push<FrgnPt>(FR_KEY, { t, c: r.frgnQty }); changed = true; }
      } catch { /* 다음 분에 */ }
    }
    if (kisFutAvailable()) {   // 프로그램 매매 — 프리 08:00 ~ 애프터 20:00(통합)
      for (const [code] of PROG_CODES) {
        try { if (await recordProgram(code)) changed = true; } catch { /* 다음 분에 */ }
      }
    }
    if (changed) window.dispatchEvent(new Event(TAPE_EVENT));
  };
  void tick();
  setInterval(() => { void tick(); }, 60_000);   // 숨겨 둔 창에서도 — 그래야 장 시작부터 이어진다
}
