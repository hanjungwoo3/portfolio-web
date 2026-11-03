// 명목 10Y ↔ 실질 10Y(TIPS) 한 줄 해석 — 환율·금리·투심 그룹 아래. 카드에 떠 있는 **실제 값**으로 계산한다.
//   기대인플레이션(BEI) = 명목 − 실질. 오늘 변화(bp)로 '금리가 왜 움직였나' 를 가른다:
//     명목만 오르고 실질은 그대로 → 물가 기대 탓(BEI ↑)
//     실질이 같이 오른다          → 진짜 돈값 상승 — 성장주·금에 부담
//     실질이 내린다              → 성장주·금에 우호
import type { UsIndex } from "../lib/api";
import { readRealRate, type RateTone } from "../lib/realRate";
import { readFearGreed, readMove, readVix } from "../lib/breadth";

// 해석 강조색 — 성장주·금 입장: 부담(주황) · 물가 기대 ↑(노랑) · 우호(초록) · 물가 기대 ↓(하늘) · 변화 없음(회색)
const TONE: Record<RateTone, string> = {
  bad: "bg-orange-100 text-orange-800 border-orange-300",
  warn: "bg-amber-50 text-amber-800 border-amber-300",
  good: "bg-emerald-50 text-emerald-800 border-emerald-300",
  calm: "bg-sky-50 text-sky-800 border-sky-300",
  flat: "bg-gray-100 text-gray-600 border-gray-300",
};

const bp = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}bp`;

// 환율·금리·투심 읽기 — 해석 요약만 한 줄(숫자는 카드에, 사용자 2026-11-03): 금리(명목 vs 실질) · VIX · MOVE · CNN 공포·탐욕
export function RealRateNote({ usMap, small = false }: { usMap: Map<string, UsIndex>; small?: boolean }) {
  const chips: { key: string; text: string; tone: RateTone; tip: string }[] = [];
  const n = usMap.get("^TNX"), r = usMap.get("^TIPS10");
  if (n && r && n.price > 0 && r.price > 0) {
    const dn = n.price - n.prevClose, dr = r.price - r.prevClose;
    const read = readRealRate(dn, dr);
    chips.push({ key: "rate", text: `금리: ${read.text}`, tone: read.tone,
      tip: `금리 읽기 — 명목 10Y ${n.price.toFixed(2)}%(${bp(dn)}) − 실질 10Y ${r.price.toFixed(2)}%(${bp(dr)}) = 기대인플레 ${(n.price - r.price).toFixed(2)}%. 실질금리가 오르면 성장주·금에 부담, 내리면 우호.` });
  }
  const chg = (q?: UsIndex) => (q && q.prevClose > 0 ? (q.price / q.prevClose - 1) * 100 : 0);
  const v = usMap.get("^VIX");
  if (v && v.price > 0) { const t = readVix(v.price, chg(v)); chips.push({ key: "vix", ...t, tip: `VIX ${v.price.toFixed(2)} — S&P500 옵션으로 본 앞으로 한 달 예상 변동폭(미국판 공포지수). 15 아래 안정 · 20 이상 불안 · 30 이상 공포.` }); }
  const m = usMap.get("^MOVE");
  if (m && m.price > 0) { const t = readMove(m.price, chg(m)); chips.push({ key: "move", ...t, tip: `MOVE ${m.price.toFixed(2)} — 미 국채 옵션으로 본 금리 변동성(채권판 VIX). 80 아래 안정 · 100 이상 불안 · 120 이상 공포.` }); }
  const f = usMap.get("CNNFG");
  if (f && f.price > 0) { const t = readFearGreed(f.price, f.price - (f.prevClose || f.price)); chips.push({ key: "fg", ...t, tip: `CNN 공포·탐욕 ${Math.round(f.price)}점 — VIX·풋콜·정크본드 등 7개 지표 합성(0 극단적 공포 ~ 100 극단적 탐욕). 극단적 공포는 역발상으로 바닥 신호로 보기도 합니다.` }); }
  if (!chips.length) return null;
  return (
    <div className={`${small ? "text-[10px]" : "text-[11px]"} leading-snug rounded-md bg-gray-50 border border-gray-200 px-2 py-1 pg-note flex flex-wrap items-center gap-x-2 gap-y-0.5`}>
      {chips.map(c => <span key={c.key} title={c.tip} className={`inline-block font-bold px-1.5 rounded border ${TONE[c.tone]}`}>{c.text}</span>)}
    </div>
  );
}
