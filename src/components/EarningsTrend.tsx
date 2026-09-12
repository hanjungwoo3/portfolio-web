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

const W = 400, H = 172;
const PAD_T = 14, PAD_B = 30, PAD_L = 44, PAD_R = 34;

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
                fontSize="8" fill="#94a3b8">추정</text>
        </>
      )}

      <line x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY} stroke="#e5e7eb" strokeWidth="1" />
      <text x={PAD_L - 5} y={y(maxV) + 4} fontSize="8" fill="#9ca3af" textAnchor="end">{fmtEok(maxV)}</text>
      <text x={PAD_L - 5} y={zeroY + 4} fontSize="8" fill="#9ca3af" textAnchor="end">0</text>

      {rows.map((r, i) => (
        <g key={r.label}>
          {bar(r.revenue, i, -bw * 0.6, "#2563eb", r.estimate)}
          {bar(r.op_income, i, bw * 0.6, "#f97316", r.estimate)}
          <text x={PAD_L + i * slotW + slotW / 2} y={PAD_T + innerH + 11} fontSize="8"
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
          <text x={W - PAD_R + 4} y={ry(rMax) + 4} fontSize="8" fill="#059669">{rMax.toFixed(0)}%</text>
        </>
      )}

      <g transform={`translate(${PAD_L}, ${H - 3})`} fontSize="8">
        <rect x="0" y="-7" width="7" height="7" fill="#2563eb" /><text x="10" y="-1" fill="#6b7280">매출</text>
        <rect x="38" y="-7" width="7" height="7" fill="#f97316" /><text x="48" y="-1" fill="#6b7280">영업이익</text>
        <line x1="86" y1="-4" x2="98" y2="-4" stroke="#059669" strokeWidth="1.5" strokeDasharray="4 2" />
        <text x="101" y="-1" fill="#6b7280">ROE(우)</text>
        <text x="150" y="-1" fill="#94a3b8">빗금 = 추정</text>
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

export function EarningsTrend({ rows }: { rows: EarningsRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="p-3 bg-white border border-gray-200 rounded">
      <header className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-sm font-bold text-gray-700">📈 실적 추이</h3>
        <span className="text-[10px] text-gray-400">(A) 확정 · (E) 증권사 컨센서스 추정</span>
        <span className="ml-auto text-[10px] text-gray-400">출처: 네이버 금융 / 에프앤가이드</span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <div className="min-w-0">
          <TrendChart rows={rows} />
        </div>

        <div className="min-w-0 overflow-x-auto">
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
                  <td className="px-1.5 py-0.5 text-[10px] text-gray-400 whitespace-nowrap">{m.label}</td>
                  {rows.map(r => (
                    <td key={r.label}
                        className={`px-1.5 py-0.5 text-[11px] tabular-nums text-right whitespace-nowrap
                                    ${r.estimate ? "bg-slate-50" : ""} ${m.cls?.(r) ?? "text-gray-700"}`}>
                      {m.get(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-1 text-[10px] text-gray-400 leading-snug">
        (E) 의 PER·PBR 은 추정 이익을 지금 주가로 나눈 값(forward)이라 확정 실적 기준보다 낮게
        나오는 게 보통이다 — 저평가로 바로 읽으면 안 된다. 순부채비율이 음수면 순현금.
      </p>
    </section>
  );
}

export default EarningsTrend;
