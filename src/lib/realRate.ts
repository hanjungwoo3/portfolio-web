// 명목 10Y ↔ 실질 10Y(TIPS) 오늘 변화로 '금리가 왜 움직였나' 를 한 줄로.
//   dn·dr = 오늘 변화(%p). 1bp 미만은 '그대로'. tone = 성장주·금 입장에서 좋은가(good)·나쁜가(bad)·중립.
export type RateTone = "bad" | "warn" | "good" | "calm" | "flat";
export function readRealRate(dn: number, dr: number): { text: string; tone: RateTone } {
  const q = 0.01;
  if (Math.abs(dn) < q && Math.abs(dr) < q) return { text: "오늘은 명목·실질 모두 거의 그대로입니다.", tone: "flat" };
  if (dr >= q && dr >= dn * 0.5) return { text: "실질금리가 함께 올랐습니다 — 돈값 자체가 오른 것이라 성장주·금에 부담입니다.", tone: "bad" };
  if (dn >= q) return { text: "명목만 오르고 실질은 덜 올랐습니다 — 물가 기대가 오른 것(기대인플레 ↑)이라 성장주 부담은 상대적으로 작습니다.", tone: "warn" };
  if (dr <= -q) return { text: "실질금리가 내렸습니다 — 성장주·금에 우호적입니다.", tone: "good" };
  return { text: "명목이 내렸지만 실질은 그대로입니다 — 물가 기대가 낮아진 것입니다.", tone: "calm" };
}
