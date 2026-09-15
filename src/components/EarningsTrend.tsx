// 실적·추정 추이 — wisereport cF1002(3년 실적 + 2년 추정).
//
// 왜 따로 두나 — 옆의 재무 추이 차트(cF1001)는 **지나간 실적만** 다룬다. 투자 판단에서
//   정작 중요한 건 "내년에 얼마를 벌 것으로 보나" 와 그걸로 계산한 forward PER 인데,
//   그 값은 이 표에만 있다. EV/EBITDA·순부채비율도 여기서만 온다.
//
// 추정(E)은 컨센서스일 뿐 확정이 아니다 — 실적과 같은 색으로 그리면 사실처럼 읽힌다.
//   그래서 막대를 빗금 + 흐리게 칠하고 실적과 추정 사이에 경계선을 긋는다.
//
// 배치 — 차트(좌) + 표(우) 를 반반. 세로로 쌓으면 모달에서 차지하는 높이가 다른 섹션의
//   두 배가 된다. 표는 연도를 '열'로 돌려 폭을 좁혔다(11열 → 6열) — 그래야 절반 폭에 든다.

import type { ReactNode } from "react";
import type { EarningsRow } from "../lib/fundamentals";

function fmtEok(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}
const fmtNum = (v: number | null, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(d);
const fmtPct = (v: number | null, d = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`;
// 한국 증시 관례 — 빨강이 증가, 파랑이 감소
const signCls = (v: number | null) =>
  v == null ? "text-gray-400" : v >= 0 ? "text-rose-600" : "text-blue-600";

// ★ 뷰박스 폭은 **실제로 그려지는 폭**에 맞춘다.
//   SVG 는 뷰박스를 칸 너비에 맞춰 통째로 축소한다. 10칸 중 2칸(≈240px)에 그리면서
//   뷰박스를 400 으로 두면 0.6배로 줄어 8px 글자가 5px 이 된다 — 실제로 안 읽혔다.
//   폭을 240 으로 맞추면 배율이 1 이라 글자가 지정한 크기 그대로 나온다.
// 두 차트를 같은 높이로 두고, 합쳐서 오른쪽 표(헤더+10행 ≈ 190px)와 맞춘다.
//   폭 240 = 실제 렌더 폭이라 배율 1 → 96px 씩 두 장 = 192px.
const W = 240, H = 96;
const PAD_T = 8, PAD_B = 22, PAD_L = 34, PAD_R = 26;

function TrendChart({ rows }: { rows: EarningsRow[] }) {
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const n = rows.length;
  const slotW = innerW / n;

  // 좌축 — 매출·영업이익을 한 축에 놓는다(같은 억원 단위라 크기 비교가 그대로 의미를 갖는다).
  const amounts = rows.flatMap(r => [r.revenue, r.op_income]).filter((v): v is number => v != null);
  if (amounts.length === 0) return null;
  const maxV = Math.max(...amounts, 0);
  const minV = Math.min(...amounts, 0);
  const span = maxV - minV || 1;
  const y = (v: number) => PAD_T + innerH - ((v - minV) / span) * innerH;
  const zeroY = y(0);

  // 우축 — ROE(%)
  const roes = rows.map(r => r.roe).filter((v): v is number => v != null);
  const rMax = roes.length > 0 ? Math.max(...roes, 0) : 1;
  const rMin = roes.length > 0 ? Math.min(...roes, 0) : 0;
  const rSpan = rMax - rMin || 1;
  const ry = (v: number) => PAD_T + innerH - ((v - rMin) / rSpan) * innerH;

  const firstEstIdx = rows.findIndex(r => r.estimate);
  const bw = slotW * 0.3;

  const bar = (v: number | null, i: number, offset: number, color: string, est: boolean) => {
    if (v == null) return null;
    const x = PAD_L + i * slotW + slotW / 2 + offset - bw / 2;
    const top = Math.min(y(v), zeroY);
    const h = Math.max(Math.abs(y(v) - zeroY), 1);
    return (
      <rect x={x} y={top} width={bw} height={h}
            fill={est ? `url(#hatch-${color.replace("#", "")})` : color}
            stroke={est ? color : "none"} strokeWidth={est ? 1 : 0}
            strokeDasharray={est ? "2 1.5" : undefined} />
    );
  };

  const roePts = rows.map((r, i) =>
    r.roe == null ? null : [PAD_L + i * slotW + slotW / 2, ry(r.roe)] as const);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="실적·추정 추이">
      <defs>
        {["2563eb", "f97316"].map(c => (
          <pattern key={c} id={`hatch-${c}`} width="5" height="5" patternTransform="rotate(45)"
                   patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill={`#${c}`} opacity="0.12" />
            <line x1="0" y1="0" x2="0" y2="5" stroke={`#${c}`} strokeWidth="2" opacity="0.5" />
          </pattern>
        ))}
      </defs>

      {/* 실적 / 추정 경계 — 여기부터는 아직 일어나지 않은 일이다 */}
      {firstEstIdx > 0 && (
        <>
          <rect x={PAD_L + firstEstIdx * slotW} y={PAD_T}
                width={innerW - firstEstIdx * slotW} height={innerH} fill="#f8fafc" />
          <line x1={PAD_L + firstEstIdx * slotW} y1={PAD_T}
                x2={PAD_L + firstEstIdx * slotW} y2={PAD_T + innerH}
                stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
          <text x={PAD_L + firstEstIdx * slotW + 3} y={PAD_T + 8}
                fontSize="8.5" fill="#94a3b8">추정</text>
        </>
      )}

      <line x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY} stroke="#e5e7eb" strokeWidth="1" />
      <text x={PAD_L - 5} y={y(maxV) + 4} fontSize="8.5" fill="#9ca3af" textAnchor="end">{fmtEok(maxV)}</text>
      <text x={PAD_L - 5} y={zeroY + 4} fontSize="8.5" fill="#9ca3af" textAnchor="end">0</text>

      {rows.map((r, i) => (
        <g key={r.label}>
          {bar(r.revenue, i, -bw * 0.6, "#2563eb", r.estimate)}
          {bar(r.op_income, i, bw * 0.6, "#f97316", r.estimate)}
          <text x={PAD_L + i * slotW + slotW / 2} y={PAD_T + innerH + 10} fontSize="8.5"
                fill={r.estimate ? "#94a3b8" : "#6b7280"} textAnchor="middle">
            {r.label.replace(/^\d{2}/, "")}
          </text>
        </g>
      ))}

      {/* ROE — 우축 라인 */}
      {roePts.filter(Boolean).length >= 2 && (
        <>
          <polyline fill="none" stroke="#059669" strokeWidth="1.5" strokeDasharray="4 2"
                    points={roePts.filter((p): p is readonly [number, number] => p != null)
                                  .map(p => p.join(",")).join(" ")} />
          {roePts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="#059669" />)}
          <text x={W - PAD_R + 3} y={ry(rMax) + 4} fontSize="8.5" fill="#059669">{rMax.toFixed(0)}%</text>
        </>
      )}

      {/* 범례 — 폭이 좁으니 '빗금=추정' 은 뺐다(헤더에 이미 (E) 설명이 있다) */}
      <g transform={`translate(${PAD_L - 2}, ${H - 3})`} fontSize="8.5">
        <rect x="0" y="-7" width="7" height="7" fill="#2563eb" /><text x="10" y="-1" fill="#6b7280">매출</text>
        <rect x="38" y="-7" width="7" height="7" fill="#f97316" /><text x="48" y="-1" fill="#6b7280">영업이익</text>
        <line x1="90" y1="-4" x2="102" y2="-4" stroke="#059669" strokeWidth="1.5" strokeDasharray="4 2" />
        <text x="105" y="-1" fill="#6b7280">ROE</text>
      </g>
    </svg>
  );
}

