// 투자자별 매수·매도 막대 — 주체마다 한 줄씩 위아래로 쌓은 작은 차트(시간 축 공유, 사용자 결정 2026-10-21).
//   구간(기본 10분)마다 위 = 그 구간에 산 양, 아래 = 판 양, 진한 선 = 누적 순매수(축 별도).
//   순매수 선만으론 '얼마나 사고팔아서 그 결과가 됐나'가 안 보였다 — 특히 마감 동시호가처럼 한꺼번에 사고판 구간.
//   값은 네이버 시간별 수급의 투자자별 누적 매수·매도(IntradayFlowPoint.gs)에서 구간 차이로 만든다.
import type { IntradayFlowPoint } from "../lib/api";
import { INTRADAY_SERIES } from "../lib/intradayInvestor";

const tmin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmtBig = (v: number, unit: string) =>
  unit === "억" && Math.abs(v) >= 10_000 ? `${(v / 10_000).toFixed(1)}조`
    : `${Math.round(v).toLocaleString()}${unit === "억" ? "억" : "계약"}`;
const signed = (v: number, unit: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtBig(Math.abs(v), unit)}`;

export function BuySellBars({ points, keys, unit, scale = 1, bucket = 10, start = "09:00", end = "15:30", rowH = 56, compact }: {
  points: IntradayFlowPoint[];
  keys: string[];          // 그릴 주체(foreigners·individuals·…) — 위에서부터 이 순서
  unit: "억" | "계약";      // 표시 단위(scale 을 곱한 뒤의 단위)
  scale?: number;          // 값에 곱할 배수(선물 계약 → 억원 환산 등)
  bucket?: number;         // 막대 한 개 = 몇 분
  start?: string; end?: string;
  rowH?: number;
  compact?: boolean;       // 좁은 칸용 — 합계 글자를 작게 한 줄로
}) {
  const pts = points.filter(p => p.gs);
  if (pts.length < 2 || !keys.length) return null;
  const t0 = Math.min(tmin(start), tmin(pts[0].time)), t1 = Math.max(tmin(end), tmin(pts[pts.length - 1].time));
  const nB = Math.max(1, Math.ceil((t1 - t0) / bucket));
  const W = 600, PAD = 2, H = 100, mid = H / 2;
  const bw = (W - PAD * 2) / nB;
  const xOfMin = (m: number) => PAD + ((m - t0) / (t1 - t0)) * (W - PAD * 2);
  return (
    <div className="w-full space-y-1">
      {keys.map(k => {
        const def = INTRADAY_SERIES.find(d => d.key === k);
        const color = def?.color ?? "#64748b";
        const cumAt = (m: number): [number, number] => {   // m 분까지의 누적 [매수, 매도]
          let v: [number, number] = [0, 0];
          for (const p of pts) { if (tmin(p.time) <= m) v = p.gs?.[k] ?? v; else break; }
          return [v[0] * scale, v[1] * scale];
        };
        const bars: { b: number; s: number }[] = [];
        let prev = cumAt(t0 - 1);
        for (let i = 0; i < nB; i++) {
          const cur = cumAt(t0 + (i + 1) * bucket);
          bars.push({ b: Math.max(0, cur[0] - prev[0]), s: Math.max(0, cur[1] - prev[1]) });
          prev = cur;
        }
        const last = pts[pts.length - 1].gs?.[k] ?? [0, 0];
        const totB = last[0] * scale, totS = last[1] * scale, net = totB - totS;
        const mxBar = Math.max(1e-9, ...bars.map(x => Math.max(x.b, x.s)));
        const nets = pts.map(p => ({ m: tmin(p.time), v: ((p.gs?.[k]?.[0] ?? 0) - (p.gs?.[k]?.[1] ?? 0)) * scale }));
        const mxNet = Math.max(1e-9, ...nets.map(n => Math.abs(n.v)));
        return (
          <div key={k}>
            <div className={`flex items-baseline gap-2 tabular-nums ${compact ? "text-[10px]" : "text-[11px]"}`}>
              <b style={{ color }}>{def?.label ?? k}</b>
              <span className="text-gray-500">매수 <b className="text-rose-600">{fmtBig(totB, unit)}</b> · 매도 <b className="text-blue-600">{fmtBig(totS, unit)}</b></span>
              <span className="ml-auto">순 <b className={net > 0 ? "text-rose-600" : net < 0 ? "text-blue-600" : "text-gray-500"}>{signed(net, unit)}</b></span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: rowH }}>
              <line x1={0} x2={W} y1={mid} y2={mid} stroke="#cbd5e1" vectorEffect="non-scaling-stroke" />
              {[10, 12, 14].map(h => <line key={h} x1={xOfMin(h * 60)} x2={xOfMin(h * 60)} y1={0} y2={H} stroke="#f1f5f9" vectorEffect="non-scaling-stroke" />)}
              {bars.map((x, i) => {
                const hb = (x.b / mxBar) * (mid - 2), hs = (x.s / mxBar) * (mid - 2);
                const bx = PAD + i * bw + bw * 0.1;
                return (
                  <g key={i}>
                    {x.b > 0 && <rect x={bx} width={bw * 0.8} y={mid - hb} height={hb} fill={color} opacity={0.85} />}
                    {x.s > 0 && <rect x={bx} width={bw * 0.8} y={mid} height={hs} fill={color} opacity={0.35} />}
                  </g>
                );
              })}
              <path d={nets.map((n, i) => `${i ? "L" : "M"} ${xOfMin(n.m).toFixed(1)} ${(mid - (n.v / mxNet) * (mid - 2)).toFixed(1)}`).join(" ")}
                    fill="none" stroke="#1f2937" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        );
      })}
      {!compact && (
        <div className="flex gap-3 text-[10px] text-gray-400">
          <span>막대 {bucket}분마다 — 위(진한 색) 매수 · 아래(연한 색) 매도</span>
          <span>검은 선 = 누적 순매수(축 별도)</span>
        </div>
      )}
    </div>
  );
}
