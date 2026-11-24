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
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    if (v?.date === kstDate()) return v.pts;
    // 날짜가 지난 기록은 버리기 전에 '지난 거래일'로 옮겨 둔다 — 장 마감 뒤·주말 그래프에 그날 프로그램 선을 그리려고(사용자 2026-11-21 "하루 저장하고 삭제해서?")
    if (v?.date && v.date < kstDate() && v.pts?.length) localStorage.setItem(`${key}_prev`, JSON.stringify(v));
    return [];
  } catch { return []; }
}
/** 지난 거래일 기록(그 날짜와 맞을 때만) */
function loadPrev<T>(key: string, date: string): T[] {
  try { load(key); const v = JSON.parse(localStorage.getItem(`${key}_prev`) ?? "null"); return v?.date === date ? v.pts : []; } catch { return []; }
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
export const loadProgTapePrev = (code: string, date: string) => loadPrev<ProgPt>(progKey(code), date);
interface ProgRow { bsop_hour?: string; whol_smtn_ntby_tr_pbmn?: string; whol_smtn_shnu_tr_pbmn?: string; whol_smtn_seln_tr_pbmn?: string }
// 기록 상태 — 실패를 조용히 삼켜 09:31 에 멈춘 걸 아무도 몰랐다(사용자 2026-11-24 "프로그램 거래는 없어?"). 화면이 이유를 보여 준다
export const progStatus: Record<string, { okAt?: number; lastT?: string; err?: string; errAt?: number; skip?: string; pages?: number }> = {};
async function recordProgram(code: string): Promise<boolean> {
  // 한 번에 30건 — 앞(장 시작)부터 주는 듯해 그다음은 연속 조회(tr_cont N)로 넘긴다. 첫 쪽만 받아 09:31 에서 멈췄다(사용자 2026-11-24 화면: 09:02~09:31 = 딱 30분)
  //   응답 tr_cont F·M = 더 있음, D·E = 끝. 최대 30쪽(=약 15시간)
  const rows: ProgRow[] = [];
  let cont = "";
  for (let page = 0; page < 30; page++) {
    const { body, trCont } = await kisGet<{ rt_cd?: string; output?: ProgRow[] }>(
      "/uapi/domestic-stock/v1/quotations/program-trade-by-stock", "FHPPG04650101", { FID_COND_MRKT_DIV_CODE: "UN", FID_INPUT_ISCD: code }, cont);   // UN = 통합(KRX+NXT) — 프리·애프터도(실측 2026-11-04 08:05 삼성 −137억)
    const got = (body.output ?? []).filter(r => r.bsop_hour && r.whol_smtn_ntby_tr_pbmn != null);
    rows.push(...got);
    if (!got.length || !(trCont === "F" || trCont === "M")) break;
    // 이미 지금 시각 근처까지 왔으면 그만
    const kst = new Date(Date.now() + 9 * 3600_000), nowHm = `${String(kst.getUTCHours()).padStart(2, "0")}${String(kst.getUTCMinutes()).padStart(2, "0")}`;
    const times = got.map(r => r.bsop_hour!.slice(0, 4)).sort();
    if (times[times.length - 1] >= nowHm || times[0] >= nowHm) break;
    cont = "N";
  }
  (progStatus[code] ??= {}).pages = rows.length;
  if (!rows.length) { (progStatus[code] ??= {}).err = "응답 0건"; progStatus[code].errAt = Date.now(); return false; }
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
  const st = (progStatus[code] ??= {}); st.okAt = Date.now(); st.lastT = [...byMin.keys()].sort().pop(); st.err = undefined; st.skip = undefined;
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
        try { if (await recordProgram(code)) changed = true; } catch (e) { const st = (progStatus[code] ??= {}); st.err = String((e as Error)?.message ?? e).slice(0, 120); st.errAt = Date.now(); changed = true; }
      }
    } else for (const [code] of PROG_CODES) { (progStatus[code] ??= {}).skip = "한국투자 연동 꺼짐(앱+한투에서만 기록)"; }
    if (changed) window.dispatchEvent(new Event(TAPE_EVENT));
  };
  void tick();
  setInterval(() => { void tick(); }, 60_000);   // 숨겨 둔 창에서도 — 그래야 장 시작부터 이어진다
}