// PER·PBR 추이 — 표에 숫자로만 있던 걸 선으로 본다.
//   왜 따로 그리나 — 매출·영업이익(위 차트)은 '얼마나 버나' 고 PER·PBR 은 '얼마에 사나' 다.
//   축이 달라 한 차트에 못 겹치고, 표에 숫자로만 있으면 추정 구간에서 뚝 떨어지는 모양이
//   안 보인다. 그 낙차가 forward 밸류에이션의 핵심이라 선으로 그린다.
//   PER 과 PBR 은 자릿수가 달라(7.75 vs 0.83) 각자 축을 쓴다.
const VW = 240, VH = 96;          // 위 차트와 같은 높이 (표와 맞추기 위해 50%씩)
const V_T = 8, V_B = 22, V_L = 28, V_R = 24;

function ValuationChart({ rows }: { rows: EarningsRow[] }) {
  const innerW = VW - V_L - V_R, innerH = VH - V_T - V_B;
  const n = rows.length;
  const slot = innerW / n;
  const x = (i: number) => V_L + i * slot + slot / 2;

  const span = (vals: (number | null)[]) => {
    const ok = vals.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
    if (ok.length < 2) return null;
    const lo = Math.min(...ok), hi = Math.max(...ok);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
    return { lo: lo - pad, hi: hi + pad };
  };
  const perS = span(rows.map(r => r.per));
  const pbrS = span(rows.map(r => r.pbr));
  if (!perS && !pbrS) return null;

  const line = (vals: (number | null)[], s: { lo: number; hi: number } | null, color: string) => {
    if (!s) return null;
    const y = (v: number) => V_T + (1 - (v - s.lo) / (s.hi - s.lo)) * innerH;
    const pts = vals.map((v, i) => (v != null && v > 0 ? [x(i), y(v)] as const : null));
    const d = pts.reduce((acc: string, p, i) => {
      if (!p) return acc;
      const prev = pts.slice(0, i).some(Boolean);
      return acc + `${prev ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    }, "");
    return (
      <>
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2} fill={color} />)}
      </>
    );
  };

  const firstEst = rows.findIndex(r => r.estimate);
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-auto" role="img" aria-label="PER·PBR 추이">
      {firstEst > 0 && (
        <rect x={V_L + firstEst * slot} y={V_T} width={innerW - firstEst * slot} height={innerH} fill="#f8fafc" />
      )}
      {perS && <text x={V_L - 3} y={V_T + 7} fontSize="8.5" fill="#7c3aed" textAnchor="end">{perS.hi.toFixed(0)}</text>}
      {pbrS && <text x={VW - V_R + 2} y={V_T + 7} fontSize="8.5" fill="#0891b2">{pbrS.hi.toFixed(1)}</text>}
      {line(rows.map(r => r.per), perS, "#7c3aed")}
      {line(rows.map(r => r.pbr), pbrS, "#0891b2")}
      {rows.map((r, i) => (
        <text key={r.label} x={x(i)} y={VH - 11} fontSize="8.5" textAnchor="middle"
              fill={r.estimate ? "#94a3b8" : "#6b7280"}>{r.label.replace(/^\d{2}/, "")}</text>
      ))}
      <g transform={`translate(${V_L - 2}, ${VH - 2})`} fontSize="8.5">
        <line x1="0" y1="-3" x2="10" y2="-3" stroke="#7c3aed" strokeWidth="1.5" />
        <text x="13" y="0" fill="#6b7280">PER(좌)</text>
        <line x1="56" y1="-3" x2="66" y2="-3" stroke="#0891b2" strokeWidth="1.5" />
        <text x="69" y="0" fill="#6b7280">PBR(우)</text>
      </g>
    </svg>
  );
}

// 표는 연도를 '열' 로 돌린다 — 지표가 11개라 가로로 놓으면 우측 칸에 안 들어간다.
const METRICS: { label: string; get: (r: EarningsRow) => string; cls?: (r: EarningsRow) => string }[] = [
  { label: "매출액",     get: r => fmtEok(r.revenue) },
  { label: "YoY",        get: r => fmtPct(r.revenue_yoy), cls: r => signCls(r.revenue_yoy) },
  { label: "영업이익",   get: r => fmtEok(r.op_income),   cls: r => signCls(r.op_income) },
  { label: "당기순이익", get: r => fmtEok(r.net_income),  cls: r => signCls(r.net_income) },
  { label: "EPS",        get: r => r.eps == null ? "—" : `${Math.round(r.eps).toLocaleString()}원` },
  { label: "PER",        get: r => fmtNum(r.per) },
  { label: "PBR",        get: r => fmtNum(r.pbr) },
  { label: "ROE",        get: r => fmtPct(r.roe),         cls: r => signCls(r.roe) },
  { label: "EV/EBITDA",  get: r => fmtNum(r.ev_ebitda) },
  // 순부채비율은 낮을수록(음수면 순현금) 좋다 — 색을 뒤집는다
  { label: "순부채비율", get: r => fmtPct(r.net_debt_ratio),
    cls: r => signCls(r.net_debt_ratio == null ? null : -r.net_debt_ratio) },
];

export function EarningsTrend({ rows, extraCols }: {
  rows: EarningsRow[];
  /** 같은 줄에 붙일 추가 칸(외국인 지분율·상대수익률). 없으면 2칸 그대로. */
  extraCols?: ReactNode;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="p-3 bg-white border border-gray-200 rounded">
      <header className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-sm font-bold text-gray-700">📈 실적 추이</h3>
        <span className="text-[10px] text-gray-400">(A) 확정 · (E) 증권사 컨센서스 추정</span>
        <span className="ml-auto text-[10px] text-gray-400">출처: 네이버 금융 / 에프앤가이드</span>
      </header>

      {/* 10칸 중 차트 2 · 표 4 · 나머지 각 2 — 표가 6열이라 제일 넓어야 읽힌다 */}
      <div className={`grid grid-cols-1 gap-3 items-start ${
        extraCols ? "lg:grid-cols-2 xl:grid-cols-10" : "lg:grid-cols-2"}`}>
        <div className={`min-w-0 space-y-1 ${extraCols ? "xl:col-span-2" : ""}`}>
          <TrendChart rows={rows} />
          <ValuationChart rows={rows} />
        </div>

        <div className={`min-w-0 overflow-x-auto ${extraCols ? "xl:col-span-4" : ""}`}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-1.5 py-0.5 text-[10px] font-normal text-gray-400 text-left whitespace-nowrap" />
                {rows.map(r => (
                  <th key={r.label}
                      className={`px-1.5 py-0.5 text-[10px] font-bold text-right whitespace-nowrap
                                  ${r.estimate ? "text-slate-400 bg-slate-50" : "text-gray-600"}`}>
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(m => (
                <tr key={m.label} className="border-b border-gray-100 last:border-0">
                  <td className="px-1.5 py-px text-[10px] text-gray-400 whitespace-nowrap">{m.label}</td>
                  {rows.map(r => (
                    <td key={r.label}
                        className={`px-1.5 py-px text-[11px] tabular-nums text-right whitespace-nowrap
                                    ${r.estimate ? "bg-slate-50" : ""} ${m.cls?.(r) ?? "text-gray-700"}`}>
                      {m.get(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {extraCols}
      </div>

      <p className="mt-1 text-[10px] text-gray-400 leading-snug">
        (E) 의 PER·PBR 은 추정 이익을 지금 주가로 나눈 값(forward)이라 확정 실적 기준보다 낮게
        나오는 게 보통이다 — 저평가로 바로 읽으면 안 된다. 순부채비율이 음수면 순현금.
      </p>
    </section>
  );
}

export default EarningsTrend;
