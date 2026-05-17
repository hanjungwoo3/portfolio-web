import { useMemo, useState } from "react";
import type { KrSectorEtfRank } from "../lib/api";
import type { SortMode } from "./SectorRankingTab";

// 거래대금/흐름 단축 — 원 → 억/조 만 (만 단위 생략, 1억 미만은 소수점 억)
function fmtAmount(amt: number | null): string {
  if (amt == null || !Number.isFinite(amt)) return "";
  const sign = amt < 0 ? "-" : "";
  const abs = Math.abs(amt);
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
  if (abs >= 1e8)  return `${sign}${Math.round(abs / 1e8).toLocaleString()}억`;
  if (abs >= 1e7)  return `${sign}${(abs / 1e8).toFixed(1)}억`;   // 1천만 이상 → 0.X억
  if (abs > 0)     return `${sign}<0.1억`;                          // 그 미만
  return "0원";
}

// 섹터 순위 변동 Bump Chart (SVG).
// X = 기간 (20일 → 10일 → 5일 → 오늘, 시간순)
// Y = 순위 (1 위쪽, N 아래쪽)
// 각 섹터별 라인 — 라인이 위로 가면 순위 상승 = 자금 유입.

type Period = "d20" | "d10" | "d5" | "today";
type AmtKey = "amountD20" | "amountD10" | "amountD5" | "amountToday";
type ObvKey = "obvD20" | "obvD10" | "obvD5" | "obvToday";
const PERIODS: { key: Period; amtKey: AmtKey; obvKey: ObvKey; label: string }[] = [
  { key: "d20",   amtKey: "amountD20",   obvKey: "obvD20",   label: "20일" },
  { key: "d10",   amtKey: "amountD10",   obvKey: "obvD10",   label: "10일" },
  { key: "d5",    amtKey: "amountD5",    obvKey: "obvD5",    label: "5일" },
  { key: "today", amtKey: "amountToday", obvKey: "obvToday", label: "오늘" },
];

// 12색 카테고리 팔레트 — Tableau 10 + 2개 보강. HSL 균등 분포보다 인접 색 구분 잘됨.
const PALETTE_12 = [
  "#1f77b4", // 파랑
  "#ff7f0e", // 주황
  "#2ca02c", // 초록
  "#d62728", // 빨강
  "#9467bd", // 보라
  "#8c564b", // 갈색
  "#e377c2", // 분홍
  "#17becf", // 청록
  "#bcbd22", // 올리브
  "#e7ba52", // 황금
  "#ad494a", // 진홍
  "#a55194", // 자주
];
function colorOf(i: number, _n: number, isMarket?: boolean): string {
  if (isMarket) return "#d1d5db";  // gray-300
  return PALETTE_12[i % PALETTE_12.length];
}

interface Props {
  ranks: KrSectorEtfRank[];
  sortMode: SortMode;
  hoverTicker?: string | null;
  onHover?: (ticker: string | null) => void;
}

interface SectorRow {
  ticker: string;
  name: string;
  isMarket?: boolean;
  rankByPeriod: Record<Period, number | null>;  // 1 = 최고, null = 데이터 없음
  pctByPeriod: Record<Period, number | null>;
  amtByPeriod: Record<Period, number | null>;   // 거래대금 (원)
  obvByPeriod: Record<Period, number | null>;   // OBV-like 누적 (원)
}

// sortMode 별 정렬 key
function sortKeyOf(mode: SortMode, pct: number | null, amt: number | null, obv: number | null): number | null {
  if (mode === "pct") return pct;
  if (mode === "amount") return amt;
  return obv;
}

function computeRanks(ranks: KrSectorEtfRank[], sortMode: SortMode): SectorRow[] {
  if (ranks.length === 0) return [];
  const rankMap: Record<Period, Map<string, number>> = {
    today: new Map(), d5: new Map(), d10: new Map(), d20: new Map(),
  };
  for (const p of PERIODS) {
    const sorted = [...ranks]
      .map(r => ({ r, key: sortKeyOf(sortMode, r[p.key], r[p.amtKey], r[p.obvKey]) }))
      .filter(x => x.key != null)
      .sort((a, b) => b.key! - a.key!);
    sorted.forEach((x, i) => rankMap[p.key].set(x.r.ticker, i + 1));
  }
  return ranks.map(r => ({
    ticker: r.ticker, name: r.name, isMarket: r.isMarket,
    rankByPeriod: {
      today: rankMap.today.get(r.ticker) ?? null,
      d5:    rankMap.d5.get(r.ticker) ?? null,
      d10:   rankMap.d10.get(r.ticker) ?? null,
      d20:   rankMap.d20.get(r.ticker) ?? null,
    },
    pctByPeriod: {
      today: r.today, d5: r.d5, d10: r.d10, d20: r.d20,
    },
    amtByPeriod: {
      today: r.amountToday, d5: r.amountD5, d10: r.amountD10, d20: r.amountD20,
    },
    obvByPeriod: {
      today: r.obvToday, d5: r.obvD5, d10: r.obvD10, d20: r.obvD20,
    },
  }));
}

