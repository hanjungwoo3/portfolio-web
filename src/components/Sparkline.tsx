// 작은 SVG 스파크라인 — 라인 + 영역 채움.
// 한국식 색: 첫값보다 끝값 ↑ = 빨강 / ↓ = 파랑 / 동일 = 회색.

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
}

export function Sparkline({
  data, width = 120, height = 32, className = "", color, target, avgPrice,
}: Props) {
  if (!data || data.length < 2) {
    return (
      <div className={className}
           style={{ width, height }}
           aria-label="차트 로드 중" />
    );
  }

  const first = data[0];
  const last = data[data.length - 1];
  const trendColor =
    color ?? (last > first ? "#dc2626"   // rose-600
            : last < first ? "#2563eb"   // blue-600
            : "#94a3b8");                 // slate-400

  // 목표가·매수가가 있으면 Y 범위에 포함 (모두 보이도록)
  const allValues = [...data];
  if (target !== undefined && target > 0) allValues.push(target);
  if (avgPrice !== undefined && avgPrice > 0) allValues.push(avgPrice);
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
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={trendColor} strokeWidth="1.5"
            strokeLinejoin="round" strokeLinecap="round" />
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
    </svg>
  );
}
