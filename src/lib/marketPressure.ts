// 시황 분석 — '하방 압력 계기판'(사용자 2026-11-20, 삼프로 "극도로 쏠렸던 공매도의 끝자락" 영상의 수급·파생 신호를 숫자로).
//   지표마다 지금 상태를 '하방 강화 / 그대로 / 완화' 셋 중 하나로 판정한다. 예측이 아니라 **지금 상태** 설명.
//   계산은 여기(순수 함수), 그리기·받기는 components/MarketPressureCard.
import type { KrFuturesDay, LendingTradingPoint, MarketFlowPoint, ShortSellingPoint } from "./api";

export type Tone = "worse" | "flat" | "better";   // 하방 강화 · 그대로 · 완화
export interface Gauge { key: string; title: string; tone: Tone; value: string; text: string; series?: number[] }

const eok = (won: number) => `${won > 0 ? "+" : won < 0 ? "−" : ""}${Math.abs(Math.round(won / 1e8)).toLocaleString()}억`;
const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
const avg = (a: number[]) => (a.length ? sum(a) / a.length : 0);

/** ① 외국인 코스피200 선물 — 최근 5일 순매수 방향 + 미결제 증감·가격으로 성격(신규 매도·청산·숏커버) */
export function futuresGauge(days: KrFuturesDay[]): Gauge | null {
  if (days.length < 6) return null;
  const last5 = days.slice(-5), prev = days[days.length - 6];
  const net5 = sum(last5.map(d => d.foreign));
  const doi = last5[last5.length - 1].oi - prev.oi, dp = last5[last5.length - 1].price - prev.price;
  let cum = 0; const series = days.map(d => (cum += d.foreign));
  // 미결제 + 가격으로 성격 — 미결제↑가격↓ = 신규 매도(하방 강화) · 미결제↓가격↑ = 숏커버(완화) · 미결제↓가격↓ = 산 것 정리
  const kind = Math.abs(doi) < 1000 ? "변화 적음" : doi > 0 ? (dp >= 0 ? "신규 매수" : "신규 매도") : (dp >= 0 ? "숏커버(판 걸 되삼)" : "매수 정리");
  // 순매수 방향과 미결제 성격이 엇갈리면 '그대로'(외국인은 사는데 시장 전체로는 신규 매도가 쌓일 수 있다)
  const tone: Tone = net5 <= -3000 && kind !== "숏커버(판 걸 되삼)" ? "worse"
    : net5 >= 3000 && kind !== "신규 매도" ? "better"
    : kind === "신규 매도" && net5 < 0 ? "worse" : kind === "숏커버(판 걸 되삼)" && net5 > 0 ? "better" : "flat";
  return {
    key: "fut", title: "외국인 선물(코스피200)", tone, series,
    value: `5일 ${net5 > 0 ? "+" : ""}${net5.toLocaleString()}계약`,
    text: `최근 5거래일 외국인 ${net5 >= 0 ? "순매수" : "순매도"} ${Math.abs(net5).toLocaleString()}계약 · 미결제 ${doi >= 0 ? "+" : ""}${doi.toLocaleString()}(${kind}).`,
  };
}

/** ② 외국인 코스피 현물 — 최근 5일 하루 평균 순매도를 '급락기(가장 많이 판 5일)'와 견준다 */
export function spotGauge(flow: MarketFlowPoint[]): Gauge | null {
  const f = [...flow].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  if (f.length < 10) return null;
  const daily = f.map(x => x.foreigners);
  const recent = avg(daily.slice(-5));
  // 60일 중 5일 이동평균이 가장 낮았던 구간 = 매도가 가장 심했던 때
  let worst = 0, worstEnd = "";
  for (let i = 4; i < daily.length; i++) { const a = avg(daily.slice(i - 4, i + 1)); if (a < worst) { worst = a; worstEnd = f[i].date; } }
  const ratio = worst < 0 ? recent / worst : 0;   // 1 = 그때만큼, 0 = 안 판다
  const tone: Tone = recent >= 0 ? "better" : ratio >= 0.7 ? "worse" : ratio <= 0.4 ? "better" : "flat";
  let cum = 0; const series = daily.map(v => (cum += v));
  return {
    key: "spot", title: "외국인 현물(코스피)", tone, series,
    value: `하루 ${eok(recent)}`,
    text: recent >= 0 ? `최근 5일 하루 평균 ${eok(recent)} 순매수.`
      : `최근 5일 하루 평균 ${eok(recent)} — 가장 심했던 때(${worstEnd.slice(5)} 무렵 하루 ${eok(worst)})의 ${Math.round(ratio * 100)}% 수준.`,
  };
}