export function SectorBumpChart({ ranks, sortMode, hoverTicker, onHover }: Props) {
  // 부모가 controlled 로 hoverTicker 전달하면 그 값 사용, 아니면 내부 state
  const [innerHover, setInnerHover] = useState<string | null>(null);
  const hover = hoverTicker !== undefined ? hoverTicker : innerHover;
  const setHover = (t: string | null) => {
    if (onHover) onHover(t);
    else setInnerHover(t);
  };
  const rows = useMemo(() => computeRanks(ranks, sortMode), [ranks, sortMode]);
  const n = rows.length;

  if (n < 2) {
    return (
      <div className="text-xs text-gray-400 py-6 text-center border border-gray-200 rounded">
        그래프 표시할 데이터가 충분치 않습니다
      </div>
    );
  }

  // 레이아웃 — viewBox 기준. padLeft/padRight 동일 → 4 X점이 균등 4컬럼 표와 정렬.
  const W = 1200, H = 360;
  const padLeft = 110, padRight = 110, padTop = 26, padBottom = 32;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const xFor = (i: number) => padLeft + (innerW / (PERIODS.length - 1)) * i;
  // Y = 순위 기반 (1 위쪽, N 아래쪽). % 는 점 옆 라벨로만 표시.
  const yFor = (rank: number) => padTop + (innerH / (n - 1)) * (rank - 1);

  // 각 기간 별 거래대금 max — 점 크기 정규화용
  const maxAmtByPeriod: Record<Period, number> = {} as Record<Period, number>;
  for (const p of PERIODS) {
    const amts = rows.map(r => r.amtByPeriod[p.key])
      .filter((v): v is number => v != null && v > 0);
    maxAmtByPeriod[p.key] = amts.length > 0 ? Math.max(...amts) : 1;
  }
  // 점 반지름: 최소 2 + (amt/max) × 5 → 거래대금 큰 점이 크게
  const radiusFor = (period: Period, amt: number | null, isHovered: boolean): number => {
    const ratio = amt != null && amt > 0
      ? Math.sqrt(amt / maxAmtByPeriod[period])  // sqrt 로 차이 완화
      : 0.3;
    const base = 2 + ratio * 5;
    return isHovered ? base + 1.5 : base;
  };

  // 세그먼트 두께 = 두 점 반지름 평균 × 2 (점 지름과 동일) — 점에서 라인이 매끄럽게 이어짐
  const segmentWidth = (period1: Period, amt1: number | null,
                        period2: Period, amt2: number | null,
                        isHovered: boolean): number => {
    const r1 = radiusFor(period1, amt1, isHovered);
    const r2 = radiusFor(period2, amt2, isHovered);
    return r1 + r2;   // (r1+r2)/2 × 2 = r1+r2 → 평균 지름
  };

  // 끝점(오늘) 순위 기준 정렬
  const todaySorted = [...rows]
    .filter(r => r.rankByPeriod.today != null)
    .sort((a, b) => a.rankByPeriod.today! - b.rankByPeriod.today!);

  // X축 grid
  const xTicks = PERIODS.map((p, i) => ({ x: xFor(i), label: p.label }));
  // Y축 grid (순위 1, 5, 10, N)
  const yTickRanks = Array.from({ length: n }, (_, i) => i + 1)
    .filter(r => r === 1 || r % 5 === 0 || r === n);

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <svg viewBox={`0 0 ${W} ${H}`}
           preserveAspectRatio="xMidYMid meet"
           className="w-full h-auto"
           role="img" aria-label="섹터 순위 변동 차트">
        {/* X축 라벨 + 세로 grid */}
        {xTicks.map((t, i) => (
          <g key={`xt-${i}`}>
            <line x1={t.x} x2={t.x} y1={padTop} y2={H - padBottom}
                  stroke="#f3f4f6" strokeWidth="1" />
            <text x={t.x} y={H - padBottom + 18}
                  textAnchor="middle" fontSize="11" fill="#6b7280">
              {t.label}
            </text>
          </g>
        ))}
        {/* Y축 라벨 (순위) */}
        {yTickRanks.map(r => (
          <g key={`yt-${r}`}>
            <text x={padLeft - 6} y={yFor(r) + 3}
                  textAnchor="end" fontSize="10" fill="#9ca3af">
              {r}위
            </text>
            <line x1={padLeft} x2={W - padRight} y1={yFor(r)} y2={yFor(r)}
                  stroke="#f9fafb" strokeWidth="1" />
          </g>
        ))}

        {/* 섹터별 라인 + 점 + 각 점에 등락률 표시 */}
        {rows.map((row, i) => {
          const color = colorOf(i, n, row.isMarket);
          const points = PERIODS
            .map(p => ({
              x: xFor(PERIODS.indexOf(p)),
              rank: row.rankByPeriod[p.key],
              pct: row.pctByPeriod[p.key],
              amt: row.amtByPeriod[p.key],
              period: p.key,
            }))
            .filter((pt): pt is { x: number; rank: number; pct: number | null; amt: number | null; period: Period } => pt.rank != null);
          if (points.length < 2) return null;
          const isActive = hover === null || hover === row.ticker;
          const opacity = isActive ? 1 : 0.18;
          const isHovered = hover === row.ticker;
          return (
            <g key={row.ticker} opacity={opacity}
               onMouseEnter={() => setHover(row.ticker)}
               onMouseLeave={() => setHover(null)}
               style={{ cursor: "pointer" }}>
              {/* 세그먼트 별 두께 — 두 점 amount 평균 비례. 라인은 50% 투명 (점이 강조) */}
              {points.slice(0, -1).map((pt, k) => {
                const next = points[k + 1];
                const sw = segmentWidth(pt.period, pt.amt, next.period, next.amt, isHovered);
                return (
                  <line key={`seg-${k}`}
                        x1={pt.x} y1={yFor(pt.rank)}
                        x2={next.x} y2={yFor(next.rank)}
                        stroke={color} strokeWidth={sw}
                        strokeOpacity={0.3}
                        strokeLinecap="round" />
                );
              })}
              {points.map((pt, k) => {
                const y = yFor(pt.rank);
                const r = radiusFor(pt.period, pt.amt, isHovered);
                // 점 위 라벨 = 정렬 모드 값 (각 기간 별)
                const obvForPeriod = row.obvByPeriod[pt.period];
                let label = "";
                let value: number | null = null;
                if (sortMode === "pct" && pt.pct != null) {
                  label = `${pt.pct >= 0 ? "+" : ""}${pt.pct.toFixed(1)}%`;
                  value = pt.pct;
                } else if (sortMode === "amount" && pt.amt != null) {
                  label = fmtAmount(pt.amt);
                  value = pt.amt;
                } else if (sortMode === "obv" && obvForPeriod != null) {
                  label = fmtAmount(obvForPeriod);
                  value = obvForPeriod;
                }
                // 호버 시 라벨 색 = 부호별 (양수 빨강 / 음수 파랑)
                const labelColor = isHovered && value != null
                  ? (value > 0 ? "#dc2626" : value < 0 ? "#2563eb" : "#6b7280")
                  : color;
                return (
                  <g key={k}>
                    <circle cx={pt.x} cy={y} r={r}
                            fill={color} stroke="#fff" strokeWidth="1" />
                    {/* 점 위 = 정렬 모드 값 — 호버 시 부호별 색 */}
                    {label && (
                      <text x={pt.x} y={y - r - 3}
                            textAnchor="middle"
                            fontSize={isHovered ? 9 : 8}
                            fill={labelColor}
                            fontWeight={isHovered ? 700 : 500}
                            opacity={isHovered ? 1 : 0.7}>
                        {label}
                      </text>
                    )}
                    {/* 점 아래 = 순위 — 호버 시에만 표시 */}
                    {isHovered && (
                      <text x={pt.x} y={y + r + 9}
                            textAnchor="middle"
                            fontSize="9"
                            fill="#6b7280"
                            fontWeight="600">
                        {pt.rank}위
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* 우측 끝점 라벨 — 섹터명만 (정렬값은 점 위 라벨과 중복이라 제거) */}
        {todaySorted.map(row => {
          const i = rows.findIndex(r => r.ticker === row.ticker);
          const color = colorOf(i, n, row.isMarket);
          const lastRank = row.rankByPeriod.today!;
          const xEnd = xFor(PERIODS.length - 1);
          const yEnd = yFor(lastRank);
          const isActive = hover === null || hover === row.ticker;
          return (
            <g key={`lbl-${row.ticker}`} opacity={isActive ? 1 : 0.2}>
              <text x={xEnd + 6} y={yEnd + 3}
                    fontSize="11" fill={color}
                    style={{ fontWeight: hover === row.ticker ? 700 : 500 }}>
                {row.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 text-[10px] text-gray-500 text-center">
        라인이 우상향(오늘 쪽으로 위) = 순위 상승 · 점 크기 = 거래대금 ·
        점 위 숫자 = 등락률(%) · 마우스 올리면 강조
      </div>
    </div>
  );
}
