import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketDeposit, type MarketDepositData, type FundFlowKey } from "../lib/api";

// 증시 자금동향 — 고객예탁금·신용잔고·주식형/채권형/혼합형 펀드.
//   계열마다 독립 패널 하나씩, 한 줄에 다섯 개. 예전엔 성격별로 두 묶음에 겹쳐 그렸는데
//   규모가 제각각이라(예탁금 102조 vs 신용 32조) 축을 나누거나 %로 환산해야 했고, 그때마다
//   "이 선이 어느 축인지" 를 설명해야 했다. 하나씩 떼면 각자 제 축을 쓰므로 그 설명이 사라진다.
//   겹쳐 보던 비교는 패널을 나란히 두는 것으로 대신한다.
//   단위 억원, 한국식 색: 증가=빨강 / 감소=파랑 (금액 변화 표기에만 적용).

// ★ 2026-09-12: finance.naver.com/sise/sise_deposit.naver 는 302 로 새 주소로 넘어간다.
const NAVER_URL = "https://stock.naver.com/market/stock/kr/deposit";

const LABEL: Record<FundFlowKey, string> = {
  deposit: "고객예탁금", credit: "신용잔고",
  stock: "주식형", mixed: "혼합형", bond: "채권형",
};
const HINT: Record<FundFlowKey, string> = {
  deposit: "증시 대기 매수자금",
  credit: "빚내서 산 잔고(레버리지)",
  stock: "주식형 펀드 설정액",
  mixed: "주식+채권 혼합 펀드",
  bond: "채권형 펀드 설정액",
};
// 패널이 따로라 색이 겹쳐도 헷갈리진 않지만, 카드 전체를 훑을 때 구분되게 다섯을 다르게 둔다.
const COLOR: Record<FundFlowKey, string> = {
  deposit: "#2563eb", credit: "#dc2626",
  stock: "#7c3aed", bond: "#0891b2", mixed: "#f59e0b",
};
// 왼쪽부터: 직접자금(대기·빚) → 펀드(주식·채권·혼합)
const ORDER: FundFlowKey[] = ["deposit", "credit", "stock", "bond", "mixed"];

const fmtJo = (eok: number) => `${(eok / 10000).toFixed(1)}조`;
function fmtDiff(eok: number): string {
  const sign = eok > 0 ? "+" : eok < 0 ? "−" : "";
  const jo = Math.abs(eok) / 10000;
  return jo >= 0.01 ? `${sign}${jo.toFixed(2)}조` : `${sign}${Math.abs(eok).toLocaleString()}억`;
}
const diffColor = (d: number) => (d > 0 ? "text-rose-600" : d < 0 ? "text-blue-600" : "text-gray-400");
const ddFmt = (d: string) => (d?.length >= 8 ? d.slice(3) : d);   // "26.07.06" → "07.06"

// 눈금 nice-bounds
function niceBounds(min: number, max: number, ticks: number) {
  const range = (max - min) || Math.abs(max) || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(range / ticks)));
  const norm = range / ticks / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi === lo) hi = lo + step;
  return { lo, hi, step };
}

// 계열 하나짜리 미니 차트. 자기 범위에 맞춰 축을 잡으므로 축 설명이 필요 없다.
//
// hover 는 카드가 들고 다섯 패널이 공유한다 — 한 곳에 올리면 같은 날짜의 값이 다섯 군데서
//   동시에 바뀐다. 예탁금이 빠질 때 신용이 같이 빠졌는지 같은 건 그렇게 봐야 읽힌다.
//   값은 패널 헤더의 큰 숫자가 대신 보여준다. 툴팁 다섯 개가 동시에 뜨면 서로를 가린다.
function MiniChart({ series, dates, color, hover, onHover }: {
  series: number[]; dates: string[]; color: string;
  hover: number | null; onHover: (i: number | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  if (series.length < 2) return <div className="h-[92px]" />;

  const W = 300, H = 104, mL = 34, mR = 6, mT = 6, mB = 14;
  const pw = W - mL - mR, ph = H - mT - mB;
  const n = series.length;
  const x = (i: number) => mL + (i / (n - 1)) * pw;

  // 평평한 구간이 직선으로 뭉개지지 않게 최소 폭을 준다.
  const min = Math.min(...series), max = Math.max(...series);
  const mid = (min + max) / 2 || 1;
  const pad = Math.max((max - min) * 0.18, Math.abs(mid) * 0.002);
  const { lo, hi, step } = niceBounds(min - pad, max + pad, 3);
  const y = (v: number) => mT + (1 - (v - lo) / (hi - lo)) * ph;

  const ticks: { y: number; text: string }[] = [];
  for (let t = lo; t <= hi + step * 0.001; t += step) {
    const jo = t / 10000;
    ticks.push({ y: y(t), text: jo >= 100 ? jo.toFixed(0) : jo.toFixed(1) });
  }
  const xIdx = [0, Math.round((n - 1) / 2), n - 1];

  // 화면 px → viewBox 좌표 → 데이터 인덱스.
  //   width="100%" + preserveAspectRatio 로 높이가 비율대로 따라오므로 레터박스가 없다.
  const pickAt = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const vx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - mL) / pw) * (n - 1));
    onHover(Math.min(Math.max(i, 0), n - 1));
  };

  // 패널 폭이 제각각이라(반응형) 공유 인덱스가 범위를 벗어날 수 있다 — 클램프해서 쓴다.
  const hi2 = hover == null ? null : Math.min(Math.max(hover, 0), n - 1);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet"
         className="block touch-pan-y"
         onMouseMove={e => pickAt(e.clientX)}
         onTouchStart={e => pickAt(e.touches[0].clientX)}
         onTouchMove={e => pickAt(e.touches[0].clientX)}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={mL} y1={t.y} x2={W - mR} y2={t.y} stroke="#eef0f2" strokeWidth={0.8} />
          <text x={mL - 2} y={t.y + 2.4} textAnchor="end" fontSize="7" fill="#9ca3af">{t.text}</text>
        </g>
      ))}
      {xIdx.map((i, k) => (
        <text key={k} x={x(i)} y={H - 3}
              textAnchor={k === 0 ? "start" : k === xIdx.length - 1 ? "end" : "middle"}
              fontSize="7" fill="#9ca3af">{ddFmt(dates[i])}</text>
      ))}
      <path d={series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
            fill="none" stroke={color} strokeWidth={1.6}
            strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {/* 마지막 점 — 지금 값이 어디인지 */}
      <circle cx={x(n - 1)} cy={y(series[n - 1])} r={2.2} fill={color} opacity={hi2 == null ? 1 : 0.35} />
      {hi2 != null && (
        <g>
          <line x1={x(hi2)} y1={mT} x2={x(hi2)} y2={mT + ph}
                stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="2 2" />
          <circle cx={x(hi2)} cy={y(series[hi2])} r={2.6}
                  fill={color} stroke="#ffffff" strokeWidth={1} />
        </g>
      )}
    </svg>
  );
}

