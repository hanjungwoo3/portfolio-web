// 시황 분석 — '하방 압력 계기판'(사용자 2026-11-20, 삼프로 "극도로 쏠렸던 공매도의 끝자락" 영상의 수급·파생 신호를 숫자로).
//   지표마다 지금 상태를 '하방 강화 / 그대로 / 완화' 셋 중 하나로 판정한다. 예측이 아니라 **지금 상태** 설명.
//   계산은 여기(순수 함수), 그리기·받기는 components/MarketPressureCard.
import type { KrFuturesDay, LendingTradingPoint, MarketFlowPoint, ShortSellingPoint } from "./api";

export type Tone = "worse" | "flat" | "better";   // 하방 강화 · 그대로 · 완화
export interface Gauge { key: string; title: string; tone: Tone; value: string; text: string; help?: string; series?: number[]; rule?: string }   // rule = 판정 기준(사용자 2026-11-21 "그대로의 이유?")   // help = 초보용 설명

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
    rule: "5일 순매수 −3,000계약 이하(숏커버가 아닐 때)·신규 매도면 하방 강화 · +3,000계약 이상(신규 매도가 아닐 때)·숏커버면 완화 · 그 사이는 그대로",
    value: `5일 ${net5 > 0 ? "+" : ""}${net5.toLocaleString()}계약`,
    text: `최근 5일 외국인이 선물을 ${Math.abs(net5).toLocaleString()}계약 ${net5 >= 0 ? "샀습니다" : "팔았습니다"}. 시장 전체로는 ${kind === "신규 매도" ? "주가가 빠지는 동안 새로 '하락에 거는' 계약이 늘었습니다" : kind === "숏커버(판 걸 되삼)" ? "'하락에 걸었던' 계약을 되사서 정리하고 있습니다(오를 힘)" : kind === "신규 매수" ? "'상승에 거는' 계약이 새로 늘었습니다" : kind === "매수 정리" ? "'상승에 걸었던' 계약을 정리하고 있습니다" : "계약 수에 큰 변화가 없습니다"}.`,
    help: "선물 = 지수가 오를지 내릴지에 돈을 거는 계약. 외국인이 선물을 팔면 '더 내린다'에 거는 것이라 지수를 누르는 힘이 됩니다. 미결제약정(아직 정리 안 한 계약 수)이 늘면 새 베팅, 줄면 정리입니다.",
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
    rule: "최근 순매수면 완화 · 순매도라도 가장 많이 판 날 대비 40% 이하로 줄었으면 완화, 70% 이상이면 하방 강화 · 그 사이는 그대로",
    value: `하루 ${eok(recent)}`,
    text: recent >= 0 ? `최근 5일 외국인이 코스피 주식을 하루 평균 ${eok(recent)}씩 샀습니다.`
      : `최근 5일 외국인이 하루 평균 ${eok(recent).replace("−", "")}씩 팔았습니다. 가장 많이 팔던 때(${worstEnd.slice(5)} 무렵 하루 ${eok(worst).replace("−", "")})의 ${Math.round(ratio * 100)}% 정도라 파는 힘이 ${ratio <= 0.4 ? "많이 약해졌습니다" : ratio >= 0.7 ? "여전히 셉니다" : "조금 약해졌습니다"}.`,
    help: "현물 = 실제 주식. 외국인은 한국 증시의 가장 큰손이라, 외국인이 계속 팔면 지수가 오르기 어렵습니다. 파는 양이 줄어드는지가 핵심입니다.",
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
    rule: "두 종목 합친 대차잔고가 20거래일 전보다 5% 넘게 줄면 완화, 5% 넘게 늘면 하방 강화 · ±5% 안은 그대로(종목 하나만 크게 늘어도 합치면 묻힐 수 있다)",
    value: `20일 ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`,
    text: `빌려 간 주식이 ${(now / 1e12).toFixed(1)}조원어치로, 한 달(20거래일) 전보다 ${Math.abs(chg).toFixed(1)}% ${chg >= 0 ? "늘었습니다 — 공매도로 팔 준비를 하는 물량이 늘어난 것" : "줄었습니다 — 빌린 주식을 갚는 중이라 공매도 걱정이 줄어든 것"}입니다.`,
    help: "대차잔고 = 남에게 빌려 간 주식의 양. 공매도는 주식을 빌려서 먼저 팔고 나중에 싸게 사서 갚는 것이라, 빌린 주식이 많으면 '팔 준비 물량'이 많다는 뜻입니다.",
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
    rule: "최근 5일 평균 공매도 비중이 그 전 한 달보다 20% 넘게 낮으면 완화, 20% 넘게 높으면 하방 강화 · ±20% 안은 그대로",
    value: `${recent.toFixed(1)}%`,
    text: `최근 5일 거래 100원 중 ${recent.toFixed(1)}원이 공매도였습니다. 그 전 한 달(${base.toFixed(1)}원)보다 ${recent < base ? "줄어 하락에 거는 쪽이 덜 판다는 뜻" : "늘어 하락에 거는 쪽이 더 판다는 뜻"}입니다.`,
    help: "공매도 비중 = 하루 거래 중 '빌려서 판' 거래의 비율. 높을수록 주가 하락에 거는 사람이 많다는 뜻입니다.",
  };
}

