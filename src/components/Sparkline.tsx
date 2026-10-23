// 작은 SVG 스파크라인 — 라인 + 영역 채움.
// 한국식 색: 첫값보다 끝값 ↑ = 빨강 / ↓ = 파랑 / 동일 = 회색.
// 기준선(baseline)을 주면 **선 위 구간은 빨강, 아래 구간은 파랑**으로 나눠 칠한다(채움도 기준선까지).
import { useId } from "react";

// 정규장 세로선 — 시작 = 진한 점선, 종가 = 진한 실선(사용자 결정 2026-10-21, 글자·기호 없이 선 모양으로만 구분).
//   종가는 원래 연한 회색이었는데 분홍·보라 면에 묻혀 '마감선이 없다'로 보였다(사용자 지적 2026-10-23) → 시작과 같은 진한 색, 모양만 실선
const OPEN_LINE = { stroke: "#334155", strokeWidth: 1.2, strokeDasharray: "3 2", opacity: 0.9 } as const;
const CLOSE_LINE = { stroke: "#334155", strokeWidth: 1.2, opacity: 0.75 } as const;

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
  // 점마다 가로 위치(0~1) — 시간 축으로 그릴 때(예: 한국 08:00~20:00). 없으면 점을 고르게 편다.
  //   장 초반처럼 봉이 몇 개뿐일 때 선이 카드 전체로 늘어나지 않고 왼쪽에 짧게 그려진다.
  xs?: number[];
  // 이 인덱스에서 선을 끊는다(새 구간 시작) — 어제+오늘 차트에서 어제 마지막 봉과 오늘 첫 봉을 잇지 않고 비워 둔다
  breakIndex?: number;
  // 세로 표시선(종가) — '오늘 정규장 마감' 지점. 시작선과 같은 점선(점은 안 찍는다 — 사용자 결정)
  closeIndex?: number;
  // 어제 구간 정규장 [시작, 종가] 세로선(사용자 요청) — 오늘 것과 같은 모양(시작 = 진한 점선, 종가 = 연한 실선)
  extraMarks?: (number | undefined)[];
  // 끊은 앞 구간(어제)의 기준선 — 어제의 전일 종가. 주면 기준선이 **두 개**(왼쪽=어제 기준·오른쪽=오늘 기준)가 되고
  //   위·아래 색도 구간마다 자기 기준선으로 칠한다(카드 등락률과 같은 기준 — 어제는 어제 등락, 오늘은 오늘 등락).
  prevBaseline?: number;
  // 거래량(점마다, data 와 같은 길이) — 주면 아래 1/4 을 거래량 막대 자리로 비우고 회색 막대를 그린다(사용자 요청 2026-10-22)
  volumes?: number[];
}

