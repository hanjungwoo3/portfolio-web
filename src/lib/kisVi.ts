// VI(변동성 완화장치) 발동 꼬리표 — 앱 + 한국투자 연동일 때 1분마다(사용자 2026-11-03 "순서대로" ③).
//   VI = 한 종목이 순간적으로 크게 오르거나 내리면 거래소가 2분간 단일가 매매로 식히는 장치. 장중 '테마가 터지는 순간' 신호.
//   출처: 한국투자 변동성완화장치(VI) 현황 FHPST01390000 — 실전 키 실측 2026-11-03: 오늘 발동분 **최신 30건만**(tr_cont 이어받기 안 됨 — N 을 줘도 같은 쪽).
//   그래서 상승(1)·하락(2) × 코스피(K)·코스닥(Q) 네 번으로 나눠 120건까지 보고, 1분마다 쌓는다(앱을 켜 둔 동안은 빠짐없이). 날짜가 바뀌면 버린다.
import { useSyncExternalStore } from "react";
import { kisGet, isKisLinkOn } from "./broker";
import { US_PAIRS } from "./usMarketData";

export interface ViInfo {
  count: number;          // 오늘 발동 횟수(거래소 집계 vi_count)
  dir: "up" | "down";     // 마지막 발동 방향(발동가 vs 기준가)
  kind: "정적" | "동적" | "정적·동적";
  at: string;             // 마지막 발동 "HH:MM:SS"
  until: string;          // 해제 "HH:MM:SS"
  pct: number;            // 기준가 대비 괴리율(%)
  times?: { at: string; dir: "up" | "down" }[];   // 오늘 본 발동들(1분마다 모은다 — 한투는 종목당 마지막 한 건만 준다)
}
export interface ViRow {
  mksc_shrn_iscd?: string; cntg_vi_hour?: string; vi_cncl_hour?: string; vi_count?: string; vi_kind_code?: string;
  vi_prc?: string; vi_stnd_prc?: string; vi_dmc_stnd_prc?: string; vi_dprt?: string; vi_dmc_dprt?: string; bsop_date?: string;
}
const KEY = "kis_vi_today";
const kst = () => new Date(Date.now() + 9 * 3600_000);
const ymd = () => kst().toISOString().slice(0, 10).replace(/-/g, "");
const hms = (h?: string) => (h && h.length >= 6 ? `${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}` : "");

let map = new Map<string, ViInfo>();
const filled = new Set<string>();   // 종목별 전체 발동을 이미 받아 온 종목(오늘)
// 카드가 있는 국내 종목 — 지수·업종 화면(종목 지정 조회는 이 종목들만)
const CARD_CODES = new Set(US_PAIRS.filter(p => p.krStock && /^[\dA-Za-z]{6}\.KS$/.test(p.symbol)).map(p => p.symbol.slice(0, 6)));
let loadedDate = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());
function restore() {
  if (loadedDate === ymd()) return;
  loadedDate = ymd(); map = new Map(); filled.clear();
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (v?.date === loadedDate) map = new Map(v.items); } catch { /* 없음 */ }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify({ date: loadedDate, items: [...map] })); } catch { /* 용량 */ } }

export function toInfo(r: ViRow): ViInfo | null {
  const prc = Number(r.vi_prc), kc = r.vi_kind_code;
  const base = kc === "1" ? Number(r.vi_stnd_prc) : Number(r.vi_dmc_stnd_prc) || Number(r.vi_stnd_prc);
  if (!(prc > 0) || !(base > 0) || !r.cntg_vi_hour) return null;
  return {
    count: Number(r.vi_count) || 1, dir: prc >= base ? "up" : "down",
    kind: kc === "1" ? "정적" : kc === "2" ? "동적" : "정적·동적",
    at: hms(r.cntg_vi_hour), until: r.vi_cncl_hour && Number(r.vi_cncl_hour) > 0 ? hms(r.vi_cncl_hour) : "", pct: Math.abs(Number(kc === "1" ? r.vi_dprt : r.vi_dmc_dprt) || (prc / base - 1) * 100),
  };
}

async function fetchPart(div: "1" | "2", mkt: "K" | "Q") {
  return kisGet<{ rt_cd?: string; output?: ViRow[] }>("/uapi/domestic-stock/v1/quotations/inquire-vi-status", "FHPST01390000", {
    FID_DIV_CLS_CODE: div, FID_COND_SCR_DIV_CODE: "20139", FID_MRKT_CLS_CODE: mkt, FID_INPUT_ISCD: "",
    FID_RANK_SORT_CLS_CODE: "0", FID_INPUT_DATE_1: ymd(), FID_TRGT_CLS_CODE: "", FID_TRGT_EXLS_CLS_CODE: "",
  });
}

