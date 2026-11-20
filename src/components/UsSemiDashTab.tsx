// 💾 반도체 수급(미국) — 마이크론·엔비디아 실시간 체결 흐름 + 일별 공매도 비중 + 서학개미 보유(사용자 2026-11-21 "반도체수급(미국) 이렇게 별도로").
//   국내 반도체 수급 탭과 달리 미국은 외국인·기관·개인 수급을 공개하지 않는다 — 그래서 '누가'가 아니라 '어떻게 체결되나'(매수·매도 체결)와
//   공매도 거래 비중(FINRA, 하루 늦게)·한국 개인 보유(세이브로)를 본다.
//   체결: 토스 ticks 5초(화면을 켠 동안만 쌓인다, lib/usTickFlow) · 공매도: 크롤러 us-short-volume.json(매일 06:00 KST) · 서학개미: seohak.json
import { useQuery } from "@tanstack/react-query";
import { useUsTickFlow, etToKst, etNow, US_BIG_MIN, type UsTickFlow } from "../lib/usTickFlow";
import { useSeohak } from "../lib/seohak";
import { openExternal } from "../lib/toss";

const STOCKS = [
  { ticker: "MU", toss: "US19890516001", name: "마이크론", desc: "메모리(D램·HBM·낸드) — 삼성전자·SK하이닉스와 같은 업종" },
  { ticker: "NVDA", toss: "US19990122001", name: "엔비디아", desc: "AI 칩 1위 — HBM 최대 구매자" },
] as const;

const URL_SHORT = "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/us-short-volume.json";
interface ShortFile { meta: { builtAt: string }; days: { date: string; rows: Record<string, [number, number]> }[] }
async function loadShort(): Promise<ShortFile> {
  const r = await fetch(URL_SHORT, { cache: "no-store" });
  if (!r.ok) throw new Error(`us-short HTTP ${r.status}`);
  return await r.json() as ShortFile;
}

// 원 → "12.3억" / "4,560억" / "1.2조"
function won(v: number, sign = false): string {
  const s = sign ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(2)}조`;
  if (a >= 1e10) return `${s}${Math.round(a / 1e8).toLocaleString()}억`;
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(1)}억`;
  return `${s}${Math.round(a / 1e4).toLocaleString()}만`;
}
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");

export function UsSemiDashTab() {
  const flows = [useUsTickFlow(STOCKS[0].toss), useUsTickFlow(STOCKS[1].toss)];
  const short = useQuery({ queryKey: ["us-short-volume"], queryFn: loadShort, staleTime: 3 * 3600_000, retry: 1 });
  const seohak = useSeohak();
  const kd = etNow().kstDiff;
  return (
    <div className="space-y-3 p-1">
      <div className="text-[12px] text-gray-600 leading-snug">
        미국은 외국인·기관·개인 수급을 공개하지 않습니다. 대신 <b>체결이 매수 쪽(빨강)으로 많이 붙나 매도 쪽(파랑)으로 붙나</b>,
        <b> 공매도로 보고된 거래 비중</b>, <b>한국 개인(서학개미) 보유</b>를 봅니다. 정규장은 한국 시각 {etToKst("09:30", kd)}~{etToKst("16:00", kd)}.
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {STOCKS.map((s, i) => (
          <StockPanel key={s.ticker} s={s} flow={flows[i]} kd={kd}
                      shortDays={short.data?.days.flatMap(d => d.rows[s.ticker] ? [{ date: d.date, sv: d.rows[s.ticker][0], tv: d.rows[s.ticker][1] }] : [])}
                      hold={seohak?.hold.find(h => h.t === s.ticker)} holdDate={seohak?.meta.holdDate}
                      dayNet={seohak?.day.net.find(h => h.t === s.ticker)?.net ?? seohak?.day.sell.find(h => h.t === s.ticker)?.net} setlDate={seohak?.meta.setlDate} />
        ))}
      </div>
      <div className="text-[10.5px] text-gray-400 leading-snug">
        출처: 토스(체결, 5초마다 최근 100건 — 이 화면을 켠 동안만 쌓입니다. 체결이 아주 많은 종목은 그 사이 일부만 받는 표본이라 금액은 실제보다 작고, 비율(체결강도)로 보는 게 맞습니다. 꺼져 있던 시간은 비어 있습니다), FINRA Reg SHO(일별 공매도 거래량, 다음 날 아침 반영),
        예탁결제원 세이브로(서학개미 보관 금액, 직전 영업일). 금액은 토스 원화 환산. 매수·매도 추천이 아니라 지금 상태입니다.
      </div>
    </div>
  );
}

