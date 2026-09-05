import { useQuery } from "@tanstack/react-query";
import { fetchMarketDeposit, type MarketDepositData, type FundFlowKey } from "../lib/api";

// 증시 자금동향 — 네이버 금융 sise_deposit (고객예탁금·신용잔고·주식형/혼합형/채권형 펀드).
//   성격이 다른 두 묶음으로 나눠 각각 한 차트에 겹쳐 그린다.
//     · 투자자 직접자금 — 예탁금(대기 현금) vs 신용잔고(빚). 같이 봐야 의미가 있다.
//     · 펀드 설정액     — 주식형/혼합형/채권형. 서로 자금이 옮겨다니는 관계.
//   단위 억원, 한국식 색: 증가=빨강 / 감소=파랑 (금액 변화 표기에만 적용).

const NAVER_URL = "https://finance.naver.com/sise/sise_deposit.naver";

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
// 계열 색 — 묶음 안에서 서로 구분되게. 신용잔고는 위험 성격이라 빨강.
const COLOR: Record<FundFlowKey, string> = {
  deposit: "#2563eb", credit: "#dc2626",
  stock: "#dc2626", mixed: "#f59e0b", bond: "#2563eb",
};

// 묶음 정의 — dual: 좌우 축 분리(2개 한정) / pct: 시작점 대비 % 한 축(3개 이상)
const GROUPS: { title: string; hint: string; keys: FundFlowKey[]; mode: "dual" | "pct" }[] = [
  { title: "투자자 직접자금", hint: "대기 현금 vs 빚", keys: ["deposit", "credit"], mode: "dual" },
  { title: "펀드 설정액", hint: "간접투자 — 시작일 대비 증감률", keys: ["stock", "bond", "mixed"], mode: "pct" },
];

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

interface Line { key: FundFlowKey; data: number[] }

// 좌우 축을 '같은 비율 폭'으로 잡는다.
//   예탁금 102조 / 신용잔고 33조처럼 절대 규모가 다르면 한 축에 못 그린다. 축을 나누되
//   각자 제멋대로 스케일하면 기울기 비교가 무의미해진다(작은 흔들림이 큰 변동처럼 보임).
//   → 두 축이 '자기 중앙값 대비 같은 %' 를 덮게 만들면, 같은 기울기 = 같은 비율 변화가 되어
//     선끼리 직접 비교할 수 있고 축 라벨은 각자 조 단위 절대값으로 읽힌다.
function proportionalBounds(lines: Line[]): { lo: number; hi: number }[] {
  const stats = lines.map(l => {
    const min = Math.min(...l.data), max = Math.max(...l.data);
    const mid = (min + max) / 2 || 1;
    return { min, max, mid, spanPct: (max - min) / Math.abs(mid) };
  });
  // 가장 크게 움직인 계열에 맞추고 15% 여백. 완전히 평평해도 최소 폭(0.4%)은 준다.
  const span = Math.max(Math.max(...stats.map(s => s.spanPct)) * 1.15, 0.004);
  return stats.map(s => ({ lo: s.mid * (1 - span / 2), hi: s.mid * (1 + span / 2) }));
}

