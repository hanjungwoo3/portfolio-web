// 지수(소부장) — 단계별 4칸(기판 / 전공정 / 후공정 / 소재·부품)을 **한 화면에**(사용자 2026-11-02 "한 줄씩 하지 말고 화면을 4등분").
//   칸마다 해외 대장주(테두리 굵게, 미국은 간밤·일본은 지금 장중) ➜ 국내 종목. 카드는 최신공시·히트맵과 같은 QuoteCard(24시간·3개월 설정 따름).
//   칸 제목 옆 = 국내 종목 평균 등락률(동일가중) — 오늘 어느 단계가 강한지. PC 2×2, 모바일 세로로 한 칸씩.
import { US_PAIRS } from "../lib/usMarketData";
import { QuoteCard } from "./QuoteCard";

const NAME = new Map(US_PAIRS.map(p => [p.symbol, p.name]));

export function SobuGrid({ rows, labels, leadByRow, quote }: {
  rows: string[][]; labels: string[]; leadByRow: number[];
  quote: (sym: string) => { price: number; pct: number } | undefined;
}) {
  // 다섯 단계 → 네 칸: 소재·부품을 한 칸으로
  const boxes: { label: string; lead: string[]; kr: string[] }[] = [];
  rows.forEach((r, i) => {
    const n = leadByRow[i] ?? 1;
    const lead = r.slice(0, n), kr = r.slice(n);
    if (i >= 4 && boxes[3]) { boxes[3].label = `${boxes[3].label}·${labels[i]}`; boxes[3].lead.push(...lead); boxes[3].kr.push(...kr); }
    else boxes.push({ label: labels[i], lead: [...lead], kr: [...kr] });
  });
  const card = (sym: string, lead: boolean) => {
    const kr = /\.KS$/.test(sym);
    const code = kr ? sym.slice(0, 6) : sym;
    const q = quote(sym);
    return (
      <div key={sym} className={lead ? "rounded-lg ring-2 ring-indigo-400" : ""}>
        <QuoteCard code={code} name={NAME.get(sym) ?? sym} px={q && q.price > 0 ? q : undefined} className="w-full h-[84px]" />
      </div>
    );
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      {boxes.map(b => {
        const ps = b.kr.map(s => quote(s)?.pct).filter((v): v is number => v != null && Number.isFinite(v));
        const avg = ps.length ? ps.reduce((a, v) => a + v, 0) / ps.length : null;
        const up = ps.filter(v => v > 0).length;
        return (
          <div key={b.label} className="rounded-lg border border-gray-200 bg-gray-50/50 pg-row p-2">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-bold text-gray-800">{b.label}</span>
              {avg != null && (
                <span className={`text-sm font-bold tabular-nums ${avg > 0 ? "text-rose-600" : avg < 0 ? "text-blue-600" : "text-gray-600"}`}
                      title="국내 종목 평균 등락률(동일가중)">
                  평균 {avg > 0 ? "+" : ""}{avg.toFixed(2)}%
                </span>
              )}
              {ps.length > 0 && <span className="text-[11px] text-gray-500">▲{up} · ▼{ps.length - up}</span>}
              <span className="ml-auto text-[10px] text-gray-400">테두리 = 해외 대장주</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {b.lead.map(s => card(s, true))}
              {b.kr.map(s => card(s, false))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