async function tick() {
  if (!isKisLinkOn()) return;
  const k = kst(), d = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (d === 0 || d === 6 || m < 8 * 60 || m > 20 * 60 + 5) return;   // NXT 프리 08:00 ~ 애프터 20:00(어제 19:59 발동도 실측)
  restore();
  let changed = false;
  for (const [div, mkt] of [["1", "K"], ["1", "Q"], ["2", "K"], ["2", "Q"]] as const) {
    let r;
    try { r = await fetchPart(div, mkt); } catch { continue; }
    for (const row of r.body.output ?? []) {
      if (row.bsop_date && row.bsop_date !== loadedDate) continue;
      const c = row.mksc_shrn_iscd, info = toInfo(row);
      if (!c || !info) continue;
      const prev = map.get(c);
      // 종목마다 가장 늦은 발동을 남기고, 횟수는 큰 쪽(거래소 집계 vi_count)
      const times = [...(prev?.times ?? (prev ? [{ at: prev.at, dir: prev.dir }] : []))];
      if (!times.some(t => t.at === info.at)) times.push({ at: info.at, dir: info.dir });
      times.sort((x, y) => x.at.localeCompare(y.at));
      if (!prev || prev.at < info.at) { map.set(c, { ...info, count: Math.max(info.count, prev?.count ?? 0), times }); changed = true; }
      else if (prev.count < info.count || (prev.times?.length ?? 0) !== times.length) { map.set(c, { ...prev, count: Math.max(prev.count, info.count), times }); changed = true; }
    }
  }
  // 횟수보다 아는 시각이 적은 종목(앱 켜기 전 발동) — 종목을 지정해 물으면 그 종목 오늘 발동이 전부 온다(실측 2026-11-04: 한국특강 4회 → 4건).
  //   카드가 있는 종목만, 한 번에 5개씩(초당 한도)
  const need = [...map].filter(([c, v]) => CARD_CODES.has(c) && v.count > (v.times?.length ?? 1) && !filled.has(c)).slice(0, 5);
  for (const [c, v] of need) {
    try {
      const { body } = await kisGet<{ rt_cd?: string; output?: ViRow[] }>("/uapi/domestic-stock/v1/quotations/inquire-vi-status", "FHPST01390000", {
        FID_DIV_CLS_CODE: "0", FID_COND_SCR_DIV_CODE: "20139", FID_MRKT_CLS_CODE: "0", FID_INPUT_ISCD: c,
        FID_RANK_SORT_CLS_CODE: "0", FID_INPUT_DATE_1: ymd(), FID_TRGT_CLS_CODE: "", FID_TRGT_EXLS_CLS_CODE: "",
      });
      const ts = (body.output ?? []).filter(r => !r.bsop_date || r.bsop_date === loadedDate).map(toInfo).filter((x): x is ViInfo => !!x)
        .map(x => ({ at: x.at, dir: x.dir })).sort((x, y) => x.at.localeCompare(y.at));
      filled.add(c);
      if (ts.length) { map.set(c, { ...v, times: ts }); changed = true; }
    } catch { /* 다음 분에 */ }
  }
  if (changed) { save(); map = new Map(map); emit(); }
}

let started = false;
export function startKisVi(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  restore();
  void tick();
  setInterval(() => { void tick(); }, 60_000);
}

export function useKisVi(): Map<string, ViInfo> {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => map, () => map);
}

/** 지금 단일가 중인가(발동~해제 사이) */
export function viActive(v: ViInfo): boolean {
  const now = kst().toISOString().slice(11, 19);
  return !!v.until && v.at <= now && now < v.until;
}
export function viLabel(v: ViInfo): { text: string; title: string } {
  const a = viActive(v);
  return {
    text: `VI${v.dir === "up" ? "↑" : "↓"}${v.count > 1 ? `${v.count}` : ""}${a ? " 발동중" : ""}`,
    // 요약 — 언제였는지만(사용자 2026-11-04 "문구가 너무 길어, 언제 있었는지만")
    // 발동 시각을 하나씩(사용자 2026-11-04 "각각 발동 시간") — 앱을 켜기 전 발동은 한투가 마지막 한 건만 줘서 빠질 수 있다
    title: (() => {
      const ts = v.times?.length ? v.times : [{ at: v.at, dir: v.dir }];
      const list = ts.map(t => `${t.at.slice(0, 5)}${t.dir === "up" ? "↑" : "↓"}`).join(" · ");
      const miss = v.count > ts.length ? ` (오늘 ${v.count}회 — 나머지 불러오는 중)` : "";
      return `VI ${list}${miss}${a ? " · 지금 단일가 중" : ""}`;
    })(),
  };
}
