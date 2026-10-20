// 작은 SVG 스파크라인 — 라인 + 영역 채움.
// 한국식 색: 첫값보다 끝값 ↑ = 빨강 / ↓ = 파랑 / 동일 = 회색.
// 기준선(baseline)을 주면 **선 위 구간은 빨강, 아래 구간은 파랑**으로 나눠 칠한다(채움도 기준선까지).
import { useId } from "react";

interface Props {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  // 강제 색 지정 (옵션). 미지정 시 트렌드 자동 결정.
  color?: string;
  // 목표가 가로선 (옵션) — 차트 Y 축 범위에 포함시켜 표시 (점선, amber)
  target?: number;
  // 매수가 가로선 (옵션) — Y 축 범위에 포함 (점선, emerald)
  avgPrice?: number;
  // 기대가 가로선 (옵션) — Y 축 범위에 포함 (점선, violet)
  entry?: number;
  // 라인 두께 (옵션, 기본 1.5). 배경용으로 얇게 하고 싶을 때.
  strokeWidth?: number;
  // 세로 표시선 위치(data 인덱스) — 24시간 차트에서 '오늘 정규장 시작'(프리마켓 뒤) 지점. 점선 + 그 값에 점.
  markIndex?: number;
  // 기준선 위·아래 색(기본 빨강·파랑) — 거꾸로 칠하는 카드(VIX·환율)는 바꿔서 넘긴다
  aboveColor?: string;
  belowColor?: string;
  // 기준선(어제 종가) — 회색 가로 점선, Y 범위에 포함. 주면 **색도 이 값 기준**(끝값 > 기준 = 빨강)으로 칠한다
  //   — 24시간 차트의 첫 점은 프리장 시작이라, 첫 점 기준 색은 카드 큰 숫자(어제 종가 대비)와 어긋났다(2026-10-20).
  baseline?: number;
}

export function Sparkline({
  data, width = 120, height = 32, className = "", color, target, avgPrice, entry, strokeWidth = 1.5, markIndex, baseline,
  aboveColor = "#dc2626", belowColor = "#2563eb",
}: Props) {
  const uid = useId().replace(/:/g, "");   // 위·아래 잘라내기(clipPath)·그라디언트 id — 카드마다 달라야 한다
  if (!data || data.length < 2) {
    return (
      <div className={className}
           style={{ width, height }}
           aria-label="차트 로드 중" />
    );
  }

  const hasBase = baseline !== undefined && baseline > 0;
  const first = hasBase ? baseline! : data[0];
  const last = data[data.length - 1];
  const trendColor =
    color ?? (last > first ? "#dc2626"   // rose-600
            : last < first ? "#2563eb"   // blue-600
            : "#94a3b8");                 // slate-400

  // 목표가·매수가·기대가가 있으면 Y 범위에 포함 (모두 보이도록)
  const allValues = [...data];
  if (target !== undefined && target > 0) allValues.push(target);
  if (avgPrice !== undefined && avgPrice > 0) allValues.push(avgPrice);
  if (entry !== undefined && entry > 0) allValues.push(entry);
  if (hasBase) allValues.push(baseline!);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const padX = 1;
  const padY = 2;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  // 정규화 좌표
  const points = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * innerW;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  // 라인 path
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  // 영역 채움 path (라인 아래쪽으로 닫기)
  const areaPath = `${linePath} L ${points[points.length - 1][0].toFixed(2)} ${(height - padY).toFixed(2)} `
                 + `L ${points[0][0].toFixed(2)} ${(height - padY).toFixed(2)} Z`;

  // 그라디언트 ID — 색별 고유
  const gradId = `spark-grad-${trendColor.replace("#", "")}`;

  // 가로선 Y 좌표 변환
  const yFor = (v: number) => padY + innerH - ((v - min) / range) * innerH;
  const targetY = target !== undefined && target > 0 ? yFor(target) : null;
  const avgY = avgPrice !== undefined && avgPrice > 0 ? yFor(avgPrice) : null;
  const entryY = entry !== undefined && entry > 0 ? yFor(entry) : null;
  const baseY = hasBase ? yFor(baseline!) : null;

  return (
    <svg width={width} height={height} className={className}
         viewBox={`0 0 ${width} ${height}`}
         preserveAspectRatio="none"
         role="img" aria-label="추세">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={trendColor} stopOpacity="0.35" />
          <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      {baseY !== null && !color ? (() => {
        // 기준선 위·아래 분할 — 같은 선을 두 번 그리고 위/아래 영역으로 잘라 색을 다르게.
        //   채움은 선과 기준선 사이(바닥까지가 아니라) — 기준선을 넘나드는 구간이 바로 보인다.
        const last = points[points.length - 1], firstPt = points[0];
        const bandPath = `${linePath} L ${last[0].toFixed(2)} ${baseY.toFixed(2)} L ${firstPt[0].toFixed(2)} ${baseY.toFixed(2)} Z`;
        return (
          <>
            <defs>
              <clipPath id={`${uid}-up`}><rect x="0" y="0" width={width} height={baseY} /></clipPath>
              <clipPath id={`${uid}-dn`}><rect x="0" y={baseY} width={width} height={Math.max(0, height - baseY)} /></clipPath>
            </defs>
            <g clipPath={`url(#${uid}-up)`}>
              <path d={bandPath} fill={aboveColor} fillOpacity="0.22" />
              <path d={linePath} fill="none" stroke={aboveColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
            </g>
            <g clipPath={`url(#${uid}-dn)`}>
              <path d={bandPath} fill={belowColor} fillOpacity="0.22" />
              <path d={linePath} fill="none" stroke={belowColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          </>
        );
      })() : (
        <>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke={trendColor} strokeWidth={strokeWidth}
                strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
      {/* 어제 종가 — 회색 가로 점선 (24시간 차트) */}
      {baseY !== null && (
        <line x1={padX} x2={width - padX} y1={baseY} y2={baseY}
              stroke="#475569" strokeWidth="1" strokeDasharray="4 3" opacity="0.8" />
      )}
      {/* 오늘 정규장 시작 — 회색 세로 점선 + 시작가 점 (24시간 차트) */}
      {markIndex != null && markIndex > 0 && markIndex < points.length && (
        <>
          <line x1={points[markIndex][0]} x2={points[markIndex][0]} y1={padY} y2={height - padY}
                stroke="#334155" strokeWidth="1.2" strokeDasharray="3 2" opacity="0.9" />
          <circle cx={points[markIndex][0]} cy={points[markIndex][1]} r="3" fill="#334155" />
        </>
      )}
      {/* 목표가 — amber 점선 */}
      {targetY !== null && (
        <line x1={padX} x2={width - padX} y1={targetY} y2={targetY}
              stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 2" />
      )}
      {/* 매수가 — emerald 점선 */}
      {avgY !== null && (
        <line x1={padX} x2={width - padX} y1={avgY} y2={avgY}
              stroke="#10b981" strokeWidth="1" strokeDasharray="3 2" />
      )}
      {/* 기대가 — violet 점선 (CandleChartLight 의 ENTRY_COLOR 와 동일) */}
      {entryY !== null && (
        <line x1={padX} x2={width - padX} y1={entryY} y2={entryY}
              stroke="#8b5cf6" strokeWidth="1" strokeDasharray="3 2" />
      )}
    </svg>
  );
}