export function Sparkline({
  data, width = 120, height = 32, className = "", color, target, avgPrice, entry, strokeWidth = 1.5, markIndex, baseline, xs, breakIndex, prevBaseline, closeIndex, extraMarks, volumes,
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
  if (prevBaseline !== undefined && prevBaseline > 0) allValues.push(prevBaseline);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const padX = 1;
  const padY = 2;
  const innerW = width - padX * 2;
  const hasVol = !!volumes && volumes.length === data.length && volumes.some(v => v > 0);
  const volH = hasVol ? Math.round(height * 0.25) : 0;   // 아래 거래량 띠 — 가격은 그 위에서만
  const innerH = height - padY * 2 - volH;

  // 정규화 좌표 — 시간 축(xs)이 없고 끊는 곳(breakIndex)이 있으면 그 사이에 빈칸(약 4%)을 둔다.
  //   한 칸 차이로 맞닿으면 끊어도 이어진 세로선처럼 보인다(야후 지수 카드 — 20:00→04:00 이 붙어 있음).
  const hasBrk = breakIndex != null && breakIndex > 0 && breakIndex < data.length;
  const gapSlots = hasBrk && !(xs && xs.length === data.length) ? Math.max(2, Math.round((data.length - 1) * 0.04)) : 0;
  const points = data.map((v, i) => {
    const frac = xs && xs.length === data.length ? Math.min(1, Math.max(0, xs[i]))
      : (i + (gapSlots && i >= breakIndex! ? gapSlots : 0)) / (data.length - 1 + gapSlots);
    const x = padX + frac * innerW;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  // 구간 — breakIndex 가 있으면 둘로 나눠 사이를 잇지 않는다(선·채움 모두)
  const segs: (readonly [number, number])[][] = breakIndex != null && breakIndex > 0 && breakIndex < points.length
    ? [points.slice(0, breakIndex), points.slice(breakIndex)] : [points];
  const segLine = (seg: (readonly [number, number])[]) =>
    seg.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  // 라인 path
  const linePath = segs.map(segLine).join(" ");
  // 영역 채움 path (구간마다 아래쪽으로 닫기)
  const closeTo = (y: number, ss = segs) => ss.filter(seg => seg.length > 0).map(seg =>
    `${segLine(seg)} L ${seg[seg.length - 1][0].toFixed(2)} ${y.toFixed(2)} L ${seg[0][0].toFixed(2)} ${y.toFixed(2)} Z`).join(" ");
  const areaPath = closeTo(height - padY);

  // 그라디언트 ID — 색별 고유
  const gradId = `spark-grad-${trendColor.replace("#", "")}`;

  // 가로선 Y 좌표 변환
  const yFor = (v: number) => padY + innerH - ((v - min) / range) * innerH;
  const targetY = target !== undefined && target > 0 ? yFor(target) : null;
  const avgY = avgPrice !== undefined && avgPrice > 0 ? yFor(avgPrice) : null;
  const entryY = entry !== undefined && entry > 0 ? yFor(entry) : null;
  const baseY = hasBase ? yFor(baseline!) : null;
  // 기준선 구간 — 어제 기준선이 있으면 끊는 곳 가운데(splitX)에서 좌우로 나눈다
  const splitX = segs.length === 2 ? (segs[0][segs[0].length - 1][0] + segs[1][0][0]) / 2 : width;
  const parts: { ss: typeof segs; by: number; x0: number; x1: number }[] = baseY === null ? []
    : segs.length === 2 && prevBaseline !== undefined && prevBaseline > 0
      ? [{ ss: [segs[0]], by: yFor(prevBaseline), x0: 0, x1: splitX }, { ss: [segs[1]], by: baseY, x0: splitX, x1: width }]
      : [{ ss: segs, by: baseY, x0: 0, x1: width }];

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
        //   기준선이 둘이면(어제·오늘) 구간마다 자기 기준선으로 — 잘라내기 영역도 그 구간 폭만.
        return parts.map(({ ss, by, x0, x1 }, k) => {
          const bandPath = closeTo(by, ss);   // 구간마다 기준선까지 닫는다
          const line = ss.map(segLine).join(" ");
          return (
            <g key={k}>
              <defs>
                <clipPath id={`${uid}-up${k}`}><rect x={x0} y="0" width={x1 - x0} height={by} /></clipPath>
                <clipPath id={`${uid}-dn${k}`}><rect x={x0} y={by} width={x1 - x0} height={Math.max(0, height - by)} /></clipPath>
              </defs>
              <g clipPath={`url(#${uid}-up${k})`}>
                <path d={bandPath} fill={aboveColor} fillOpacity="0.22" />
                <path d={line} fill="none" stroke={aboveColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
              </g>
              <g clipPath={`url(#${uid}-dn${k})`}>
                <path d={bandPath} fill={belowColor} fillOpacity="0.22" />
                <path d={line} fill="none" stroke={belowColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            </g>
          );
        });
      })() : (
        <>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke={trendColor} strokeWidth={strokeWidth}
                strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
      {/* 거래량 — 아래 띠. 직전 봉보다 오르면 빨강·내리면 파랑·같으면 회색(사용자 요청) */}
      {hasVol && (() => {
        // 기준 = 상위 5% 값 — 동시호가(15:30) 한 봉이 수십 배라 최대값에 맞추면 나머지가 다 바닥에 붙었다. 넘는 봉은 띠 높이로 자른다
        const sorted = volumes!.filter(v => v > 0).sort((x, y) => x - y);
        const vMax = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
        const bw = Math.max(0.8, (innerW / data.length) * 0.7);
        return volumes!.map((v, i) => v > 0 && (
          <rect key={`v${i}`} x={points[i][0] - bw / 2} width={bw} y={height - Math.min(1, v / vMax) * volH} height={Math.min(1, v / vMax) * volH}
                fill={i > 0 && data[i] < data[i - 1] ? belowColor : i > 0 && data[i] > data[i - 1] ? aboveColor : "#94a3b8"} opacity="0.55" />
        ));
      })()}
      {/* 기준선(전일 종가) — 회색 가로 점선 (24시간 차트). 어제·오늘 둘이면 좌우로 나눠 따로, 사이는 살짝 띄운다 */}
      {parts.map(({ by, x0, x1 }, k) => (
        <line key={k} x1={Math.max(padX, x0 + (k > 0 ? 2 : 0))} x2={Math.min(width - padX, x1 - (k < parts.length - 1 ? 2 : 0))} y1={by} y2={by}
              stroke="#475569" strokeWidth="1" strokeDasharray="4 3" opacity="0.8" />
      ))}
      {/* 오늘 정규장 시작 — 회색 세로 점선 (24시간 차트) */}
      {markIndex != null && markIndex > 0 && markIndex < points.length && (
        <>
          <line x1={points[markIndex][0]} x2={points[markIndex][0]} y1={padY} y2={height - padY} {...OPEN_LINE} />
        </>
      )}
      {(extraMarks ?? []).map((m, k) => m != null && m > 0 && m < points.length ? (
        k % 2 === 0
          ? <line key={`em${k}`} x1={points[m][0]} x2={points[m][0]} y1={padY} y2={height - padY} {...OPEN_LINE} />
          : <line key={`em${k}`} x1={points[m][0]} x2={points[m][0]} y1={padY} y2={height - padY} {...CLOSE_LINE} />
      ) : null)}
      {/* 오늘 정규장 종가 — 회색 세로 점선 */}
      {closeIndex != null && closeIndex > 0 && closeIndex < points.length && (
        <>
          <line x1={points[closeIndex][0]} x2={points[closeIndex][0]} y1={padY} y2={height - padY} {...CLOSE_LINE} />
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
