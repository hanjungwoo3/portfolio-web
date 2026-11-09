// 단타 보조 신호 — 1분 봉으로 '지금 급하게 움직이는 순간'을 잡는다(사용자 2026-11-09 "단타 보조 신호, 백테스트 넣어 보자").
//   실시간 신호(반도체 수급·종목정보의 '종목 신호')와 백테스트가 **같은 규칙**을 쓴다 — 규칙은 여기 한 벌.
//   주문은 하지 않는다(앱은 조회 전용). 판단과 주문은 사람이.
//   규칙은 가격·거래량만 쓰는 것(백테스트 가능 — 지난 1분봉으로 되짚을 수 있다)과 매수·매도 체결이 필요한 것(실시간만)으로 나눈다.

export interface Bar { t: string; close: number; vol: number; buy?: number; sell?: number }   // t = "HH:MM", buy·sell = 체결량(주) — 있으면
export type SignalKind = "volSpike" | "breakout" | "breakdown" | "strengthSurge";
export interface ScalpHit { kind: SignalKind; i: number; dir: "up" | "down"; text: string; detail: string }

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  volSpike: "거래량 급증 + 양봉",
  breakout: "30분 고점 돌파(거래량 동반)",
  breakdown: "30분 저점 이탈(거래량 동반)",
  strengthSurge: "체결강도 급등(1분 매수 쏠림)",
};
/** 백테스트 가능한 규칙(가격·거래량만) */
export const BACKTEST_KINDS: SignalKind[] = ["volSpike", "breakout", "breakdown"];

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** i 번째 봉에서 켜지는 신호들. 앞 봉 20~30개가 있어야 판정한다 */
export function signalsAt(bars: Bar[], i: number): ScalpHit[] {
  const out: ScalpHit[] = [];
  const b = bars[i], p = bars[i - 1];
  if (!b || !p || i < 20) return out;
  const v20 = avg(bars.slice(i - 20, i).map(x => x.vol));
  const volX = v20 > 0 ? b.vol / v20 : 0;
  // ① 거래량 급증 + 양봉 — 직전 20분 평균의 3배↑, 가격이 앞 분보다 올랐다
  if (volX >= 3 && b.close > p.close) out.push({ kind: "volSpike", i, dir: "up", text: `거래량 ${volX.toFixed(1)}배 + 상승`, detail: `${b.t} 1분 거래량이 직전 20분 평균의 ${volX.toFixed(1)}배, 가격 ${p.close.toLocaleString()}→${b.close.toLocaleString()}` });
  // ②③ 30분 고점 돌파·저점 이탈 — 거래량 2배↑ 동반
  if (i >= 30 && volX >= 2) {
    const prev = bars.slice(i - 30, i).map(x => x.close);
    const hi = Math.max(...prev), lo = Math.min(...prev);
    if (b.close > hi) out.push({ kind: "breakout", i, dir: "up", text: `30분 고점 ${hi.toLocaleString()} 돌파`, detail: `${b.t} 직전 30분 최고 ${hi.toLocaleString()} 위로, 거래량 ${volX.toFixed(1)}배` });
    if (b.close < lo) out.push({ kind: "breakdown", i, dir: "down", text: `30분 저점 ${lo.toLocaleString()} 이탈`, detail: `${b.t} 직전 30분 최저 ${lo.toLocaleString()} 아래로, 거래량 ${volX.toFixed(1)}배` });
  }
  // ④ 체결강도 급등 — 1분 체결강도 250↑ 이고 직전 5분 체결강도 120 미만(갑자기 사는 쪽이 몰림). 매수·매도 체결이 있을 때만(실시간)
  if (b.buy != null && b.sell != null && b.sell > 0) {
    const s1 = (b.buy / b.sell) * 100;
    const w = bars.slice(i - 5, i);
    const bb = w.reduce((a, x) => a + (x.buy ?? 0), 0), ss = w.reduce((a, x) => a + (x.sell ?? 0), 0);
    const s5 = ss > 0 ? (bb / ss) * 100 : null;
    if (s1 >= 250 && s5 != null && s5 < 120 && b.vol >= v20) out.push({ kind: "strengthSurge", i, dir: "up", text: `체결강도 ${Math.round(s1)} 급등`, detail: `${b.t} 1분 체결강도 ${Math.round(s1)}(직전 5분 ${Math.round(s5)}) — 갑자기 시장가 매수가 몰렸다` });
  }
  return out;
}

export interface BacktestRow { kind: SignalKind; n: number; win: number; avg: number; avgAfterCost: number; best: number; worst: number }
/** 백테스트 — 신호가 켜진 봉 종가에 샀다고 보고 h분 뒤 종가로 판 수익률(%). 하락 신호는 거꾸로(빠지면 이익).
 *  같은 날 안에서만(날짜를 넘기면 버린다), 같은 신호가 연달아 켜지면 h분 안의 것은 하나로 센다. cost = 왕복 비용(%) */
export function backtest(days: Bar[][], h: number, cost = 0.25): BacktestRow[] {
  const acc = new Map<SignalKind, number[]>();
  for (const bars of days) {
    const last = new Map<SignalKind, number>();
    for (let i = 0; i < bars.length - h; i++) {
      for (const s of signalsAt(bars, i)) {
        if (!BACKTEST_KINDS.includes(s.kind)) continue;
        if ((last.get(s.kind) ?? -1e9) > i - h) continue;
        last.set(s.kind, i);
        const r = (bars[i + h].close / bars[i].close - 1) * 100 * (s.dir === "up" ? 1 : -1);
        (acc.get(s.kind) ?? acc.set(s.kind, []).get(s.kind)!).push(r);
      }
    }
  }
  return BACKTEST_KINDS.map(kind => {
    const rs = acc.get(kind) ?? [];
    return { kind, n: rs.length, win: rs.length ? rs.filter(r => r - cost > 0).length / rs.length : 0,
      avg: avg(rs), avgAfterCost: avg(rs) - (rs.length ? cost : 0), best: rs.length ? Math.max(...rs) : 0, worst: rs.length ? Math.min(...rs) : 0 };
  });
}