/** ⑤ 코스피200 옵션 — 풋/콜 미결제 비율과 오늘 풋 미결제 증감(오늘 하루치) */
export function optionGauge(o: { callOi: number; putOi: number; callOiChg: number; putOiChg: number } | null | undefined): Gauge | null {
  if (!o || !(o.callOi > 0)) return null;
  const pcr = o.putOi / o.callOi;
  const tone: Tone = o.putOiChg < 0 && pcr < 1.2 ? "better" : o.putOiChg > 0 && pcr >= 1 ? "worse" : "flat";
  return {
    key: "opt", title: "옵션 풋/콜(코스피200, 오늘)", tone,
    rule: "풋 미결제가 줄고 풋/콜 1.2 미만이면 완화 · 풋 미결제가 늘고 풋/콜 1 이상이면 하방 강화 · 나머지는 그대로",
    value: `풋/콜 ${pcr.toFixed(2)}`,
    text: `'하락 보험(풋)'이 '상승 베팅(콜)'의 ${pcr.toFixed(2)}배 걸려 있습니다(1보다 크면 하락 대비가 더 많음). 오늘 풋은 ${o.putOiChg >= 0 ? `${o.putOiChg.toLocaleString()}계약 늘어 하락 대비를 더 하는 중` : `${Math.abs(o.putOiChg).toLocaleString()}계약 줄어 하락 대비를 푸는 중`}입니다.`,
    help: "옵션 = 정해진 가격에 사거나 팔 권리. 풋은 '내리면 돈 버는' 보험, 콜은 '오르면 돈 버는' 베팅입니다. 풋이 줄면 사람들이 하락 걱정을 덜 한다는 뜻입니다.",
  };
}

/** ⑥ 변동성(V-KOSPI) — 20 경계·30 공포, 최근 방향 */
export function volGauge(vk: { price: number; pct: number } | null | undefined): Gauge | null {
  if (!vk || !(vk.price > 0)) return null;
  const tone: Tone = vk.price >= 30 && vk.pct >= 0 ? "worse" : vk.pct <= -3 || vk.price < 20 ? "better" : "flat";
  return {
    key: "vol", title: "변동성(V-KOSPI)", tone,
    rule: "30 이상이면서 오늘 오르면 하방 강화 · 오늘 3% 넘게 내리거나 20 미만이면 완화 · 나머지(30 이상이라도 안 오르면)는 그대로",
    value: `${vk.price.toFixed(2)}`,
    text: `${vk.price.toFixed(2)} — ${vk.price >= 30 ? "공포 구간(30 이상)" : vk.price >= 20 ? "경계 구간(20~30)" : "안정 구간(20 미만)"}입니다${vk.pct <= -3 ? ". 오늘 크게 내려 불안이 가라앉는 중" : vk.pct >= 3 ? ". 오늘 올라 불안이 커지는 중" : ""}.`,
    help: "V-KOSPI = 앞으로 코스피가 얼마나 크게 출렁일지 시장이 예상하는 값('공포 지수'). 높을수록 사람들이 불안해한다는 뜻입니다.",
  };
}

export function verdict(gs: Gauge[]): { text: string; tone: Tone } {
  const b = gs.filter(g => g.tone === "better").length, w = gs.filter(g => g.tone === "worse").length;
  if (!gs.length) return { text: "자료를 받는 중입니다", tone: "flat" };
  if (b >= w + 2) return { text: `누르는 힘이 약해지는 쪽 — ${gs.length}개 중 ${b}개가 완화`, tone: "better" };
  if (w >= b + 2) return { text: `누르는 힘이 아직 셈 — ${gs.length}개 중 ${w}개가 하방 강화`, tone: "worse" };
  return { text: `아직 뚜렷하지 않음 — 완화 ${b} · 하방 강화 ${w} · 그대로 ${gs.length - b - w}`, tone: "flat" };
}
