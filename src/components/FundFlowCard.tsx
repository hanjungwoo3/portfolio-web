import { useQuery } from "@tanstack/react-query";
import { fetchMarketDeposit, type MarketDepositData, type FundFlowKey } from "../lib/api";
import { MarketChartCard } from "./MarketChartCard";

// 증시 자금동향 — 네이버 금융 sise_deposit (고객예탁금·신용잔고·주식형/혼합형/채권형 펀드).
//   지수 대시보드 맨 위 고정. 5개 지표를 한 줄에 — 각 칸에 축(조 눈금 Y·날짜 X·격자) 있는 미니 라인차트.
//   지표명·금액은 그래프 위(밖)에 표기. 단위 억원, 한국식 색: 증가=빨강 / 감소=파랑.

const NAVER_URL = "https://finance.naver.com/sise/sise_deposit.naver";
const META: { key: FundFlowKey; label: string }[] = [
  { key: "deposit", label: "고객예탁금" }, { key: "credit", label: "신용잔고" },
  { key: "stock", label: "주식형" }, { key: "mixed", label: "혼합형" }, { key: "bond", label: "채권형" },
];
const LABEL: Record<FundFlowKey, string> = Object.fromEntries(META.map(m => [m.key, m.label])) as Record<FundFlowKey, string>;
// 각 지표 짧은 설명 (흐린 작은 글씨)
const HINT: Record<FundFlowKey, string> = {
  deposit: "증시 대기 매수자금",
  credit: "빚내서 산 잔고(레버리지)",
  stock: "주식형 펀드 설정액",
  mixed: "주식+채권 혼합 펀드",
  bond: "채권형 펀드 설정액",
};

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

// 미니 축 차트 — 조 눈금 Y축 + 날짜 X축 + 격자선 (콤팩트). viewBox 반응형.
function AxisChart({ data, dates, up }: { data: number[]; dates: string[]; up: boolean }) {
  if (!data || data.length < 2) return <div className="h-[60px]" />;
  const W = 150, H = 100, mL = 22, mR = 4, mT = 6, mB = 13;
  const pw = W - mL - mR, ph = H - mT - mB;
  const { lo, hi, step } = niceBounds(Math.min(...data), Math.max(...data), 3);
  const x = (i: number) => mL + (i / (data.length - 1)) * pw;
  const y = (v: number) => mT + (1 - (v - lo) / (hi - lo)) * ph;
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const yticks: number[] = [];
  for (let t = lo; t <= hi + step * 0.001; t += step) yticks.push(t);
  const dec = (hi - lo) / 10000 < 3 ? 1 : 0;   // 조 라벨 소수 자리
  const n = data.length, xIdx = [0, Math.round((n - 1) / 2), n - 1];
  const color = up ? "#dc2626" : "#2563eb";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block">
      {yticks.map((t, i) => (
        <g key={i}>
          <line x1={mL} y1={y(t)} x2={W - mR} y2={y(t)} stroke="#eef0f2" strokeWidth={0.8} />
          <text x={mL - 2} y={y(t) + 2.4} textAnchor="end" fontSize="7" fill="#9ca3af">{(t / 10000).toFixed(dec)}</text>
        </g>
      ))}
      {xIdx.map((i, k) => (
        <text key={k} x={x(i)} y={H - 3} textAnchor={k === 0 ? "start" : k === xIdx.length - 1 ? "end" : "middle"}
              fontSize="7" fill="#9ca3af">{ddFmt(dates[i])}</text>
      ))}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ label, hint, value, diff, series, dates }: {
  label: string; hint: string; value: number; diff: number; series: number[]; dates: string[];
}) {
  const up = series.length >= 2 && series[series.length - 1] >= series[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-1.5 flex items-center gap-1.5 min-w-0">
      {/* 그래프 왼쪽 */}
      <div className="basis-1/2 shrink min-w-0"><AxisChart data={series} dates={dates} up={up} /></div>
      {/* 텍스트 오른쪽 */}
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-bold text-gray-600 truncate">{label}</div>
        <div className="text-lg font-extrabold tabular-nums text-gray-900">{fmtJo(value)}</div>
        <div className={`text-base font-bold tabular-nums ${diffColor(diff)}`}>{fmtDiff(diff)}</div>
        <div className="text-[10px] text-gray-400 leading-tight mt-0.5">{hint}</div>
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
  if (!data) return null;

  return (
    <div className="relative rounded-xl border border-gray-300 bg-white p-2.5 pt-4 mt-1.5">
      <a href={NAVER_URL} target="_blank" rel="noopener noreferrer"
         className="absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50
                    text-sm font-bold text-gray-700 whitespace-nowrap hover:bg-gray-100 hover:text-blue-600">
        💰 증시 자금동향 <span className="text-[10px] text-gray-400">↗</span>
      </a>
      {/* 코스피/코스닥/코스피200 실시간 미니 차트 — 카드 맨 위 */}
      <div className="mb-2"><MarketChartCard /></div>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
        {data.metrics.map(m => (
          <Metric key={m.key} label={LABEL[m.key]} hint={HINT[m.key]} value={m.value} diff={m.diff} series={m.series} dates={data.dates} />
        ))}
      </div>
    </div>
  );
}
