// 명목 10Y ↔ 실질 10Y(TIPS) 한 줄 해석 — 환율·금리·투심 그룹 아래. 카드에 떠 있는 **실제 값**으로 계산한다.
//   기대인플레이션(BEI) = 명목 − 실질. 오늘 변화(bp)로 '금리가 왜 움직였나' 를 가른다:
//     명목만 오르고 실질은 그대로 → 물가 기대 탓(BEI ↑)
//     실질이 같이 오른다          → 진짜 돈값 상승 — 성장주·금에 부담
//     실질이 내린다              → 성장주·금에 우호
import type { UsIndex } from "../lib/api";
import { readRealRate, type RateTone } from "../lib/realRate";

// 해석 강조색 — 성장주·금 입장: 부담(주황) · 물가 기대 ↑(노랑) · 우호(초록) · 물가 기대 ↓(하늘) · 변화 없음(회색)
const TONE: Record<RateTone, string> = {
  bad: "bg-orange-100 text-orange-800 border-orange-300",
  warn: "bg-amber-50 text-amber-800 border-amber-300",
  good: "bg-emerald-50 text-emerald-800 border-emerald-300",
  calm: "bg-sky-50 text-sky-800 border-sky-300",
  flat: "bg-gray-100 text-gray-600 border-gray-300",
};

const bp = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}bp`;

export function RealRateNote({ usMap, small = false }: { usMap: Map<string, UsIndex>; small?: boolean }) {
  const n = usMap.get("^TNX"), r = usMap.get("^TIPS10");
  if (!n || !r || !(n.price > 0) || !(r.price > 0)) return null;
  const dn = n.price - n.prevClose, dr = r.price - r.prevClose;   // 오늘 변화(%p)
  const bei = n.price - r.price, dBei = dn - dr;
  const read = readRealRate(dn, dr);
  return (
    <div className={`${small ? "text-[10px]" : "text-[11px]"} text-gray-600 leading-snug rounded-md bg-gray-50 border border-gray-200 px-2 py-1`}>
      <b>금리 읽기</b> · 명목 10Y {n.price.toFixed(2)}% ({bp(dn)}) − 실질 10Y {r.price.toFixed(2)}% ({bp(dr)})
      {" "}= 기대인플레 <b>{bei.toFixed(2)}%</b> ({bp(dBei)}).{" "}
      <span className={`inline-block font-bold px-1.5 rounded border ${TONE[read.tone]}`}>{read.text}</span>
    </div>
  );
}
