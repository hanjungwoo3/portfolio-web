// 주·월·연 투자자 순매수 막대 — 구간마다 켜진 주체의 막대를 나란히(그룹) 그린다. 토스 공식 API(데스크톱 앱 전용) 값.
//   lightweight-charts 를 안 쓴 이유: 구간이 20~60개뿐이고 그룹 막대·마우스 표가 필요한데 SVG 가 더 단순하다.
//   마우스(또는 터치)를 올리면 그 구간의 날짜·주체별 값이 위 표에 나온다. 아무 데도 없으면 마지막 구간.
import { useMemo, useState } from "react";
import { INTRADAY_SERIES, type IntradayKey } from "../lib/intradayInvestor";
import type { LongFlowInterval, LongFlowPoint } from "../lib/tossMarketFlow";
import { joEok } from "./BuySellBars";

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${joEok(Math.abs(v))}`;
// 구간 라벨 — 주: M/D, 월: YY.M, 연: YYYY
export function periodLabel(date: string, interval: LongFlowInterval): string {
  const [y, m, d] = date.split("-");
  if (interval === "1y") return y;
  if (interval === "1mo") return `${y.slice(2)}.${Number(m)}`;
  return `${Number(m)}/${Number(d)}`;
}
// 축 눈금 — 억 → "1조"·"5,000억"
const axisLabel = (v: number) => {
  const a = Math.abs(v); const s = v < 0 ? "−" : "";
  if (a >= 10_000) return `${s}${(a / 10_000).toFixed(a % 10_000 ? 1 : 0)}조`;
  return `${s}${Math.round(a).toLocaleString()}억`;
};

export function LongTermInvestorChart({ points, keys, interval, label, height = 240 }: {
  points: LongFlowPoint[]; keys: IntradayKey[]; interval: LongFlowInterval; label: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height, padL = 44, padR = 8, padT = 6, padB = 18;
  const n = points.length;
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const p of points) for (const k of keys) m = Math.max(m, Math.abs(p[k]));
    return m || 1;
  }, [points, keys]);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const zeroY = padT + innerH / 2;
  const yOf = (v: number) => zeroY - (v / maxAbs) * (innerH / 2);
  const groupW = n ? innerW / n : innerW;
  const barW = keys.length ? Math.max(1, (groupW * 0.72) / keys.length) : 0;
  const idx = hover ?? (n ? n - 1 : null);
  const cur = idx != null ? points[idx] : null;
  const defs = INTRADAY_SERIES.filter(d => keys.includes(d.key));
  // 눈금 4개(±max, ±max/2)
  const ticks = [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs];
  // x 라벨은 겹치지 않게 간격을 띄운다
  const every = Math.max(1, Math.ceil(n / 8));

  const locate = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W - padL;
    const i = Math.floor(x / groupW);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="border border-gray-200 rounded px-1.5 pt-1 pb-0.5">
      <div className="flex items-baseline gap-2 flex-wrap text-[11px] leading-tight mb-0.5">
        <span className="font-bold text-green-600">{label}</span>
        {cur ? (
          <>
            <span className="text-gray-500 tabular-nums">{cur.date}{cur.provisional ? " (집계중)" : ""}</span>
            {defs.map(d => (
              <span key={d.key} className="tabular-nums" style={{ color: d.color }}>
                {d.label} <b>{signed(cur[d.key])}</b>
              </span>
            ))}
          </>
        ) : <span className="text-gray-400">데이터 없음</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block touch-none" style={{ height }}
           onMouseMove={e => locate(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)}
           onTouchStart={e => locate(e.touches[0].clientX, e.currentTarget)}
           onTouchMove={e => locate(e.touches[0].clientX, e.currentTarget)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#9ca3af" : "#f3f4f6"} strokeWidth={t === 0 ? 1 : 1} />
            <text x={padL - 4} y={yOf(t) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{axisLabel(t)}</text>
          </g>
        ))}
        {idx != null && (
          <rect x={padL + idx * groupW} y={padT} width={groupW} height={innerH} fill="#eef2ff" opacity={0.7} />
        )}
        {points.map((p, i) => defs.map((d, j) => {
          const v = p[d.key];
          const x = padL + i * groupW + (groupW - barW * defs.length) / 2 + j * barW;
          const y0 = yOf(0), y1 = yOf(v);
          return <rect key={`${i}-${d.key}`} x={x} y={Math.min(y0, y1)} width={Math.max(0.5, barW - 0.5)} height={Math.abs(y1 - y0)}
                       fill={d.color} opacity={p.provisional ? 0.45 : 0.85} />;
        }))}
        {points.map((p, i) => (i % every === 0 || i === n - 1) && (
          <text key={p.date} x={padL + i * groupW + groupW / 2} y={H - 5} textAnchor="middle" fontSize={9} fill="#6b7280">
            {periodLabel(p.date, interval)}
          </text>
        ))}
      </svg>
    </div>
  );
}
