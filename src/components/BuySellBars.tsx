// 투자자별 매수·매도 막대 — 주체마다 한 줄씩 위아래로 쌓은 작은 차트(시간 축 공유, 사용자 결정 2026-10-21).
//   구간(기본 10분)마다 연한 막대 = 산 양(위)·판 양(아래), 진한 막대 = 차이(빨강 = 산 게 많음·파랑 = 판 게 많음, 자기 축).
//   누적 순매수 선은 뺐다(사용자 결정 — 위 큰 차트에 이미 있다). 범례 문구도 뺐다(사용자 결정).
//   값은 네이버 시간별 수급의 투자자별 누적 매수·매도(IntradayFlowPoint.gs)에서 구간 차이로 만든다.
//   geom 을 주면 큰 차트(lightweight-charts) 바로 아래에 붙어 **같은 가로축 좌표**로 그리고, 차트에 마우스를 올리면
//   그 시각 세로선과 그 구간 값을 같이 보여 준다(사용자 요청).
import type { IntradayFlowPoint } from "../lib/api";
import { INTRADAY_SERIES } from "../lib/intradayInvestor";

const tmin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// 억 단위 값 → "1조 1,097억원"·"5,433억원"(사용자 요청 — 조·억원으로), 선물 계약은 "122,744계약"
export const joEok = (v: number) => {
  const a = Math.round(Math.abs(v)), jo = Math.floor(a / 10_000), eok = a % 10_000;
  return jo ? `${jo}조${eok ? ` ${eok.toLocaleString()}억원` : "원"}` : `${eok.toLocaleString()}억원`;
};
const fmtBig = (v: number, unit: string) => (unit === "억" ? joEok(v) : `${Math.round(v).toLocaleString()}계약`);
const signed = (v: number, unit: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtBig(Math.abs(v), unit)}`;

export interface BarsGeom {
  xOfT: (t: number) => number | null;   // 차트 시각값 → 컨테이너 x(px)
  width: number;                        // 컨테이너 폭(px)
  hoverT: number | null;                // 차트에서 마우스가 가리키는 시각값
  toT: (hm: string) => number;          // "HH:MM" → 차트 시각값
  hover?: (t: number | null) => void;   // 막대 위 마우스 → 위 차트 crosshair 도 같은 시각으로
}

export function BuySellBars({ points, keys, unit, scale = 1, bucket: bucketIn, start = "09:00", end = "15:30", rowH = 56, compact, geom, textOnly }: {
  points: IntradayFlowPoint[];
  keys: string[];          // 그릴 주체(foreigners·individuals·…) — 위에서부터 이 순서
  unit: "억" | "계약";      // 표시 단위(scale 을 곱한 뒤의 단위)
  scale?: number;          // 값에 곱할 배수(선물 계약 → 억원 환산 등)
  bucket?: number;         // 막대 한 개 = 몇 분(안 주면 자료 길이로 — 1시간↓ 1분·3시간↓ 5분·그 위 10분)
  start?: string; end?: string;
  rowH?: number;
  compact?: boolean;       // 좁은 칸용 — 합계 글자를 작게
  geom?: BarsGeom;         // 큰 차트 아래에 붙일 때 — 그 차트의 가로축·마우스를 따른다
  textOnly?: boolean;      // 숫자 줄만 — 막대는 위 큰 차트 배경에 그릴 때(반도체 수급, 사용자 요청 2026-10-23)
}) {
  const pts = points.filter(p => p.gs);
  if (pts.length < 2 || !keys.length) return null;
  // 장 초반엔 10분 막대 하나가 화면을 다 차지했다 — 쌓인 자료 길이에 맞춰 막대 간격을 줄인다(사용자 지적 2026-10-22)
  const dataSpan = tmin(pts[pts.length - 1].time) - tmin(pts[0].time);
  const bucket = bucketIn ?? (dataSpan <= 60 ? 1 : dataSpan <= 180 ? 5 : 10);
  const t0 = Math.min(tmin(start), tmin(pts[0].time)), t1 = Math.max(tmin(end), tmin(pts[pts.length - 1].time));
  const nB = Math.max(1, Math.ceil((t1 - t0) / bucket));
  // 구간마다 그 안의 자료 시각들(차트 좌표를 얻으려면 실제 있는 시각이어야 한다)
  const bucketPts: IntradayFlowPoint[][] = Array.from({ length: nB }, () => []);
  for (const p of pts) bucketPts[Math.min(nB - 1, Math.max(0, Math.floor((tmin(p.time) - t0) / bucket)))].push(p);
  const PX_W = geom ? Math.max(1, geom.width) : 600, H = 100, mid = H / 2, PAD = 2;
  // 1분당 화면 폭(px) — 처음·끝 자료의 좌표로 잰다. 막대 폭 = 구간 길이 × 이 값(1분 막대가 2px 로 가늘던 것, 사용자 지적)
  const ppm = (() => {
    if (!geom) return 0;
    const f = pts.find(p => geom.xOfT(geom.toT(p.time)) != null), l = [...pts].reverse().find(p => geom.xOfT(geom.toT(p.time)) != null);
    if (!f || !l) return 0;
    const dm = tmin(l.time) - tmin(f.time);
    return dm > 0 ? ((geom.xOfT(geom.toT(l.time))! - geom.xOfT(geom.toT(f.time))!) / dm) : 0;
  })();
  const xRange = (i: number): [number, number] | null => {   // 구간 i 의 가로 위치
    if (geom) {
      const ps = bucketPts[i]; if (!ps.length) return null;
      const a = geom.xOfT(geom.toT(ps[0].time));
      if (a == null) return null;
      const x0 = a - (tmin(ps[0].time) - (t0 + i * bucket)) * ppm;   // 구간 시작 시각 자리
      return [x0, x0 + Math.max(2, bucket * ppm)];
    }
    const bw = (PX_W - PAD * 2) / nB;
    return [PAD + i * bw, PAD + (i + 1) * bw];
  };
  const xOfMin = (m: number) => PAD + ((m - t0) / (t1 - t0)) * (PX_W - PAD * 2);
  // 마우스가 가리키는 구간
  const hoverHm = geom?.hoverT != null
    ? pts.reduce((best, p) => (Math.abs(geom.toT(p.time) - geom.hoverT!) < Math.abs(geom.toT(best.time) - geom.hoverT!) ? p : best), pts[0]).time
    : undefined;
  const hoverI = hoverHm ? Math.min(nB - 1, Math.max(0, Math.floor((tmin(hoverHm) - t0) / bucket))) : undefined;
  // 세로선은 가리킨 구간 막대의 **가운데**로(사용자 요청) — 정확한 시각에 그으면 막대 왼쪽 끝에 붙어 보였다
  const hoverX = (() => {
    if (geom?.hoverT == null) return null;
    const r = hoverI != null ? xRange(hoverI) : null;
    return r ? (r[0] + r[1]) / 2 : geom.xOfT(geom.hoverT);
  })();
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
          const cur = cumAt(t0 + (i + 1) * bucket - 1);
          bars.push({ b: Math.max(0, cur[0] - prev[0]), s: Math.max(0, cur[1] - prev[1]) });
          prev = cur;
        }
        const last = pts[pts.length - 1].gs?.[k] ?? [0, 0];
        const totB = last[0] * scale, totS = last[1] * scale, net = totB - totS;
        const mxBar = Math.max(1e-9, ...bars.map(x => Math.max(x.b, x.s)));
        const mxD = Math.max(1e-9, ...bars.map(x => Math.abs(x.b - x.s)));   // 차이 막대는 자기 축 — 총량에 비해 작아 묻히지 않게
        const hb = hoverI != null ? bars[hoverI] : undefined;
        return (
          <div key={k}>
            <div className={`flex items-baseline gap-2 tabular-nums min-w-0 ${compact ? "text-[10px]" : "text-[11px]"}`}>
              <b className="whitespace-nowrap" style={{ color }}>{def?.label ?? k}</b>
              {/* 좁은 칸(compact)은 '매수·매도·→' 글자를 뺀다(사용자 요청) — 빨강 = 매수, 파랑 = 매도 */}
              {/* 개인 … 금액 (+산 −판) — 마우스 땐 그 구간, 아니면 하루 합계(사용자 요청 2026-10-23) */}
              {(() => {
                const [bv, sv, nv] = hb ? [hb.b, hb.s, hb.b - hb.s] : [totB, totS, net];
                const netEl = <b className={`whitespace-nowrap ${compact ? "text-[11.5px]" : "text-[12.5px]"} ${nv > 0 ? "text-rose-600" : nv < 0 ? "text-blue-600" : "text-gray-500"}`}>{signed(nv, unit)}</b>;
                const bsEl = <span className="text-gray-500 whitespace-nowrap min-w-0 truncate">(<b className="text-rose-600">+{fmtBig(bv, unit)}</b> <b className="text-blue-600">−{fmtBig(sv, unit)}</b>)</span>;
                // 마우스 때도 아닐 때도 오른쪽 끝(사용자 요청 2026-10-23)
                return <span className="ml-auto inline-flex items-baseline gap-1 min-w-0">{netEl}{bsEl}</span>;
              })()}
            </div>
            {!textOnly && <svg viewBox={`0 0 ${PX_W} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height: rowH }}
                 onMouseMove={geom?.hover ? e => {
                   // 마우스 x(px) → 가장 가까운 자료 시각 → 위 차트에 알린다
                   const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                   const mx = ((e.clientX - r.left) / r.width) * PX_W;
                   let best: number | null = null, bd = Infinity;
                   for (const p of pts) { const t = geom.toT(p.time), x = geom.xOfT(t); if (x != null && Math.abs(x - mx) < bd) { bd = Math.abs(x - mx); best = t; } }
                   geom.hover!(best);
                 } : undefined}
                 onMouseLeave={geom?.hover ? () => geom.hover!(null) : undefined}>
              <line x1={0} x2={PX_W} y1={mid} y2={mid} stroke="#cbd5e1" vectorEffect="non-scaling-stroke" />
              {!geom && [10, 12, 14].map(h => <line key={h} x1={xOfMin(h * 60)} x2={xOfMin(h * 60)} y1={0} y2={H} stroke="#f1f5f9" vectorEffect="non-scaling-stroke" />)}
              {bars.map((x, i) => {
                const r = xRange(i); if (!r) return null;
                const [x0, x1] = r, bx = x0 + (x1 - x0) * 0.1, w = Math.max(1, (x1 - x0) * 0.8);
                const hbh = (x.b / mxBar) * (mid - 2), hsh = (x.s / mxBar) * (mid - 2);
                // 차이(매수−매도) — 어느 쪽이 큰지 한눈에(사용자 요청): 매수·매도는 연하게, 차이만 진한 빨강/파랑
                const d = x.b - x.s, hd = (Math.abs(d) / mxD) * (mid - 2);
                return (
                  <g key={i} opacity={hoverI == null || hoverI === i ? 1 : 0.55}>
                    {x.b > 0 && <rect x={bx} width={w} y={mid - hbh} height={hbh} fill={color} opacity={0.18} />}
                    {x.s > 0 && <rect x={bx} width={w} y={mid} height={hsh} fill={color} opacity={0.18} />}
                    {d !== 0 && <rect x={bx} width={w} y={d > 0 ? mid - hd : mid} height={Math.max(0.5, hd)} fill={d > 0 ? "#e11d48" : "#2563eb"} opacity={0.9} />}
                  </g>
                );
              })}
              {hoverX != null && <line x1={hoverX} x2={hoverX} y1={0} y2={H} stroke="#475569" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
            </svg>}
          </div>
        );
      })}
    </div>
  );
}