// 묶음 차트 — dual(좌우 축, 2계열) / pct(시작점 대비 %, 한 축)
function GroupChart({ lines, dates, mode }: { lines: Line[]; dates: string[]; mode: "dual" | "pct" }) {
  if (lines.length === 0 || lines[0].data.length < 2) return <div className="h-[104px]" />;
  const isDual = mode === "dual" && lines.length === 2;
  const W = 320, H = 118, mL = 30, mR = isDual ? 30 : 6, mT = 6, mB = 14;
  const pw = W - mL - mR, ph = H - mT - mB;
  const n = lines[0].data.length;
  const x = (i: number) => mL + (i / (n - 1)) * pw;

  // 계열별 y 매퍼 + 축 눈금 (yOf·plot 은 두 분기에서 반드시 채워지므로 초기값을 두지 않는다)
  let yOf: ((v: number, li: number) => number)[];
  let plot: number[][];
  const leftTicks: { y: number; text: string }[] = [];
  const rightTicks: { y: number; text: string }[] = [];

  if (isDual) {
    const b = proportionalBounds(lines);
    plot = lines.map(l => l.data);
    yOf = lines.map((_, li) => (v: number) => mT + (1 - (v - b[li].lo) / (b[li].hi - b[li].lo)) * ph);
    // 두 축이 같은 비율 폭이라 눈금 위치(0·0.5·1)가 그대로 일치한다.
    const at = [0, 0.5, 1];
    const tickText = (li: number, f: number) => {
      const v = b[li].lo + (b[li].hi - b[li].lo) * (1 - f);
      const jo = v / 10000;
      return jo >= 100 ? jo.toFixed(0) : jo.toFixed(1);
    };
    for (const f of at) {
      leftTicks.push({ y: mT + f * ph, text: tickText(0, f) });
      rightTicks.push({ y: mT + f * ph, text: tickText(1, f) });
    }
  } else {
    // 시작일을 0% 로 두고 증감률만 그린다 — 규모가 달라도 한 축에 올라간다.
    plot = lines.map(l => l.data.map(v => (l.data[0] ? (v / l.data[0] - 1) * 100 : 0)));
    const all = plot.flat();
    const { lo, hi, step } = niceBounds(Math.min(...all, 0), Math.max(...all, 0), 3);
    const yy = (v: number) => mT + (1 - (v - lo) / (hi - lo)) * ph;
    yOf = lines.map(() => yy);
    for (let t = lo; t <= hi + step * 0.001; t += step) {
      leftTicks.push({ y: yy(t), text: `${t > 0 ? "+" : ""}${t.toFixed(step < 1 ? 1 : 0)}` });
    }
  }

  const xIdx = [0, Math.round((n - 1) / 2), n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block">
      {leftTicks.map((t, i) => (
        <g key={`l${i}`}>
          <line x1={mL} y1={t.y} x2={W - mR} y2={t.y} stroke="#eef0f2" strokeWidth={0.8} />
          <text x={mL - 2} y={t.y + 2.4} textAnchor="end" fontSize="7"
                fill={isDual ? COLOR[lines[0].key] : "#9ca3af"}>{t.text}</text>
        </g>
      ))}
      {rightTicks.map((t, i) => (
        <text key={`r${i}`} x={W - mR + 2} y={t.y + 2.4} textAnchor="start" fontSize="7"
              fill={COLOR[lines[1].key]}>{t.text}</text>
      ))}
      {xIdx.map((i, k) => (
        <text key={k} x={x(i)} y={H - 3} textAnchor={k === 0 ? "start" : k === xIdx.length - 1 ? "end" : "middle"}
              fontSize="7" fill="#9ca3af">{ddFmt(dates[i])}</text>
      ))}
      {plot.map((d, li) => (
        <path key={li} d={d.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yOf[li](v, li).toFixed(1)}`).join(" ")}
              fill="none" stroke={COLOR[lines[li].key]} strokeWidth={1.5}
              strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

function Group({ title, hint, keys, mode, data }: {
  title: string; hint: string; keys: FundFlowKey[]; mode: "dual" | "pct"; data: MarketDepositData;
}) {
  const metrics = keys
    .map(k => data.metrics.find(m => m.key === k))
    .filter((m): m is NonNullable<typeof m> => !!m);
  if (metrics.length === 0) return null;
  const lines: Line[] = metrics.map(m => ({ key: m.key, data: m.series }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 min-w-0">
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-xs font-bold text-gray-700">{title}</span>
        <span className="text-[10px] text-gray-400 truncate">{hint}</span>
        {mode === "dual" && (
          <span className="ml-auto text-[9px] text-gray-400 shrink-0"
                title="좌우 축이 각자 중앙값 대비 같은 비율 폭을 덮습니다. 그래서 기울기가 같으면 증감률이 같습니다.">
            좌·우 축 (같은 비율 폭)
          </span>
        )}
      </div>
      {/* 범례 겸 값 — 계열 색과 맞춤 */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1">
        {metrics.map(m => (
          <div key={m.key} className="flex items-baseline gap-1 min-w-0">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: COLOR[m.key] }} />
            <span className="text-[11px] font-bold text-gray-600">{LABEL[m.key]}</span>
            <span className="text-sm font-extrabold tabular-nums text-gray-900">{fmtJo(m.value)}</span>
            <span className={`text-[11px] font-bold tabular-nums ${diffColor(m.diff)}`}>{fmtDiff(m.diff)}</span>
          </div>
        ))}
      </div>
      <GroupChart lines={lines} dates={data.dates} mode={mode} />
      <div className="text-[10px] text-gray-400 leading-tight mt-0.5 truncate">
        {metrics.map(m => HINT[m.key]).join(" · ")}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {GROUPS.map(g => (
          <Group key={g.title} title={g.title} hint={g.hint} keys={g.keys} mode={g.mode} data={data} />
        ))}
      </div>
    </div>
  );
}
