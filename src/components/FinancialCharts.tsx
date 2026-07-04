// 기업가치 모달용 재무 시계열 차트 — SVG 직접 (lightweight-charts 안 씀, 5개 차트 동시에 가벼움)
// 입력: FinancialSeries (4년 연간). 차트 5개 — 손익 / 건전성 / 수익성비율 / 현금흐름 / 주주환원.

import type { FinancialSeries } from "../lib/fundamentals";

// ─── 압축 포맷 ────────────────────────────────────
// 억원 → 조원/억원/만원 자동 (입력 값이 억원 단위라고 가정)
function fmtEok(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}조`;        // 1만 억원 = 1조원
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}
// 원 단위 (DPS 등)
function fmtKrw(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString()}원`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "" : ""}${v.toFixed(2)}%`;
}

// ─── 공통 차트 helper (SVG 기반) ─────────────────────────────
// 두 축(좌/우) + 막대/라인 혼합, 4 포인트 시계열에 최적화
interface ChartCfg {
  width: number;
  height: number;
  bars?: Array<{ label: string; values: (number | null)[]; color: string }>;
  // 스택 막대: stackedBars[0]=하단, stackedBars[1]=상단 등
  stackedBars?: Array<{ label: string; values: (number | null)[]; color: string }>;
  // 라인 (선택 사항)
  lines?: Array<{ label: string; values: (number | null)[]; color: string; axis?: "left" | "right"; dashed?: boolean }>;
  // 가로 기준선 (예: ROE 15%)
  referenceLines?: Array<{ value: number; color: string; label?: string; axis?: "left" | "right" }>;
  years: string[];
  formatLeft: (v: number) => string;
  formatRight?: (v: number) => string;
}

function Chart({ cfg }: { cfg: ChartCfg }) {
  const { width, height, bars = [], stackedBars = [], lines = [], referenceLines = [], years, formatLeft, formatRight } = cfg;
  const padTop = 8, padBottom = 22, padLeft = 50, padRight = formatRight ? 50 : 8;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const n = years.length;
  const slotW = innerW / n;

  // 좌측축 범위 — bars + stacked + left lines + reference left
  const leftVals: number[] = [];
  for (const b of bars) leftVals.push(...b.values.filter((v): v is number => v != null));
  if (stackedBars.length > 0) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      let hasVal = false;
      for (const sb of stackedBars) {
        const v = sb.values[i];
        if (v != null) { s += v; hasVal = true; }
      }
      if (hasVal) leftVals.push(s);
    }
  }
  for (const l of lines) if (l.axis !== "right") leftVals.push(...l.values.filter((v): v is number => v != null));
  for (const r of referenceLines) if (r.axis !== "right") leftVals.push(r.value);

  // 우측축 범위 — right lines + reference right
  const rightVals: number[] = [];
  for (const l of lines) if (l.axis === "right") rightVals.push(...l.values.filter((v): v is number => v != null));
  for (const r of referenceLines) if (r.axis === "right") rightVals.push(r.value);

  const leftMin = leftVals.length ? Math.min(0, ...leftVals) : 0;
  const leftMax = leftVals.length ? Math.max(0, ...leftVals) : 1;
  const leftRange = leftMax - leftMin || 1;
  const rightMin = rightVals.length ? Math.min(0, ...rightVals) : 0;
  const rightMax = rightVals.length ? Math.max(0, ...rightVals) : 1;
  const rightRange = rightMax - rightMin || 1;

  const yLeft = (v: number) => padTop + innerH - ((v - leftMin) / leftRange) * innerH;
  const yRight = (v: number) => padTop + innerH - ((v - rightMin) / rightRange) * innerH;
  const xCenter = (i: number) => padLeft + i * slotW + slotW / 2;

  // tick 5단
  const tickCount = 5;
  const leftTicks = Array.from({ length: tickCount }, (_, i) => leftMin + (leftRange * i) / (tickCount - 1));
  const rightTicks = formatRight ? Array.from({ length: tickCount }, (_, i) => rightMin + (rightRange * i) / (tickCount - 1)) : [];

  // 막대 너비 계산 — 단일 막대면 slot 의 60%, 그룹 막대면 분할
  const barCount = bars.length;
  const totalBarWidth = slotW * 0.62;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img"
         className="block" preserveAspectRatio="xMidYMid meet">
      {/* 가로 그리드 + 좌측 라벨 */}
      {leftTicks.map((t, ti) => {
        const y = yLeft(t);
        return (
          <g key={`lt-${ti}`}>
            <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#f3f4f6" strokeWidth="0.5" />
            <text x={padLeft - 4} y={y + 3} fontSize="9" fill="#6b7280" textAnchor="end">
              {formatLeft(t)}
            </text>
          </g>
        );
      })}
      {/* 0 라인 강조 */}
      {leftMin < 0 && (
        <line x1={padLeft} x2={width - padRight} y1={yLeft(0)} y2={yLeft(0)}
              stroke="#9ca3af" strokeWidth="0.8" />
      )}
      {/* 우측 라벨 */}
      {formatRight && rightTicks.map((t, ti) => {
        const y = yRight(t);
        return (
          <text key={`rt-${ti}`} x={width - padRight + 4} y={y + 3} fontSize="9" fill="#6b7280" textAnchor="start">
            {formatRight(t)}
          </text>
        );
      })}
      {/* 기준선 */}
      {referenceLines.map((ref, ri) => {
        const y = ref.axis === "right" ? yRight(ref.value) : yLeft(ref.value);
        return (
          <g key={`ref-${ri}`}>
            <line x1={padLeft} x2={width - padRight} y1={y} y2={y}
                  stroke={ref.color} strokeWidth="0.8" strokeDasharray="3 2" opacity="0.7" />
            {ref.label && (
              <text x={padLeft + 4} y={y - 2} fontSize="9" fill={ref.color}>
                {ref.label}
              </text>
            )}
          </g>
        );
      })}
      {/* 스택 막대 */}
      {stackedBars.length > 0 && years.map((_, i) => {
        let cum = 0;
        const cx = xCenter(i);
        const w = slotW * 0.62;
        return (
          <g key={`sb-${i}`}>
            {stackedBars.map((sb, si) => {
              const v = sb.values[i];
              if (v == null) return null;
              const y1 = yLeft(cum);
              cum += v;
              const y2 = yLeft(cum);
              const top = Math.min(y1, y2);
              const h = Math.abs(y2 - y1);
              return <rect key={si} x={cx - w / 2} y={top} width={w} height={h}
                          fill={sb.color} opacity="0.85" />;
            })}
          </g>
        );
      })}
      {/* 일반(그룹) 막대 */}
      {bars.length > 0 && bars.map((b, bi) => (
        <g key={`bar-${bi}`}>
          {b.values.map((v, i) => {
            if (v == null) return null;
            const groupW = totalBarWidth;
            const barW = groupW / barCount;
            const startX = xCenter(i) - groupW / 2 + bi * barW;
            const zero = yLeft(0);
            const y = yLeft(v);
            const top = Math.min(zero, y);
            const h = Math.abs(y - zero);
            return <rect key={i} x={startX + 1} y={top} width={Math.max(barW - 2, 1)} height={Math.max(h, 0.5)}
                        fill={b.color} opacity="0.85" />;
          })}
        </g>
      ))}
      {/* 라인 */}
      {lines.map((l, li) => {
        const yFn = l.axis === "right" ? yRight : yLeft;
        const pts: string[] = [];
        l.values.forEach((v, i) => {
          if (v == null) return;
          pts.push(`${pts.length === 0 ? "M" : "L"} ${xCenter(i)} ${yFn(v)}`);
        });
        if (pts.length === 0) return null;
        return (
          <g key={`ln-${li}`}>
            <path d={pts.join(" ")} fill="none" stroke={l.color} strokeWidth="1.5"
                  strokeDasharray={l.dashed ? "4 2" : undefined}
                  strokeLinejoin="round" strokeLinecap="round" />
            {l.values.map((v, i) => {
              if (v == null) return null;
              return <circle key={i} cx={xCenter(i)} cy={yFn(v)} r="2.2" fill={l.color} />;
            })}
          </g>
        );
      })}
      {/* X축 연도 라벨 */}
      {years.map((y, i) => (
        <text key={`xy-${i}`} x={xCenter(i)} y={height - 6}
              fontSize="10" fill="#6b7280" textAnchor="middle">
          {y}
        </text>
      ))}
    </svg>
  );
}

// ─── 범례 ─────────────────────────────────────
// 라인 아이콘은 SVG 로 정확하게 — CSS border-style: dashed 는 짧은 너비에서 안 보임
function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean; bar?: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] mt-1">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1 text-gray-700">
          {it.bar ? (
            <span className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: it.color, opacity: 0.85 }} />
          ) : (
            <svg width="18" height="6" className="shrink-0">
              <line x1="0" y1="3" x2="18" y2="3"
                    stroke={it.color} strokeWidth="2"
                    strokeDasharray={it.dashed ? "3 2" : undefined}
                    strokeLinecap="round" />
            </svg>
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ─── 추세 평가 (차트 제목 색 결정) ─────────────────
// good (빨강) / bad (파랑) / neutral (회색). 한국식 색 관습.
type Trend = "good" | "bad" | "neutral";
function assessTrend(values: (number | null)[], higherIsBetter: boolean): Trend {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return "neutral";
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (Math.abs(last - first) < 1e-9) return "neutral";
  const growing = last > first;
  return (higherIsBetter ? growing : !growing) ? "good" : "bad";
}
const TREND_TITLE: Record<Trend, string> = {
  good:    "text-rose-600",
  bad:     "text-blue-600",
  neutral: "text-gray-800",
};

// ─── 단일 차트 카드 컨테이너 ────────────────────────
// 제목 색 = 추세 (good=빨강/bad=파랑/neutral=회색).
// criteriaMetric + betterUp 으로 추세에 맞춰 문구 동적 생성 (긍정/부정/변화없음).
function ChartCard({ title, sub, criteriaMetric, betterUp = true, trend = "neutral", children }: {
  title: string; sub?: string;
  criteriaMetric?: string;    // 예: "순이익"
  betterUp?: boolean;         // true 면 ↑ 가 긍정 (기본). false 면 ↓ 가 긍정.
  trend?: Trend;
  children: React.ReactNode;
}) {
  const colorCls = TREND_TITLE[trend];
  // 추세별 문구 — neutral 일 땐 "변화 없음" 으로
  let criteriaText: string | null = null;
  if (criteriaMetric) {
    if (trend === "good") {
      criteriaText = `${criteriaMetric} ${betterUp ? "↑" : "↓"}로 긍정판단`;
    } else if (trend === "bad") {
      criteriaText = `${criteriaMetric} ${betterUp ? "↓" : "↑"}로 부정판단`;
    } else {
      criteriaText = `${criteriaMetric} 변화 없음`;
    }
  }
  return (
    <section className="border border-gray-200 rounded p-2.5 bg-white">
      <header className="mb-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <h4 className={`text-sm font-bold ${colorCls}`}>{title}</h4>
          {criteriaText && (
            <span className={`text-[10px] ${colorCls}`}>{criteriaText}</span>
          )}
        </div>
        {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
      </header>
      {children}
    </section>
  );
}

// ─── 모든 값이 null 인지 확인 (차트 hide 판단) ──────
function allNull(arr: (number | null)[]): boolean {
  return arr.every(v => v == null);
}

export function FinancialCharts({ series }: { series: FinancialSeries }) {
  const { years } = series;
  if (years.length < 2) {
    return <div className="text-xs text-gray-400 py-2">시계열 데이터 부족</div>;
  }
  // 5개 한 줄에 맞도록 너비 축소 (1280px 모달 / 5 = ~240px 셀)
  const W = 230, H = 140;

  // 차트 1 — 손익 추이: 매출(막대) + 영업이익/순이익(라인) + 마진(우축 점선)
  const chart1Visible = !allNull(series.revenue) || !allNull(series.op_income) || !allNull(series.net_income);

  // 차트 2 — 재무 건전성: 자본/부채 스택 + 부채비율(우축 점선)
  const chart2Visible = !allNull(series.total_equity) || !allNull(series.total_debt);

  // 차트 3 — 수익성 비율: ROE/ROA/영업/순이익률 (4 라인)
  const chart3Visible = !allNull(series.roe) || !allNull(series.roa);

  // 차트 4 — 현금흐름: 영업/투자/재무 CF (3 막대) + FCF (라인)
  const chart4Visible = !allNull(series.cf_operating) || !allNull(series.fcf);

  // 차트 5 — 주주환원: DPS (막대) + 배당성향/수익률 (우축 라인)
  const chart5Visible = !allNull(series.dps) || !allNull(series.dividend_yield);

  // 차트 6 — 설비투자: CAPEX (막대, 절대규모) + 매출대비 비율 (우축 점선)
  // Wisereport 부호 관습이 종목마다 달라 abs 로 항상 '투자 규모'(양수) 표시.
  const capexAbs = series.capex.map(v => (v == null ? null : Math.abs(v)));
  const capexRatio = series.capex.map((v, i) => {
    const rev = series.revenue[i];
    if (v == null || rev == null || rev === 0) return null;
    return (Math.abs(v) / rev) * 100;
  });
  const chart6Visible = !allNull(series.capex);

  return (
    <section className="mt-3">
      <header className="mb-2 flex items-baseline gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-gray-700">📈 재무 추이 (연간 {years.length}년)</h3>
        <span className="text-[10px] text-gray-400">출처: Wisereport / 단위: 억원 또는 %</span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
        {chart1Visible && (
          <ChartCard title="손익 추이" sub="매출·영업이익·순이익 + 마진"
                     criteriaMetric="순이익" betterUp={true}
                     trend={assessTrend(series.net_income, true)}>
            <Chart cfg={{
              width: W, height: H, years,
              bars: [
                { label: "매출액",     values: series.revenue,    color: "#94a3b8" },  // slate-400
              ],
              lines: [
                { label: "영업이익",   values: series.op_income,  color: "#dc2626" },  // rose
                { label: "당기순이익", values: series.net_income, color: "#2563eb" },  // blue
                { label: "영업이익률", values: series.op_margin,  color: "#dc2626", axis: "right", dashed: true },
                { label: "순이익률",   values: series.net_margin, color: "#2563eb", axis: "right", dashed: true },
              ],
              formatLeft: fmtEok,
              formatRight: fmtPct,
            }} />
            <Legend items={[
              { label: "매출액 (좌)", color: "#94a3b8", bar: true },
              { label: "영업이익 (좌)", color: "#dc2626" },
              { label: "순이익 (좌)", color: "#2563eb" },
              { label: "영업이익률 (우)", color: "#dc2626", dashed: true },
              { label: "순이익률 (우)", color: "#2563eb", dashed: true },
            ]} />
          </ChartCard>
        )}

        {chart2Visible && (
          <ChartCard title="재무 건전성" sub="자본 + 부채 스택 → 자산총계, 부채비율 점선"
                     criteriaMetric="부채비율" betterUp={false}
                     trend={assessTrend(series.debt_ratio, false)}>
            <Chart cfg={{
              width: W, height: H, years,
              stackedBars: [
                { label: "자본총계", values: series.total_equity, color: "#10b981" },  // emerald
                { label: "부채총계", values: series.total_debt,   color: "#94a3b8" },  // gray
              ],
              lines: [
                { label: "부채비율", values: series.debt_ratio, color: "#dc2626", axis: "right", dashed: true },
              ],
              referenceLines: [
                { value: 100, color: "#f59e0b", label: "100%", axis: "right" },
              ],
              formatLeft: fmtEok,
              formatRight: fmtPct,
            }} />
            <Legend items={[
              { label: "자본총계 (좌)", color: "#10b981", bar: true },
              { label: "부채총계 (좌)", color: "#94a3b8", bar: true },
              { label: "부채비율 (우)", color: "#dc2626", dashed: true },
              { label: "100% 기준", color: "#f59e0b", dashed: true },
            ]} />
          </ChartCard>
        )}

        {chart3Visible && (
          <ChartCard title="수익성 비율" sub="ROE / ROA / 마진 (%)"
                     criteriaMetric="ROE" betterUp={true}
                     trend={assessTrend(series.roe, true)}>
            <Chart cfg={{
              width: W, height: H, years,
              lines: [
                { label: "ROE",       values: series.roe,        color: "#dc2626" },
                { label: "ROA",       values: series.roa,        color: "#f59e0b" },
                { label: "영업이익률", values: series.op_margin,  color: "#10b981" },
                { label: "순이익률",   values: series.net_margin, color: "#2563eb" },
              ],
              referenceLines: [
                { value: 15, color: "#94a3b8", label: "ROE 15% (버핏 기준)" },
              ],
              formatLeft: (v) => `${v.toFixed(0)}%`,
            }} />
            <Legend items={[
              { label: "ROE", color: "#dc2626" },
              { label: "ROA", color: "#f59e0b" },
              { label: "영업이익률", color: "#10b981" },
              { label: "순이익률", color: "#2563eb" },
            ]} />
          </ChartCard>
        )}

        {chart4Visible && (
          <ChartCard title="현금흐름" sub="영업/투자/재무 CF + FCF"
                     criteriaMetric="FCF" betterUp={true}
                     trend={assessTrend(series.fcf, true)}>
            <Chart cfg={{
              width: W, height: H, years,
              bars: [
                { label: "영업CF", values: series.cf_operating, color: "#10b981" },
                { label: "투자CF", values: series.cf_investing, color: "#94a3b8" },
                { label: "재무CF", values: series.cf_financing, color: "#7c3aed" },
              ],
              lines: [
                { label: "FCF", values: series.fcf, color: "#dc2626" },
              ],
              formatLeft: fmtEok,
            }} />
            <Legend items={[
              { label: "영업CF", color: "#10b981", bar: true },
              { label: "투자CF", color: "#94a3b8", bar: true },
              { label: "재무CF", color: "#7c3aed", bar: true },
              { label: "FCF", color: "#dc2626" },
            ]} />
          </ChartCard>
        )}

        {chart5Visible && (
          <ChartCard title="주주환원" sub="DPS + 배당수익률/성향 (우축)"
                     criteriaMetric="DPS" betterUp={true}
                     trend={assessTrend(series.dps, true)}>
            <Chart cfg={{
              width: W, height: H, years,
              bars: [
                { label: "DPS", values: series.dps, color: "#f59e0b" },
              ],
              lines: [
                { label: "배당수익률", values: series.dividend_yield,  color: "#dc2626", axis: "right" },
                { label: "배당성향",   values: series.dividend_payout, color: "#94a3b8", axis: "right", dashed: true },
              ],
              formatLeft: fmtKrw,
              formatRight: fmtPct,
            }} />
            <Legend items={[
              { label: "DPS (좌)", color: "#f59e0b", bar: true },
              { label: "배당수익률 (우)", color: "#dc2626" },
              { label: "배당성향 (우)", color: "#94a3b8", dashed: true },
            ]} />
          </ChartCard>
        )}

        {chart6Visible && (
          <ChartCard title="설비투자 (CAPEX)" sub="설비투자 규모 + 매출대비 비율(우축)">
            <Chart cfg={{
              width: W, height: H, years,
              bars: [
                { label: "CAPEX", values: capexAbs, color: "#0891b2" },  // cyan-600
              ],
              lines: [
                { label: "매출대비", values: capexRatio, color: "#dc2626", axis: "right", dashed: true },
              ],
              formatLeft: fmtEok,
              formatRight: fmtPct,
            }} />
            <Legend items={[
              { label: "CAPEX (좌)", color: "#0891b2", bar: true },
              { label: "매출대비 % (우)", color: "#dc2626", dashed: true },
            ]} />
          </ChartCard>
        )}
      </div>
      {/* 영어약자 설명 — 차트 아래. 각 항목 글자색 = 그래프 색 */}
      <div className="mt-2 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-[10.5px] text-gray-600 leading-relaxed">
        <span className="font-bold text-gray-700">용어:</span>
        {" "}<b style={{ color: "#dc2626" }}>ROE</b> 자기자본수익률 (주주 돈으로 번 수익 비율 / 버핏 15%+ 선호)
        {" · "}<b style={{ color: "#f59e0b" }}>ROA</b> 총자산수익률 (자산 활용 효율)
        {" · "}<b className="text-gray-700">CF</b> Cash Flow (현금흐름)
        {" · "}<b style={{ color: "#dc2626" }}>FCF</b> Free Cash Flow (영업CF − CAPEX, 자유롭게 쓸 수 있는 현금)
        {" · "}<b className="text-gray-700">CAPEX</b> Capital Expenditure (설비투자)
        {" · "}<b style={{ color: "#f59e0b" }}>DPS</b> Dividend Per Share (주당 배당금)
        {" · "}<b style={{ color: "#10b981" }}>영업CF</b> 본업으로 번 현금
        {" · "}<b style={{ color: "#94a3b8" }}>투자CF</b> 설비/자산 매입·매각
        {" · "}<b style={{ color: "#7c3aed" }}>재무CF</b> 차입·상환·증자·배당
        {" · "}<b style={{ color: "#dc2626" }}>부채비율</b> 부채 ÷ 자기자본 (100% 이하 우량)
      </div>
    </section>
  );
}
