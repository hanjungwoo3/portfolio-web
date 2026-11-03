// KODEX 200(시총가중) ↔ KODEX 200동일가중 한 줄 해석 — 오늘 오름·내림이 몇 종목(대형주) 탓인지 고른 흐름인지(사용자 2026-11-03 "금리 읽기처럼").
//   차이(동일가중 − 시총가중) 0.5%p 이상이면 쏠림으로 본다. 삼성전자·SK하이닉스가 코스피200 의 절반 가까이라 차이 = 대개 두 종목.
export type BreadthTone = "good" | "warn" | "bad" | "calm" | "flat";
export function readBreadth(k: number, ew: number): { text: string; tone: BreadthTone } {
  const gap = ew - k;
  const G = 0.5;
  if (Math.abs(k) < 0.15 && Math.abs(ew) < 0.15) return { text: "오늘은 대형주·중소형주 모두 거의 그대로입니다.", tone: "flat" };
  if (Math.abs(gap) < G) {
    return k >= 0 ? { text: "대부분 종목이 고르게 오르는 장입니다.", tone: "good" }
                  : { text: "대부분 종목이 고르게 내리는 장입니다.", tone: "bad" };
  }
  if (gap <= -G) {   // 시총가중이 더 좋다 = 대형주가 지수를 끌어올림(또는 덜 빠짐)
    return k >= 0 && ew < 0 ? { text: "대형주(반도체)만 오르고 나머지는 내리는 쏠림 장입니다.", tone: "warn" }
         : k >= 0 ? { text: "대형주(반도체)가 지수를 끌어올리는 장입니다 — 나머지는 덜 올랐습니다.", tone: "warn" }
         : { text: "대형주는 덜 빠지고 나머지 종목이 더 많이 내렸습니다.", tone: "bad" };
  }
  // 동일가중이 더 좋다 = 대형주가 약하고 나머지가 버팀
  return k < 0 && ew >= 0 ? { text: "대형주(반도체)만 빠지고 나머지 종목은 오르는 장입니다.", tone: "calm" }
       : k < 0 ? { text: "대형주(반도체)가 지수를 끌어내리는 장입니다 — 나머지는 덜 빠졌습니다.", tone: "calm" }
       : { text: "중소형주가 대형주보다 더 고르게 오르는 장입니다.", tone: "good" };
}

// V-KOSPI(코스피200 변동성 지수, '한국판 공포지수') 한 줄 — 수준 + 오늘 변화. 기준은 한국 시장 관행(20 아래 안정, 30 넘으면 불안, 40 넘으면 공포).
export function readVkospi(level: number, chgPct: number): { text: string; tone: BreadthTone } {
  // 변화가 작으면 꼬리말을 붙이지 않는다(사용자 2026-11-03 "변화가 없으면 표시 안 해도")
  const dir = chgPct >= 3 ? " — 오늘 불안이 커졌습니다" : chgPct <= -3 ? " — 오늘 불안이 줄었습니다" : "";
  if (level >= 40) return { text: `공포 구간(40 이상)입니다${dir}.`, tone: "bad" };
  if (level >= 30) return { text: `불안이 큰 편(30 이상)입니다${dir}.`, tone: "warn" };
  if (level >= 20) return { text: `보통 수준입니다${dir}.`, tone: "flat" };
  return { text: `안정 구간(20 아래)입니다${dir}.`, tone: "good" };
}

// 코스피 ↔ 닛케이·상해 — 같은 시간에 열리는 아시아 장과 같이 움직이나(바깥 요인) 한국만 따로 움직이나(한국 요인).
export function readAsia(k: number, others: number[]): { text: string; tone: BreadthTone } {
  const xs = others.filter(Number.isFinite);
  if (!xs.length) return { text: "아시아 시장 값이 아직 없습니다.", tone: "flat" };
  const avg = xs.reduce((a, v) => a + v, 0) / xs.length;
  const T = 1;   // 코스피와 아시아 평균 차이 1%p 이상이면 '한국만'
  if (Math.abs(k) < 0.3 && Math.abs(avg) < 0.3) return { text: "아시아가 모두 조용합니다.", tone: "flat" };
  if (k - avg <= -T) return { text: "한국만 더 약합니다 — 한국 쪽 요인(반도체·수급)을 볼 때입니다.", tone: "bad" };
  if (k - avg >= T) return { text: "한국만 더 강합니다 — 한국 쪽 호재가 있는 장입니다.", tone: "good" };
  return k >= 0 ? { text: "아시아가 함께 오릅니다 — 바깥(미국·글로벌) 영향이 큽니다.", tone: "good" }
                : { text: "아시아가 함께 내립니다 — 바깥(미국·글로벌) 영향이 큽니다.", tone: "bad" };
}

// 미국 투심 셋 — 수준 구간 + 크게 움직인 날만 꼬리말(사용자 2026-11-03 "공포/탐욕·VIX·MOVE 설명도, 요약만")
//   VIX(S&P500 옵션 변동성, 미국판 공포지수): 15 아래 안정 · 20 이상 불안 · 30 이상 공포 — 하루 ±10% 이상이면 꼬리말
export function readVix(level: number, chgPct: number): { text: string; tone: BreadthTone } {
  const dir = chgPct >= 10 ? " — 오늘 급등" : chgPct <= -10 ? " — 오늘 급락" : "";
  if (level >= 30) return { text: `VIX 공포 구간(30 이상)${dir}`, tone: "bad" };
  if (level >= 20) return { text: `VIX 불안(20 이상)${dir}`, tone: "warn" };
  if (level >= 15) return { text: `VIX 보통${dir}`, tone: "flat" };
  return { text: `VIX 안정(15 아래)${dir}`, tone: "good" };
}
//   MOVE(미 국채 옵션 변동성, 채권판 공포지수): 80 아래 안정 · 100 이상 불안 · 120 이상 공포 — 하루 ±5% 이상이면 꼬리말
export function readMove(level: number, chgPct: number): { text: string; tone: BreadthTone } {
  const dir = chgPct >= 5 ? " — 오늘 급등" : chgPct <= -5 ? " — 오늘 급락" : "";
  if (level >= 120) return { text: `채권 변동성(MOVE) 공포 구간${dir}`, tone: "bad" };
  if (level >= 100) return { text: `채권 변동성(MOVE) 불안${dir}`, tone: "warn" };
  if (level >= 80) return { text: `채권 변동성(MOVE) 보통${dir}`, tone: "flat" };
  return { text: `채권 변동성(MOVE) 안정${dir}`, tone: "good" };
}
//   CNN 공포·탐욕(0~100): 25 아래 극단적 공포 · 45 아래 공포 · 55 이하 중립 · 75 이하 탐욕 · 그 위 극단적 탐욕 — 하루 ±5점 이상이면 꼬리말.
//   극단적 공포는 역발상으로 '바닥 신호' 로 읽기도 해 tone 은 calm(하늘)
export function readFearGreed(score: number, chg: number): { text: string; tone: BreadthTone } {
  const dir = chg >= 5 ? " — 오늘 탐욕 쪽으로" : chg <= -5 ? " — 오늘 공포 쪽으로" : "";
  if (score < 25) return { text: `시장 심리 극단적 공포${dir}`, tone: "calm" };
  if (score < 45) return { text: `시장 심리 공포${dir}`, tone: "bad" };
  if (score <= 55) return { text: `시장 심리 중립${dir}`, tone: "flat" };
  if (score <= 75) return { text: `시장 심리 탐욕${dir}`, tone: "good" };
  return { text: `시장 심리 극단적 탐욕${dir}`, tone: "warn" };
}