function StockPanel({ s, flow, kd, shortDays, hold, holdDate, dayNet, setlDate }: {
  s: (typeof STOCKS)[number]; flow: UsTickFlow; kd: number;
  shortDays?: { date: string; sv: number; tv: number }[];
  hold?: { amt: number; rank: number; prevRank?: number; prevAmt?: number }; holdDate?: string;
  dayNet?: number; setlDate?: string;
}) {
  const ms = flow.minutes;
  const buy = ms.reduce((a, m) => a + m.buyAmt, 0), sell = ms.reduce((a, m) => a + m.sellAmt, 0);
  const bv = ms.reduce((a, m) => a + m.buyVol, 0), sv = ms.reduce((a, m) => a + m.sellVol, 0);
  const last5 = ms.slice(-5), b5 = last5.reduce((a, m) => a + m.buyVol, 0), s5 = last5.reduce((a, m) => a + m.sellVol, 0);
  const pct = flow.price && flow.base ? (flow.price / flow.base - 1) * 100 : undefined;
  const bigs = flow.big.filter(b => b.amt >= US_BIG_MIN).slice(0, 8);
  return (
    <div className="relative rounded-xl border border-gray-300 bg-white pg-box p-3 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-700">
        <button type="button" className="hover:underline" onClick={() => openExternal(`https://www.tossinvest.com/stocks/${s.toss}`)}>{s.name} <span className="text-gray-400 font-normal">{s.ticker}</span></button>
      </span>
      <div className="flex items-baseline gap-2 flex-wrap">
        {flow.price != null && <b className="text-lg tabular-nums">${flow.price.toFixed(2)}</b>}
        {pct != null && <b className={`text-sm tabular-nums ${tone(pct)}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</b>}
        {flow.priceKrw ? <span className="text-[11px] text-gray-400 tabular-nums">{Math.round(flow.priceKrw).toLocaleString()}원</span> : null}
        <span className="ml-auto text-[11px] text-gray-500 truncate">{s.desc}</span>
      </div>
      {/* 오늘 체결 요약 */}
      <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center">
        <Stat label="순매수 체결" v={<span className={tone(buy - sell)}>{won(buy - sell, true)}</span>} hint="매수 쪽 체결 금액 − 매도 쪽 체결 금액(이 화면이 켜진 동안)" />
        <Stat label="체결강도(오늘)" v={sv ? <span className={tone(bv - sv)}>{Math.round((bv / sv) * 100)}%</span> : "—"} hint="매수 체결량 ÷ 매도 체결량 × 100 — 100 위면 사는 쪽이 더 적극적" />
        <Stat label="최근 5분" v={s5 ? <span className={tone(b5 - s5)}>{Math.round((b5 / s5) * 100)}%</span> : "—"} hint="최근 5분 체결강도" />
      </div>
      <FlowChart ms={ms} kd={kd} />
      <div className="mt-0.5 text-[10.5px] text-gray-400">
        {flow.error ? <span className="text-rose-500">체결 받기 실패 — {flow.error}</span>
          : flow.since ? <>한국 시각 {etToKst(flow.since.slice(0, 5), kd)}부터 쌓는 중 · 마지막 {etToKst(flow.last!.slice(0, 5), kd)}{flow.gaps ? ` · 빠진 구간 ${flow.gaps}번` : ""}</>
          : "체결을 기다리는 중 — 장이 쉬는 시간엔 쌓이지 않습니다"}
      </div>
      {bigs.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[11px] font-bold text-gray-600">큰 체결(1억원 이상)</div>
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-[11px] tabular-nums">
            {bigs.map((b, i) => (
              <div key={i} className="flex gap-1.5">
                <span className="text-gray-400">{etToKst(b.time.slice(0, 5), kd)}{b.time.slice(5)}</span>
                <span className={b.side === "BUY" ? "text-rose-600" : "text-blue-600"}>{b.side === "BUY" ? "매수" : "매도"} {won(b.amt)}</span>
                <span className="text-gray-400">${b.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <ShortBox days={shortDays} />
      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-1.5 text-[11.5px] text-gray-700 leading-snug">
        <b>🐜 서학개미</b>{" "}
        {hold ? <>보관 {hold.rank}위 · ${(hold.amt / 1e9).toFixed(2)}B
          {hold.prevAmt ? <span className={tone(hold.amt - hold.prevAmt)}> ({hold.amt >= hold.prevAmt ? "+" : "−"}${(Math.abs(hold.amt - hold.prevAmt) / 1e6).toFixed(0)}M)</span> : null}
          <span className="text-gray-400"> · {holdDate} 기준</span></> : <span className="text-gray-400">보관 상위 50 밖</span>}
        {dayNet != null && <> · 하루 순매수 <span className={tone(dayNet)}>{dayNet >= 0 ? "+" : "−"}${(Math.abs(dayNet) / 1e6).toFixed(1)}M</span><span className="text-gray-400"> ({setlDate} 결제)</span></>}
      </div>
    </div>
  );
}

function Stat({ label, v, hint }: { label: string; v: React.ReactNode; hint: string }) {
  return (
    <div title={hint} className="rounded-md border border-gray-200 bg-gray-50/60 py-1">
      <div className="text-[10.5px] text-gray-500">{label}</div>
      <div className="text-[13px] font-bold tabular-nums">{v}</div>
    </div>
  );
}

// 1분 막대(위 빨강 = 매수 체결 금액, 아래 파랑 = 매도) + 가격 선(회색) + 누적 순매수 선(주황)
function FlowChart({ ms, kd }: { ms: { t: string; buyAmt: number; sellAmt: number; close: number }[]; kd: number }) {
  const W = 600, H = 150, mid = 90, top = 8;
  if (ms.length < 1) return <div className="mt-2 h-[150px] rounded-md border border-dashed border-gray-200 flex items-center justify-center text-[11px] text-gray-400">체결이 쌓이면 그래프가 그려집니다</div>;
  const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const m0 = toM(ms[0].t), m1 = Math.max(toM(ms[ms.length - 1].t), m0 + 30);
  const x = (t: string) => ((toM(t) - m0) / (m1 - m0)) * (W - 8) + 4;
  const bw = Math.max(1, (W - 8) / (m1 - m0 + 1) - 0.6);
  const maxAmt = Math.max(1, ...ms.map(m => Math.max(m.buyAmt, m.sellAmt)));
  const barH = (v: number, room: number) => (v / maxAmt) * room;
  const pMin = Math.min(...ms.map(m => m.close)), pMax = Math.max(...ms.map(m => m.close)), pr = pMax - pMin || 1;
  const py = (p: number) => top + (1 - (p - pMin) / pr) * (mid - top - 4);
  let cum = 0; const cums = ms.map(m => (cum += m.buyAmt - m.sellAmt));
  const cMax = Math.max(1, ...cums.map(Math.abs));
  const cy = (c: number) => mid - (c / cMax) * (mid - top - 4) * 0.9;
  // 정규장 시작·끝 세로선(ET 09:30·16:00)
  const marks = [["09:30", "정규 시작"], ["16:00", "정규 끝"]].filter(([t]) => toM(t) > m0 && toM(t) < m1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full h-[150px]" preserveAspectRatio="none">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="#d1d5db" strokeWidth={0.6} />
      {marks.map(([t, l]) => <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="#a5b4fc" strokeDasharray="3 3" strokeWidth={0.8} /><text x={x(t) + 2} y={H - 3} fontSize={9} fill="#6366f1">{l}</text></g>)}
      {ms.map(m => (
        <g key={m.t}>
          <rect x={x(m.t) - bw / 2} y={mid - barH(m.buyAmt, mid - top)} width={bw} height={barH(m.buyAmt, mid - top)} fill="#f43f5e" opacity={0.55} />
          <rect x={x(m.t) - bw / 2} y={mid} width={bw} height={barH(m.sellAmt, H - mid - 14)} fill="#3b82f6" opacity={0.55} />
        </g>
      ))}
      <polyline fill="none" stroke="#6b7280" strokeWidth={1.2} points={ms.map(m => `${x(m.t)},${py(m.close)}`).join(" ")} />
      <polyline fill="none" stroke="#f59e0b" strokeWidth={1.6} points={ms.map((m, i) => `${x(m.t)},${cy(cums[i])}`).join(" ")} />
      <text x={4} y={H - 3} fontSize={9} fill="#9ca3af">{etToKst(ms[0].t, kd)}</text>
      <text x={W - 4} y={H - 3} fontSize={9} fill="#9ca3af" textAnchor="end">{etToKst(ms[ms.length - 1].t, kd)}</text>
      <text x={W - 4} y={cy(cums[cums.length - 1]) - 3} fontSize={10} fontWeight="bold" textAnchor="end" fill={cums[cums.length - 1] >= 0 ? "#e11d48" : "#2563eb"}>누적 {won(cums[cums.length - 1], true)}</text>
    </svg>
  );
}

// 일별 공매도 거래 비중 — 막대(최근 60영업일) + 최근 값 vs 20일 평균
function ShortBox({ days }: { days?: { date: string; sv: number; tv: number }[] }) {
  if (!days?.length) return null;
  const ds = days.slice(-60), r = ds.map(d => (d.sv / d.tv) * 100);
  const last = r[r.length - 1], avg20 = r.slice(-21, -1).reduce((a, v) => a + v, 0) / Math.max(1, r.slice(-21, -1).length);
  const diff = last - avg20;
  const lo = Math.min(...r) - 2, hi = Math.max(...r) + 2, W = 300, H = 40;
  const verdict = diff >= 5 ? "평소보다 공매도 비중이 높음" : diff <= -5 ? "평소보다 공매도 비중이 낮음" : "평소 수준";
  return (
    <div className="mt-2 rounded-lg border border-gray-200 px-2 py-1.5">
      <div className="flex items-baseline gap-1.5 text-[11.5px]">
        <b className="text-gray-700">공매도 거래 비중</b>
        <b className="tabular-nums">{last.toFixed(1)}%</b>
        <span className="text-gray-500 tabular-nums">(20일 평균 {avg20.toFixed(1)}%)</span>
        <span className={`ml-auto font-bold ${diff >= 5 ? "text-blue-600" : diff <= -5 ? "text-rose-600" : "text-gray-500"}`}>{verdict}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full h-[40px]" preserveAspectRatio="none">
        {r.map((v, i) => {
          const h = ((v - lo) / (hi - lo)) * H;
          return <rect key={i} x={(i / r.length) * W} y={H - h} width={W / r.length - 0.8} height={h} fill={i === r.length - 1 ? "#6366f1" : "#c7d2fe"} />;
        })}
        <line x1={0} x2={W} y1={H - ((avg20 - lo) / (hi - lo)) * H} y2={H - ((avg20 - lo) / (hi - lo)) * H} stroke="#f59e0b" strokeDasharray="3 2" strokeWidth={1} />
      </svg>
      <details className="text-[10.5px] text-gray-500">
        <summary className="cursor-pointer select-none text-indigo-600">이게 뭔가요? ({ds[ds.length - 1].date} 기준)</summary>
        <div className="leading-snug mt-0.5">그날 체결된 주식 중 '빌려서 판 것(공매도)'으로 보고된 거래량의 비중입니다(FINRA). 시장조성 물량이 섞여 평소에도 30~50%라
          값 자체보다 <b>평소(20일 평균)보다 높아졌는지</b>를 봅니다. 높아지면 하락에 거는 매도가 늘었다는 뜻이고, 공매도 '잔고'는 아닙니다. 하루 늦게 반영됩니다.</div>
      </details>
    </div>
  );
}
