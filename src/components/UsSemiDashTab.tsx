// 💾 반도체 수급(미국) — 마이크론·엔비디아·SK하이닉스 ADR·앤트로픽 실시간 체결 흐름 + 일별 공매도 비중 + 서학개미 보유(사용자 2026-11-21 "반도체수급(미국) 이렇게 별도로").
//   국내 반도체 수급 탭과 달리 미국은 외국인·기관·개인 수급을 공개하지 않는다 — 그래서 '누가'가 아니라 '어떻게 체결되나'(매수·매도 체결)와
//   공매도 거래 비중(FINRA, 하루 늦게)·한국 개인 보유(세이브로)를 본다.
//   체결: 토스 ticks 5초(화면을 켠 동안만 쌓인다, lib/usTickFlow) · 공매도: 크롤러 us-short-volume.json(매일 06:00 KST) · 서학개미: seohak.json
import { useQuery } from "@tanstack/react-query";
import { fetchTossUsMinuteToday } from "../lib/api";
import { useUsTickFlow, etToKst, etNow, US_BIG_MIN, US_SEMI_STOCKS, type UsTickFlow } from "../lib/usTickFlow";
import { useSeohak } from "../lib/seohak";
import { openExternal } from "../lib/toss";

const STOCKS = US_SEMI_STOCKS;   // 목록은 lib/usTickFlow 한 벌(배경 수집과 같이)

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
  const flows = [useUsTickFlow(STOCKS[0].toss), useUsTickFlow(STOCKS[1].toss), useUsTickFlow(STOCKS[2].toss), useUsTickFlow(STOCKS[3].toss)];   // 칸 수 고정(훅 순서)
  const short = useQuery({ queryKey: ["us-short-volume"], queryFn: loadShort, staleTime: 3 * 3600_000, retry: 1 });
  const seohak = useSeohak();
  // 배경 나스닥 — 나스닥100(QQQ) 1분봉, 국내 탭의 배경 코스피처럼(사용자 2026-11-21 "배경에 나스닥 그래프"). 1분마다, 최근 3시간
  const ndx = useQuery({ queryKey: ["us-semi-qqq-1m"], queryFn: () => fetchTossUsMinuteToday("US19990310001", etNow().date, 180), refetchInterval: 60_000, staleTime: 30_000, retry: 1 });
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
                      bg={ndx.data}
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

