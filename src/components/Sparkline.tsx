// 작은 SVG 스파크라인 — 라인 + 영역 채움.
// 한국식 색: 첫값보다 끝값 ↑ = 빨강 / ↓ = 파랑 / 동일 = 회색.

interface Props {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  // 강제 색 지정 (옵션). 미지정 시 트렌드 자동 결정.
  color?: string;
}

export function Sparkline({
  data, width = 120, height = 32, className = "", color,
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

  const min = Math.min(...data);
  const max = Math.max(...data);
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
    </svg>
  );
}
