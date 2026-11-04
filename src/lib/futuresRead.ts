// 외국인 K200 선물 · 시장 미결제 그래프 읽기 — 숫자를 사람 말로(사용자 2026-11-04 "이 그래프 분석을 오른쪽에").
//   결론 먼저(지금 외국인이 어느 쪽인가) → 근거 한 줄씩. 규칙 기반이라 예측이 아니라 '지금 상태' 설명이다.
//   미결제 해석(가격과 같이 봐야 뜻이 생긴다): 미결제↑·가격↑ = 신규 매수 / 미결제↑·가격↓ = 신규 매도 /
//   미결제↓·가격↑ = 숏커버(판 걸 되삼) / 미결제↓·가격↓ = 청산 매도(산 걸 정리).
export type ReadTone = "up" | "down" | "flat" | "warn";
export interface ReadLine { label: string; text: string; tone: ReadTone }
export interface FuturesRead { head: { text: string; tone: ReadTone }; lines: ReadLine[] }

export interface FuturesReadInput {
  cum: number;                         // 외국인 누적(억원)
  ext?: { v: number; t: string } | null;   // 장중 극값(지금 부호 쪽)
  recov?: number | null;               // 정리율 %(극값에서 되돌린 비율)
  d15?: number | null;                 // 최근 15분 변화(억원)
  oi?: { doi: number; dp: number; min: number } | null;   // 최근 미결제 변화(계약)·선물가 변화·잰 분
  spot?: number | null;                // 현물(코스피) 외국인 누적(억원)
}

const NEAR = 100;   // 15분에 100억 미만이면 '큰 움직임 없음'
const OI_MIN = 100; // 미결제 100계약 미만 변화는 '작음'
const eok = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString()}억`;

export function oiKind(doi: number, dp: number): "newBuy" | "newSell" | "cover" | "liq" | "flat" {
  if (Math.abs(doi) < OI_MIN) return "flat";
  return doi > 0 ? (dp >= 0 ? "newBuy" : "newSell") : (dp >= 0 ? "cover" : "liq");
}

export function readFutures(x: FuturesReadInput): FuturesRead {
  const lines: ReadLine[] = [];
  // ① 외국인 누적 — 극값에서 얼마나 되돌렸나
  const r = x.recov ?? 0;
  if (x.cum > 0) {
    lines.push(r >= 50 && x.ext
      ? { label: "외국인", text: `장중 최고 ${eok(x.ext.v)}에서 ${Math.round(r)}%를 되팔아 지금 ${eok(x.cum)}입니다. 산 물량을 정리하는 중이라 매수 힘이 빠지고 있습니다.`, tone: "warn" }
      : { label: "외국인", text: `오늘 선물 ${eok(x.cum)} 순매수를 유지하고 있습니다.`, tone: "up" });
  } else if (x.cum < 0) {
    lines.push(r >= 50 && x.ext
      ? { label: "외국인", text: `장중 최저 ${eok(x.ext.v)}에서 ${Math.round(r)}%를 되사 지금 ${eok(x.cum)}입니다. 판 물량을 거둬들이는 중이라 매도 압력이 줄고 있습니다.`, tone: "warn" }
      : { label: "외국인", text: `오늘 선물 ${eok(x.cum)} 순매도를 유지하고 있습니다.`, tone: "down" });
  } else {
    lines.push({ label: "외국인", text: "오늘 선물 순매수·순매도가 거의 없습니다.", tone: "flat" });
  }
  // ② 최근 15분
  const d = x.d15;
  if (d != null) {
    lines.push(Math.abs(d) < NEAR
      ? { label: "최근 15분", text: `${eok(d)}로 큰 움직임은 없습니다.`, tone: "flat" }
      : { label: "최근 15분", text: d > 0 ? `${eok(d)} 사들이는 중입니다.` : `${eok(d)} 파는 중입니다.`, tone: d > 0 ? "up" : "down" });
  }
  // ③ 미결제 — 가격과 같이
  const k = x.oi ? oiKind(x.oi.doi, x.oi.dp) : null;
  if (x.oi && k) {
    const span = `최근 ${x.oi.min}분 미결제 ${x.oi.doi > 0 ? "+" : ""}${x.oi.doi.toLocaleString()}계약`;
    const t: Record<typeof k, ReadLine> = {
      newBuy: { label: "미결제", text: `${span}·가격 상승 — 새로 사는 돈(상승 베팅)이 들어오고 있습니다.`, tone: "up" },
      newSell: { label: "미결제", text: `${span}·가격 하락 — 새로 파는 돈(하락 베팅)이 들어오고 있습니다.`, tone: "down" },
      cover: { label: "미결제", text: `${span}·가격 상승 — 판 계약을 되사는 숏커버로 오르는 중입니다(새 매수세는 아님).`, tone: "warn" },
      liq: { label: "미결제", text: `${span}·가격 하락 — 산 계약을 정리하는 매도로 내리는 중입니다(새 매도세는 아님).`, tone: "warn" },
      flat: { label: "미결제", text: `${span} — 변화가 작아 방향을 말하기 어렵습니다.`, tone: "flat" },
    };
    lines.push(t[k]);
  }
  // ④ 현물과 같은 쪽인가
  if (x.spot != null && x.cum !== 0) {
    const same = Math.sign(x.spot) === Math.sign(x.cum);
    lines.push(same
      ? { label: "현물", text: `코스피 현물도 ${eok(x.spot)}로 같은 방향입니다. 선물·현물 ${x.cum > 0 ? "동반 매수" : "동반 매도"}라 신호가 강합니다.`, tone: x.cum > 0 ? "up" : "down" }
      : { label: "현물", text: `코스피 현물은 ${eok(x.spot)}로 반대입니다. 선물만 ${x.cum > 0 ? "사고" : "팔고"} 있어 헤지(위험 상쇄)일 수 있습니다.`, tone: "warn" });
  }
  // 결론 — 지금(최근 15분) 방향을 먼저, 미결제 성격을 붙인다
  let head: FuturesRead["head"];
  if (d != null && d <= -NEAR) {
    head = { text: `지금 외국인은 선물을 파는 쪽입니다${k === "newSell" ? " — 하락 베팅이 새로 들어옵니다" : k === "liq" ? " — 산 물량을 정리하는 매도입니다" : ""}.`, tone: "down" };
  } else if (d != null && d >= NEAR) {
    head = { text: `지금 외국인은 선물을 사는 쪽입니다${k === "newBuy" ? " — 상승 베팅이 새로 들어옵니다" : k === "cover" ? " — 판 물량을 되사는 숏커버입니다" : ""}.`, tone: "up" };
  } else {
    head = { text: "지금 외국인 선물은 관망 중입니다 — 최근 15분 큰 움직임이 없습니다.", tone: "flat" };
  }
  return { head, lines };
}