/** ③ 대차잔고(대형주 합) — 20일 증감. 줄면 빌린 주식 상환 = 하방 포지션 축소 */
export function lendingGauge(byStock: { name: string; pts: LendingTradingPoint[] }[]): Gauge | null {
  const ok = byStock.filter(s => s.pts.length >= 21);
  if (!ok.length) return null;
  // 날짜를 맞춰 금액 합(종목마다 날짜가 같다고 보고 뒤에서부터 맞춘다)
  const n = Math.min(...ok.map(s => s.pts.length), 60);
  const series = Array.from({ length: n }, (_, i) => sum(ok.map(s => { const p = [...s.pts].sort((a, b) => a.date.localeCompare(b.date)); return p[p.length - n + i].balanceAmount; })));
  const now = series[n - 1], before = series[Math.max(0, n - 21)];
  const chg = before > 0 ? (now / before - 1) * 100 : 0;
  const tone: Tone = chg <= -5 ? "better" : chg >= 5 ? "worse" : "flat";
  return {
    key: "lend", title: `대차잔고(${ok.map(s => s.name).join("·")})`, tone, series,
    value: `20일 ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`,
    text: `대차잔고 ${(now / 1e12).toFixed(1)}조원, 20거래일 전보다 ${chg >= 0 ? "늘었다" : "줄었다"}(${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%) — ${chg < 0 ? "빌린 주식 상환 = 공매도 대기 물량 축소" : "빌린 주식 증가 = 공매도 대기 물량 증가"}.`,
  };
}

/** ④ 공매도 비중(대형주 평균) — 최근 5일 vs 그 전 20일 */
export function shortGauge(byStock: { name: string; pts: ShortSellingPoint[] }[]): Gauge | null {
  const ok = byStock.filter(s => s.pts.length >= 25);
  if (!ok.length) return null;
  const n = Math.min(...ok.map(s => s.pts.length), 60);
  const series = Array.from({ length: n }, (_, i) => avg(ok.map(s => { const p = [...s.pts].sort((a, b) => a.date.localeCompare(b.date)); return p[p.length - n + i].amountRatio; })));
  const recent = avg(series.slice(-5)), base = avg(series.slice(-25, -5));
  const tone: Tone = recent <= base * 0.8 ? "better" : recent >= base * 1.2 ? "worse" : "flat";
  return {
    key: "short", title: `공매도 비중(${ok.map(s => s.name).join("·")})`, tone, series,
    value: `${recent.toFixed(1)}%`,
    text: `최근 5일 거래대금 대비 공매도 ${recent.toFixed(1)}% — 그 전 20일(${base.toFixed(1)}%)보다 ${recent < base ? "낮다" : "높다"}.`,
  };
}

/** ⑤ 코스피200 옵션 — 풋/콜 미결제 비율과 오늘 풋 미결제 증감(오늘 하루치) */
export function optionGauge(o: { callOi: number; putOi: number; callOiChg: number; putOiChg: number } | null | undefined): Gauge | null {
  if (!o || !(o.callOi > 0)) return null;
  const pcr = o.putOi / o.callOi;
  const tone: Tone = o.putOiChg < 0 && pcr < 1.2 ? "better" : o.putOiChg > 0 && pcr >= 1 ? "worse" : "flat";
  return {
    key: "opt", title: "옵션 풋/콜(코스피200, 오늘)", tone,
    value: `풋/콜 ${pcr.toFixed(2)}`,
    text: `미결제 풋/콜 ${pcr.toFixed(2)} · 오늘 풋 미결제 ${o.putOiChg >= 0 ? "+" : ""}${o.putOiChg.toLocaleString()} / 콜 ${o.callOiChg >= 0 ? "+" : ""}${o.callOiChg.toLocaleString()} — ${o.putOiChg < 0 ? "하방 베팅(풋) 정리 중" : "하방 베팅(풋) 늘어남"}.`,
  };
}

/** ⑥ 변동성(V-KOSPI) — 20 경계·30 공포, 최근 방향 */
export function volGauge(vk: { price: number; pct: number } | null | undefined): Gauge | null {
  if (!vk || !(vk.price > 0)) return null;
  const tone: Tone = vk.price >= 30 && vk.pct >= 0 ? "worse" : vk.pct <= -3 || vk.price < 20 ? "better" : "flat";
  return {
    key: "vol", title: "변동성(V-KOSPI)", tone,
    value: `${vk.price.toFixed(2)}`,
    text: `V-KOSPI ${vk.price.toFixed(2)}(${vk.pct >= 0 ? "+" : ""}${vk.pct.toFixed(2)}%) — ${vk.price >= 30 ? "공포 구간" : vk.price >= 20 ? "경계 구간" : "안정 구간"}${vk.pct <= -3 ? ", 빠르게 내려오는 중" : vk.pct >= 3 ? ", 다시 오르는 중" : ""}.`,
  };
}

export function verdict(gs: Gauge[]): { text: string; tone: Tone } {
  const b = gs.filter(g => g.tone === "better").length, w = gs.filter(g => g.tone === "worse").length;
  if (!gs.length) return { text: "자료를 받는 중입니다", tone: "flat" };
  if (b >= w + 2) return { text: `하방 압력 완화 쪽 — ${gs.length}개 중 ${b}개가 완화 신호`, tone: "better" };
  if (w >= b + 2) return { text: `하방 압력 여전 — ${gs.length}개 중 ${w}개가 강화 신호`, tone: "worse" };
  return { text: `엇갈림 — 완화 ${b} · 강화 ${w} · 그대로 ${gs.length - b - w}`, tone: "flat" };
}