function StockPanel({ s, flow, kd, shortDays, hold, holdDate, dayNet, setlDate, bg }: {
  s: (typeof STOCKS)[number]; flow: UsTickFlow; kd: number; bg?: { t: string; close: number; base?: number }[];
  shortDays?: { date: string; sv: number; tv: number }[];
  hold?: { amt: number; rank: number; prevRank?: number; prevAmt?: number }; holdDate?: string;
  dayNet?: number; setlDate?: string;
}) {
  const ms = flow.minutes;
  const kd2 = flow.kisDay;
  const buy = ms.reduce((a, m) => a + m.buyAmt, 0), sell = ms.reduce((a, m) => a + m.sellAmt, 0);
  const bv = ms.reduce((a, m) => a + m.buyVol, 0), sv = ms.reduce((a, m) => a + m.sellVol, 0);
  const last5 = ms.filter(m => !m.est).slice(-5), b5 = last5.reduce((a, m) => a + m.buyVol, 0), s5 = last5.reduce((a, m) => a + m.sellVol, 0);
  const pct = flow.price && flow.base ? (flow.price / flow.base - 1) * 100 : undefined;
  const bigs = flow.big.filter(b => b.amt >= US_BIG_MIN).slice(0, 30);
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
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">   {/* 한 줄로(사용자 2026-11-21) */}
        {kd2 ? <>
          {/* 한투 당일 누적(앱+한투) — 장 시작부터 전체, 켜기 전 시간도 포함(사용자 2026-11-21) */}
          <Stat label="순매수 체결(오늘 전체)" v={<span className={tone(kd2.buy - kd2.sell)}>{won((kd2.buy - kd2.sell) * (flow.priceKrw ?? 0), true)}</span>} hint="한국투자 당일 누적 — 매수 체결량 − 매도 체결량을 지금 값으로 환산(장 시작부터)" />
          <Stat label="체결강도(오늘 전체)" v={<span className={tone(kd2.vpow - 100)}>{kd2.vpow.toFixed(1)}%</span>} hint="한국투자 당일 체결강도(매수 ÷ 매도 × 100, 장 시작부터) — 100 위면 사는 쪽이 더 적극적" />
        </> : <>
        <Stat label="순매수 체결" v={<span className={tone(buy - sell)}>{won(buy - sell, true)}</span>} hint="매수 쪽 체결 금액 − 매도 쪽 체결 금액(이 화면이 켜진 동안)" />
        <Stat label="체결강도(오늘)" v={sv ? <span className={tone(bv - sv)}>{Math.round((bv / sv) * 100)}%</span> : "—"} hint="매수 체결량 ÷ 매도 체결량 × 100 — 100 위면 사는 쪽이 더 적극적" />
        </>}
        <Stat label="최근 5분" v={s5 ? <span className={tone(b5 - s5)}>{Math.round((b5 / s5) * 100)}%</span> : "—"} hint="최근 5분 체결강도" />
      </div>
      {/* 그래프 왼쪽 · 큰 체결 오른쪽(국내 반도체 수급처럼, 사용자 2026-11-21) — 좁은 화면은 아래로 */}
      <div className="sm:flex sm:items-start sm:gap-2">
        <div className="sm:flex-1 sm:min-w-0">
          <FlowChart ms={ms} kd={kd} bg={bg} base={flow.base} />
          <div className="mt-0.5 text-[10.5px] text-gray-400">
            {flow.error ? <span className="text-rose-500">체결 받기 실패 — {flow.error}</span>
              : flow.since ? <>{ms.some(m => m.est) && <span className="text-gray-500">켜기 전은 가격 선만(1분봉) · </span>}{ms.some(m => m.kis) && <span className="text-emerald-600">한투로 정확히 나눈 분 {ms.filter(m => m.kis).length}개 · </span>}체결은 한국 시각 {etToKst(flow.since.slice(0, 5), kd)}부터 쌓는 중 · 마지막 {etToKst(flow.last!.slice(0, 5), kd)}{flow.gaps ? ` · 빠진 구간 ${flow.gaps}번` : ""}</>
              : "체결을 기다리는 중 — 장이 쉬는 시간엔 쌓이지 않습니다"}
          </div>
        </div>
        <div className="mt-1.5 sm:mt-2 sm:w-[168px] sm:shrink-0">
          <div className="text-[11px] font-bold text-gray-600">큰 체결(1억원 이상)</div>
          {bigs.length ? (
            <div className="mt-0.5 sm:max-h-[230px] sm:overflow-y-auto overscroll-contain [scrollbar-width:thin] text-[11px] tabular-nums grid grid-cols-2 sm:grid-cols-1 gap-x-3">
              {bigs.map((b, i) => (
                <div key={i} className="flex gap-1.5 whitespace-nowrap">
                  <span className="text-gray-400">{etToKst(b.time.slice(0, 5), kd)}{b.time.slice(5)}</span>
                  <span className={b.side === "BUY" ? "text-rose-600" : "text-blue-600"}>{b.side === "BUY" ? "매수" : "매도"} {won(b.amt)}</span>
                  <span className="text-gray-400 sm:hidden">${b.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : <div className="text-[10.5px] text-gray-400">아직 없음</div>}
        </div>
      </div>
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
    <span title={hint} className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[11px] text-gray-500">{label}</span>
      <b className="text-[13px] tabular-nums">{v}</b>
    </span>
  );
}

// 1분 막대(위 빨강 = 매수 체결 금액, 아래 파랑 = 매도) + 가격 선(회색) + 누적 순매수 선(주황) + 배경 나스닥100(보라)
// est(1분봉으로 채운 분) = 가격 선만 — 막대는 안 그린다(회색 막대는 뺐다, 사용자 2026-11-21 "회색은 지우자"), 누적 순매수에도 안 넣는다
// 글자(현재가·최고·최저·체결 누적)는 국내 반도체 수급과 같은 꼴 — svg 가 가로로 늘어나므로 HTML 로 얹는다(사용자 2026-11-21 "국내와 동일하게")
function FlowChart({ ms, kd, bg, base }: { ms: { t: string; buyAmt: number; sellAmt: number; close: number; est?: boolean; amt?: number }[]; kd: number; bg?: { t: string; close: number; base?: number }[]; base?: number }) {
  const W = 600, H = 230, mid = 140, top = 8, PR = 92;   // PR = 오른쪽 끝 글자 자리(px, viewBox 기준)
  if (ms.length < 1) return <div className="mt-2 h-[230px] rounded-md border border-dashed border-gray-200 flex items-center justify-center text-[11px] text-gray-400">체결이 쌓이면 그래프가 그려집니다</div>;
  const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const m0 = toM(ms[0].t), m1 = Math.max(toM(ms[ms.length - 1].t), m0 + 30);
  const x = (t: string) => ((toM(t) - m0) / (m1 - m0)) * (W - PR - 8) + 4;
  const bw = Math.max(1, (W - PR - 8) / (m1 - m0 + 1) - 0.6);
  const maxAmt = Math.max(1, ...ms.map(m => Math.max(m.buyAmt, m.sellAmt)));
  const barH = (v: number, room: number) => (v / maxAmt) * room;
  const prices = ms.map(m => m.close);
  const pMin = Math.min(...prices), pMax = Math.max(...prices), pr = pMax - pMin || 1;
  const py = (p: number) => top + 10 + (1 - (p - pMin) / pr) * (mid - top - 24);
  let cum = 0; const cums = ms.map(m => (cum += m.buyAmt - m.sellAmt));
  const cMax = Math.max(1, ...cums.map(Math.abs));
  const cy = (c: number) => mid - (c / cMax) * (mid - top - 4) * 0.9;
  // 배경 나스닥100(QQQ) — 같은 시간 범위만, 자기 높낮이로(옅은 보라 면), 끝에 등락률
  const bgIn = (bg ?? []).filter(p => toM(p.t) >= m0 && toM(p.t) <= m1);
  const bMin = Math.min(...bgIn.map(p => p.close)), bMax = Math.max(...bgIn.map(p => p.close)), br = bMax - bMin || 1;
  const by = (c: number) => top + (1 - (c - bMin) / br) * (H - top - 16);
  const bLast = bgIn[bgIn.length - 1], bPct = bLast?.base ? (bLast.close / bLast.base - 1) * 100 : undefined;
  // 정규장 시작·끝 세로선(ET 09:30·16:00)
  const marks = [["09:30", "정규 시작"], ["16:00", "정규 끝"]].filter(([t]) => toM(t) > m0 && toM(t) < m1);
  // 글자 자리(%) — 가로는 viewBox 대비, 세로는 높이 대비
  const lx = (t: string) => (x(t) / W) * 100, ly = (y: number) => (y / H) * 100;
  const pc = (p: number) => (base && base > 0 ? ` ${p >= base ? "+" : ""}${((p / base - 1) * 100).toFixed(2)}%` : "");
  const hi = pMax, lo = pMin, hiI = prices.indexOf(hi), loI = prices.indexOf(lo), last = prices[prices.length - 1];
  const lastT = ms[ms.length - 1].t, cLast = cums[cums.length - 1];
  // 현재가·체결 이름표가 붙으면 벌린다
  let yPrice = ly(py(last)), yCum = ly(cy(cLast));
  if (Math.abs(yPrice - yCum) < 11) { if (yPrice <= yCum) { yPrice -= 6; yCum += 6; } else { yPrice += 6; yCum -= 6; } }
  yPrice = Math.max(5, Math.min(92, yPrice)); yCum = Math.max(5, Math.min(92, yCum));
  const lab = "absolute pointer-events-none text-[10px] tabular-nums px-0.5 rounded bg-white/80 whitespace-nowrap";
  return (
    <div className="relative mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[230px]" preserveAspectRatio="none">
        {bgIn.length > 1 && <>
          <polygon fill="#a78bfa" opacity={0.12} points={`${x(bgIn[0].t)},${H - 16} ${bgIn.map(p => `${x(p.t)},${by(p.close)}`).join(" ")} ${x(bgIn[bgIn.length - 1].t)},${H - 16}`} />
          <polyline fill="none" stroke="#a78bfa" strokeWidth={1} opacity={0.6} points={bgIn.map(p => `${x(p.t)},${by(p.close)}`).join(" ")} />
        </>}
        <line x1={0} x2={W - PR} y1={mid} y2={mid} stroke="#d1d5db" strokeWidth={0.6} />
        {marks.map(([t]) => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H - 14} stroke="#a5b4fc" strokeDasharray="3 3" strokeWidth={0.8} />)}
        {ms.map(m => (
          m.est ? null : <g key={m.t}>
            <rect x={x(m.t) - bw / 2} y={mid - barH(m.buyAmt, mid - top)} width={bw} height={barH(m.buyAmt, mid - top)} fill="#f43f5e" opacity={0.55} />
            <rect x={x(m.t) - bw / 2} y={mid} width={bw} height={barH(m.sellAmt, H - mid - 16)} fill="#3b82f6" opacity={0.55} />
          </g>
        ))}
        <polyline fill="none" stroke="#475569" strokeWidth={1.3} points={ms.map(m => `${x(m.t)},${py(m.close)}`).join(" ")} />
        {cums.some(c => c !== 0) && <polyline fill="none" stroke="#f59e0b" strokeWidth={1.6} points={ms.map((m, i) => `${x(m.t)},${cy(cums[i])}`).join(" ")} />}
      </svg>
      {/* 배경 나스닥 이름·등락 */}
      {bgIn.length > 1 && <span className="absolute left-1.5 top-0.5 text-[10px] text-violet-600/90 pointer-events-none">배경 나스닥100(QQQ){bPct != null ? ` ${bPct >= 0 ? "+" : ""}${bPct.toFixed(2)}%` : ""}</span>}
      {/* 정규장 세로선 이름 · 아래 시각 */}
      {marks.map(([t, l]) => <span key={t} className="absolute bottom-0 text-[9.5px] text-indigo-500 pointer-events-none" style={{ left: `${lx(t)}%`, transform: "translateX(3px)" }}>{l}</span>)}
      <span className="absolute left-1 bottom-0 text-[9.5px] text-gray-400 pointer-events-none">{etToKst(ms[0].t, kd)}</span>
      <span className="absolute bottom-0 text-[9.5px] text-gray-400 pointer-events-none" style={{ left: `${lx(lastT)}%`, transform: "translateX(-100%)" }}>{etToKst(lastT, kd)}</span>
      {/* 최고·최저 — 고: 점 위 ▼ 위에 글자, 저: 점 아래 ▲ 아래 글자(국내와 같은 꼴) */}
      {hi > lo && [{ i: hiI, v: hi, up: true }, { i: loI, v: lo, up: false }].map(({ i, v, up }) => {
        const xp = lx(ms[i].t), y = ly(py(v));
        const tx = xp < 25 ? "-6px" : xp > 70 ? "calc(-100% + 6px)" : "-50%";
        const col = up ? "text-rose-600" : "text-blue-600";
        return (
          <span key={up ? "hi" : "lo"}>
            <span className={`absolute pointer-events-none text-[8px] leading-none ${col}`} style={{ left: `${xp}%`, top: `${y}%`, transform: up ? "translate(-50%, -115%)" : "translate(-50%, 15%)" }}>{up ? "▼" : "▲"}</span>
            <span className={`${lab} ${col}`} style={{ left: `${xp}%`, top: `${y}%`, transform: `translate(${tx}, ${up ? "calc(-100% - 9px)" : "9px"})` }}>{up ? "최고" : "최저"} ${v.toFixed(2)}{pc(v)}</span>
          </span>
        );
      })}
      {/* 현재가 이름표(선 끝) — 바탕은 가격선 색 */}
      <span className="absolute pointer-events-none text-[10.5px] font-bold bg-slate-100 text-slate-700 border border-slate-300 px-1 py-px rounded-sm whitespace-nowrap tabular-nums"
            style={{ left: `${lx(lastT)}%`, top: `${yPrice}%`, transform: "translate(6px, -50%)" }}>
        현재가 ${last.toFixed(2)}
        {pc(last) && <span className={`block text-right text-[10px] ${base && last > base ? "text-rose-600" : base && last < base ? "text-blue-600" : ""}`}>{pc(last).trim()}</span>}
      </span>
      {/* 체결 누적(주황) 이름표 */}
      {cums.some(c => c !== 0) && (
        <span className="absolute pointer-events-none text-[10.5px] font-bold bg-orange-100 text-orange-700 border border-orange-300 px-1 py-px rounded-sm whitespace-nowrap tabular-nums"
              style={{ left: `${lx(lastT)}%`, top: `${yCum}%`, transform: "translate(6px, -50%)" }}>체결 <span className={cLast > 0 ? "text-rose-600" : cLast < 0 ? "text-blue-600" : ""}>{won(cLast, true)}</span></span>
      )}
    </div>
  );
}

// 일별 공매도 거래 비중 — 막대(최근 60영업일) + 최근 값 vs 20일 평균
function ShortBox({ days }: { days?: { date: string; sv: number; tv: number }[] }) {
  if (!days?.length) return null;
  const ds = days.slice(-60), r = ds.map(d => (d.sv / d.tv) * 100);
  const last = r[r.length - 1], avg20 = r.slice(-21, -1).reduce((a, v) => a + v, 0) / Math.max(1, r.slice(-21, -1).length);
  const few = r.length < 6;   // 막 상장(앤트로픽 등) — 평균이 없어 판정하지 않는다
  const diff = few ? 0 : last - avg20;
  const lo = Math.min(...r) - 2, hi = Math.max(...r) + 2, W = 300, H = 40;
  const verdict = few ? "" : diff >= 5 ? "평소보다 공매도 비중이 높음" : diff <= -5 ? "평소보다 공매도 비중이 낮음" : "평소 수준";
  return (
    <div className="mt-2 rounded-lg border border-gray-200 px-2 py-1.5">
      <div className="flex items-baseline gap-1.5 text-[11.5px]">
        <b className="text-gray-700">공매도 거래 비중</b>
        <b className="tabular-nums">{last.toFixed(1)}%</b>
        <span className="text-gray-500 tabular-nums">{few ? `(자료 ${r.length}일 — 평균 비교는 쌓인 뒤)` : `(20일 평균 ${avg20.toFixed(1)}%)`}</span>
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
