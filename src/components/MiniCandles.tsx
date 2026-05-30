// 인라인 SVG 미니 캔들 — sparkline 자리에 들어가는 작은 봉차트.
// 한국식 색: close > open = 빨강(rose-600), close < open = 파랑(blue-600), 같음 = 회색.

interface OHLC {
  open: number; high: number; low: number; close: number;
}
interface Props {
  data: OHLC[];
  width?: number;
  height?: number;
  className?: string;
  // 이동평균 — 숫자(기간), "auto", 또는 미리 계산된 값 배열 (data 와 같은 길이, null 가능)
  ma?: number | "auto" | (number | null)[];
}

// 단순이동평균 (SMA). i < period-1 인 구간은 null 로 채워 인덱스 동기화 유지.
function smaCompute(ys: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < ys.length; i++) {
    sum += ys[i];
    if (i >= period) sum -= ys[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function MiniCandles({ data, width = 160, height = 32, className = "", ma }: Props) {
  if (!data || data.length < 2) {
    return <div className={className} style={{ width, height }} aria-label="데이터 부족" />;
  }
  const n = data.length;
  const min = Math.min(...data.map(d => d.low));
  const max = Math.max(...data.map(d => d.high));
  const range = max - min || 1;
  const padY = 2;
  const innerH = height - padY * 2;
  // 봉 폭 — 너무 좁으면 1px, 일반적으론 (width / n) 의 ~70%
  const cellW = width / n;
  const bodyW = Math.max(1, Math.min(cellW * 0.75, 8));

  const y = (v: number) => padY + (1 - (v - min) / range) * innerH;

  // 이동평균선 — 배열 직접 받거나 (precomputed), 기간으로 계산
  let maPath: string | null = null;
  let maColor = "#f59e0b";   // amber-500 — 토스 차트 스타일
  if (ma !== undefined && n >= 3) {
    let values: (number | null)[] | null = null;
    if (Array.isArray(ma)) {
      values = ma.length === n ? ma : null;
    } else {
      const period = ma === "auto"
        ? Math.max(3, Math.min(20, Math.floor(n / 5)))
        : ma;
      if (period >= 2 && period < n) {
        values = smaCompute(data.map(d => d.close), period);
      }
    }
    if (values) {
      const segs: string[] = [];
      let started = false;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v == null) { started = false; continue; }
        const cx = (i + 0.5) * cellW;
        segs.push(`${started ? "L" : "M"} ${cx.toFixed(2)} ${y(v).toFixed(2)}`);
        started = true;
      }
      if (segs.length >= 2) maPath = segs.join(" ");
    }
  }

  return (
    <svg width={width} height={height} className={className}
         viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const cx = (i + 0.5) * cellW;
        const yHigh = y(d.high);
        const yLow  = y(d.low);
        const yOpen  = y(d.open);
        const yClose = y(d.close);
        const up = d.close > d.open;
        const flat = d.close === d.open;
        const color = up ? "#dc2626" : flat ? "#94a3b8" : "#2563eb";
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1, Math.abs(yClose - yOpen));
        return (
          <g key={i}>
            {/* wick */}
            <line x1={cx} x2={cx} y1={yHigh} y2={yLow}
                  stroke={color} strokeWidth={0.8} />
            {/* body */}
            <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH}
                  fill={color} />
          </g>
        );
      })}
      {/* 이동평균선 — 캔들 위에 부드러운 선 */}
      {maPath && (
        <path d={maPath} fill="none"
              stroke={maColor} strokeWidth={1.4}
              strokeLinejoin="round" strokeLinecap="round" opacity={0.8} />
      )}
    </svg>
  );
}