function Panel({ metric, dates, hover, onHover }: {
  metric: MarketDepositData["metrics"][number]; dates: string[];
  hover: number | null; onHover: (i: number | null) => void;
}) {
  const color = COLOR[metric.key];
  const s = metric.series;
  const idx = hover == null ? null : Math.min(Math.max(hover, 0), s.length - 1);
  // 올려둔 동안에는 그 날짜의 값·전일 대비 증감으로 바꾼다.
  const value = idx == null ? metric.value : s[idx];
  const diff = idx == null ? metric.diff
             : idx > 0 ? s[idx] - s[idx - 1] : 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 min-w-0">
      <div className="flex items-baseline gap-1.5 mb-0.5">
        <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[11px] font-bold text-gray-600">{LABEL[metric.key]}</span>
        <span className={`ml-auto text-[11px] font-bold tabular-nums shrink-0 ${diffColor(diff)}`}>
          {fmtDiff(diff)}
        </span>
      </div>
      <div className="text-base font-extrabold tabular-nums text-gray-900 leading-none mb-1">
        {fmtJo(value)}
      </div>
      <MiniChart series={s} dates={dates} color={color} hover={hover} onHover={onHover} />
      <div className="text-[10px] text-gray-400 leading-tight mt-0.5 truncate" title={HINT[metric.key]}>
        {HINT[metric.key]}
      </div>
    </div>
  );
}

export function FundFlowCard() {
  const { data } = useQuery<MarketDepositData | null>({
    queryKey: ["marketDeposit"],
    queryFn: fetchMarketDeposit,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // 훅은 early return 위에 — 데이터가 없는 렌더에서도 호출 순서가 같아야 한다.
  const [hover, setHover] = useState<number | null>(null);
  if (!data) return null;

  // 응답 순서가 아니라 ORDER 대로 — 직접자금(대기·빚) 다음에 펀드 셋.
  const metrics = ORDER
    .map(k => data.metrics.find(m => m.key === k))
    .filter((m): m is NonNullable<typeof m> => !!m);
  if (metrics.length === 0) return null;

  const hoverDate = hover == null ? null : data.dates[Math.min(hover, data.dates.length - 1)];

  return (
    <div className="relative rounded-xl border border-gray-300 bg-white p-2.5 pt-4 mt-1.5"
         onMouseLeave={() => setHover(null)}
         onTouchEnd={() => setHover(null)}>
      <a href={NAVER_URL} target="_blank" rel="noopener noreferrer"
         className="absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50
                    text-sm font-bold text-gray-700 whitespace-nowrap hover:bg-gray-100 hover:text-blue-600">
        💰 증시 자금동향 <span className="text-[10px] text-gray-400">↗</span>
      </a>
      {/* 기준 날짜 — 다섯 패널의 숫자가 전부 이 날짜 값이다. 자리를 비워 두면 레이아웃이 흔들린다. */}
      <div className="absolute -top-2.5 right-3 z-10 text-[10px] tabular-nums h-4">
        {hoverDate
          ? <span className="px-1.5 py-0.5 rounded bg-gray-800 text-white font-bold">{hoverDate} 기준 · 증감은 전일 대비</span>
          : <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-400">
              {data.dates[data.dates.length - 1]} 기준
            </span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-1.5">
        {metrics.map(m => (
          <Panel key={m.key} metric={m} dates={data.dates} hover={hover} onHover={setHover} />
        ))}
      </div>
    </div>
  );
}
