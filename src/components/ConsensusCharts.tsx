// 컨센서스 예상치 차트 — 토스 v2 estimate API (분기별 발표치 vs 애널리스트 예상치).
// 매출 / 영업이익 / EPS 3개. SVG 직접 (FinancialCharts 와 동일한 의존성 0 패턴).

import { useEffect, useState } from "react";
import type { EstimateSeries } from "../lib/api";
import { checkPersonalProxyPostSupport, type PersonalProxyStatus } from "../lib/proxyConfig";

const UPDATE_GUIDE_URL = "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/UPDATE-POST-SUPPORT.md";

interface Props {
  revenue?: EstimateSeries | null;
  operatingIncome?: EstimateSeries | null;
  eps?: EstimateSeries | null;
}

// 원(₩) 단위 큰 숫자 → 조/억 표기
function fmtKrwBig(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(0)}억`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}만`;
  return `${sign}${Math.round(abs)}`;
}

// 원 단위 소액 (EPS 등 주당금액)
function fmtKrwSmall(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString()}원`;
}

// "2023-06" → "23.6" (X축 라벨 짧게)
function shortPeriod(p: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (!m) return p;
  return `${m[1].slice(2)}.${parseInt(m[2], 10)}`;
}
// "2023-06" → year 추출 (X축 라벨 정책 — 연도 1회만 표시할 때)
function yearOf(p: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  return m ? m[1] : null;
}

// 시계열 추세 — 첫 → 마지막 비교. 모든 metric 은 ↑ 가 긍정 (매출/영업이익/EPS).
type Trend = "good" | "bad" | "neutral";
function assessTrend(values: (number | null)[]): Trend {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return "neutral";
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (Math.abs(last - first) < 1e-9) return "neutral";
  return last > first ? "good" : "bad";
}
const TREND_COLOR: Record<Trend, string> = {
  good:    "#dc2626",  // 빨강 (상승=긍정)
  bad:     "#2563eb",  // 파랑 (하락=부정)
  neutral: "#374151",  // gray-700 (변화 없음)
};

interface SingleChartProps {
  title: string;
  series: EstimateSeries;
  format: (v: number | null) => string;
}

function SingleChart({ title, series, format }: SingleChartProps) {
  const { points } = series;
  if (points.length < 2) {
    return (
      <section className="border border-gray-200 rounded p-2.5 bg-white">
        <h4 className="text-sm font-bold text-gray-700">{title}</h4>
        <p className="text-xs text-gray-400 py-4">데이터 부족</p>
      </section>
    );
  }
  // 차트 치수
  const W = 380, H = 160;
  const padTop = 12, padBottom = 22, padLeft = 50, padRight = 12;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const n = points.length;
  const slotW = innerW / Math.max(n - 1, 1);

  const vals: number[] = [];
  for (const p of points) {
    if (p.actual != null) vals.push(p.actual);
    if (p.estimate != null) vals.push(p.estimate);
  }
  const vMin = Math.min(0, ...vals);
  const vMax = Math.max(...vals);
  const vRange = vMax - vMin || 1;

  const y = (v: number) => padTop + innerH - ((v - vMin) / vRange) * innerH;
  const x = (i: number) => padLeft + i * slotW;

  // 가로 그리드 5단
  const ticks = Array.from({ length: 5 }, (_, i) => vMin + (vRange * i) / 4);

  // 실선(발표치) — actual 가 있는 연속 구간만
  const actualPath: string[] = [];
  points.forEach((p, i) => {
    if (p.actual == null) return;
    actualPath.push(`${actualPath.length === 0 ? "M" : "L"} ${x(i)} ${y(p.actual)}`);
  });

  // 점선(예상치) — estimate 가 있는 모든 점 (과거 분기 + 미래 분기)
  const estPath: string[] = [];
  points.forEach((p, i) => {
    if (p.estimate == null) return;
    estPath.push(`${estPath.length === 0 ? "M" : "L"} ${x(i)} ${y(p.estimate)}`);
  });

  // 마지막 발표치 분기 직전 분기 대비 변동률 (header 표시)
  const lastActual = [...points].reverse().find(p => p.actual != null);
  const surpriseColor = (s: number | null) =>
    s == null ? "#9ca3af" : s >= 0 ? "#dc2626" : "#2563eb";

  // 예상치 추세 평가 — 라인 + 마커 색에 반영
  const estTrend = assessTrend(points.map(p => p.estimate));
  const estColor = TREND_COLOR[estTrend];

  // X축 라벨 정책 — 분기 13개+ 일 때 비좁아 연도 첫 분기만 표시 (3월 또는 첫 등장 연도)
  const seenYears = new Set<string>();
  const xLabels = points.map((p, i) => {
    const yr = yearOf(p.period);
    if (!yr) return null;
    const show = !seenYears.has(yr);
    seenYears.add(yr);
    return show ? { i, label: `${yr.slice(2)}년` } : null;
  }).filter((v): v is { i: number; label: string } => v != null);

  return (
    <section className="border border-gray-200 rounded p-2.5 bg-white">
      <header className="mb-1">
        <h4 className="text-sm font-bold" style={{ color: estColor }}>
          {title}
          {estTrend === "good" && " ↑"}
          {estTrend === "bad" && " ↓"}
        </h4>
        {lastActual && (
          <p className="text-[10px] text-gray-500 mt-0.5">
            최근 {shortPeriod(lastActual.period)} 발표 {format(lastActual.actual)}
            {lastActual.surprise != null && (
              <>
                {" · "}
                <span style={{ color: surpriseColor(lastActual.surprise) }}>
                  서프라이즈 {lastActual.surprise >= 0 ? "+" : ""}
                  {lastActual.surprise.toFixed(2)}%
                </span>
              </>
            )}
          </p>
        )}
      </header>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img"
           className="block" preserveAspectRatio="xMidYMid meet">
        {/* 가로 그리드 + 좌측 라벨 */}
        {ticks.map((t, ti) => {
          const yy = y(t);
          return (
            <g key={`t-${ti}`}>
              <line x1={padLeft} x2={W - padRight} y1={yy} y2={yy}
                    stroke="#f3f4f6" strokeWidth="0.5" />
              <text x={padLeft - 4} y={yy + 3} fontSize="9" fill="#6b7280" textAnchor="end">
                {format(t)}
              </text>
            </g>
          );
        })}
        {/* 0 라인 강조 */}
        {vMin < 0 && (
          <line x1={padLeft} x2={W - padRight} y1={y(0)} y2={y(0)}
                stroke="#9ca3af" strokeWidth="0.8" />
        )}
        {/* 예상치 라인 (추세별 색 점선) */}
        {estPath.length > 0 && (
          <path d={estPath.join(" ")} fill="none" stroke={estColor} strokeWidth="1.5"
                strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* 예상치 점 */}
        {points.map((p, i) => p.estimate != null && (
          <circle key={`e-${i}`} cx={x(i)} cy={y(p.estimate)} r="2.2"
                  fill={estColor} />
        ))}
        {/* 발표치 라인 (파란 실선) */}
        {actualPath.length > 0 && (
          <path d={actualPath.join(" ")} fill="none" stroke="#2563eb" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* 발표치 점 — 서프라이즈 부호로 색 변경 (양수=빨강, 음수=파랑, 0/없음=회색) */}
        {points.map((p, i) => p.actual != null && (
          <circle key={`a-${i}`} cx={x(i)} cy={y(p.actual)} r="2.8"
                  fill={surpriseColor(p.surprise)} />
        ))}
        {/* X축 라벨 — 연도 첫 등장 분기에 "23년" 표기 */}
        {xLabels.map(({ i, label }) => (
          <text key={`xl-${i}`} x={x(i)} y={H - 6}
                fontSize="10" fill="#6b7280" textAnchor="middle">
            {label}
          </text>
        ))}
      </svg>
      {/* 범례 */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] mt-0.5 text-gray-700">
        <span className="inline-flex items-center gap-1">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3"
            stroke="#2563eb" strokeWidth="2" /></svg>
          발표치
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3"
            stroke={estColor} strokeWidth="2" strokeDasharray="3 2" /></svg>
          예상치 (추세색)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#dc2626" }} />
          서프라이즈+
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#2563eb" }} />
          서프라이즈−
        </span>
      </div>
    </section>
  );
}

export function ConsensusCharts({ revenue, operatingIncome, eps }: Props) {
  const anyData = !!(revenue?.points.length || operatingIncome?.points.length || eps?.points.length);

  // 빈 상태 — 개인 프록시 사용 중 + 워커가 구버전(POST 미지원) 인지 1회 검증
  const [proxyStatus, setProxyStatus] = useState<PersonalProxyStatus | "checking">("checking");
  useEffect(() => {
    if (anyData) return;  // 데이터 있으면 검증 불필요
    void checkPersonalProxyPostSupport().then(setProxyStatus);
  }, [anyData]);

  if (!anyData) {
    // 워커가 구버전이라 판명된 경우만 안내. (no-personal / ok / error / checking 은 표시 안 함)
    if (proxyStatus !== "outdated") return null;
    return (
      <section className="mt-3">
        <header className="mb-2 flex items-baseline gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-gray-700">🔮 컨센서스 예상치 (분기)</h3>
        </header>
        <div className="p-3 bg-amber-50 border border-amber-300 rounded text-sm">
          <p className="font-bold text-amber-800">
            ⚠️ 등록하신 개인 워커가 구버전입니다
          </p>
          <p className="text-amber-700 text-[12px] mt-1 leading-relaxed">
            컨센서스 예상치 차트는 POST 호출을 지원하는 새 워커가 필요합니다.
            기존 가격/차트/공매도/재무추이 등 다른 기능은 영향 없이 정상 작동합니다.
          </p>
          <a href={UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer"
             className="inline-block mt-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700
                        text-white text-[12px] font-bold rounded">
            📘 5분 업데이트 가이드 열기 ↗
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-3">
      <header className="mb-2 flex items-baseline gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-gray-700">🔮 컨센서스 예상치 (분기)</h3>
        <span className="text-[10px] text-gray-400">
          출처: 토스 / FnGuide · 발표치 vs 애널리스트 평균 예상 · 점 색 = 서프라이즈 방향
        </span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {revenue && <SingleChart title="예상 매출" series={revenue} format={fmtKrwBig} />}
        {operatingIncome && <SingleChart title="예상 영업이익" series={operatingIncome} format={fmtKrwBig} />}
        {eps && <SingleChart title="예상 EPS (주당순이익)" series={eps} format={fmtKrwSmall} />}
      </div>
    </section>
  );
}
