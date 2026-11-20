// 💾 반도체 수급(미국) — 마이크론·엔비디아·SK하이닉스 ADR·앤트로픽 실시간 체결 흐름 + 일별 공매도 비중 + 서학개미 보유(사용자 2026-11-21 "반도체수급(미국) 이렇게 별도로").
//   국내 반도체 수급 탭과 달리 미국은 외국인·기관·개인 수급을 공개하지 않는다 — 그래서 '누가'가 아니라 '어떻게 체결되나'(매수·매도 체결)와
//   공매도 거래 비중(FINRA, 하루 늦게)·한국 개인 보유(세이브로)를 본다.
//   체결: 토스 ticks 5초(화면을 켠 동안만 쌓인다, lib/usTickFlow) · 공매도: 크롤러 us-short-volume.json(매일 06:00 KST) · 서학개미: seohak.json
import { useId } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchTossUs5mHours } from "../lib/api";
import { useUsTickFlow, etToKst, etNow, US_SEMI_STOCKS, type UsTickFlow } from "../lib/usTickFlow";
import { bigThreshold, wonStep } from "../lib/useTickFlow";
import { useSeohak } from "../lib/seohak";
import { openExternal } from "../lib/toss";
import { ShortRatioBox } from "./ShortRatioBox";

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
  //   + 24시간(사용자 2026-11-21 48시간 → "24시간으로 줄이자") — 종목·QQQ 5분봉, 5분마다
  const ndx = useQuery({ queryKey: ["us-semi-qqq-5m48"], queryFn: () => fetchTossUs5mHours("US19990310001", HRS), refetchInterval: 5 * 60_000, staleTime: 2 * 60_000, retry: 1 });
  const px48 = useQueries({ queries: STOCKS.map(s => ({ queryKey: ["us-semi-5m48", s.toss], queryFn: () => fetchTossUs5mHours(s.toss, HRS), refetchInterval: 5 * 60_000, staleTime: 2 * 60_000, retry: 1 })) });
  const kd = etNow().kstDiff;
  return (
    <div className="space-y-1.5 p-1">
      <div className="text-[11.5px] text-gray-600 leading-snug">
        미국은 외국인·기관·개인 수급을 공개하지 않습니다. 대신 <b>체결이 매수 쪽(빨강)으로 많이 붙나 매도 쪽(파랑)으로 붙나</b>,
        <b> 공매도로 보고된 거래 비중</b>, <b>한국 개인(서학개미) 보유</b>를 봅니다. 정규장은 한국 시각 {etToKst("09:30", kd)}~{etToKst("16:00", kd)}.
      </div>
      {/* 범례 — 칸마다 있던 것을 맨 위 한 번만(사용자 2026-11-21 "공간을 정리하자 4개 종목을 한번에")(사용자 2026-11-21 "그래프 각 선이 뭔지 설명이 없어?") */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-gray-600">
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2.5 bg-rose-300/60" /><i className="inline-block w-2 h-2.5 bg-blue-300/60" />가격(그날 전일 종가 위 빨강·아래 파랑)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-4 h-[2px] bg-amber-500" />체결 누적(매수−매도, 자기 눈금)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-1.5 h-2.5 bg-rose-600" /><i className="inline-block w-1.5 h-2.5 bg-blue-600" />1분 순매수·순매도(진함) — 연한 막대 = 매수(위)·매도(아래) 각각</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-4 h-[2px] bg-violet-400" />배경 나스닥100(QQQ, 자기 눈금)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 border-t border-dashed border-indigo-400" />장 구간 세로선(프리·정규 시작·끝·애프터 끝)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 border-t border-dashed border-gray-400" />전일 종가(날마다 가로선)</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {STOCKS.map((s, i) => (
          <StockPanel key={s.ticker} s={s} flow={flows[i]} kd={kd}
                      shortDays={short.data?.days.flatMap(d => d.rows[s.ticker] ? [{ date: d.date, sv: d.rows[s.ticker][0], tv: d.rows[s.ticker][1] }] : [])}
                      bg={ndx.data} price48={px48[i]?.data}
                      hold={seohak?.hold.find(h => h.t === s.ticker)} holdDate={seohak?.meta.holdDate}
                      dayNet={seohak?.day.net.find(h => h.t === s.ticker)?.net ?? seohak?.day.sell.find(h => h.t === s.ticker)?.net} />
        ))}
      </div>
      <div className="text-[10.5px] text-gray-400 leading-snug">
        출처: 토스(체결, 5초마다 최근 100건 — 이 화면을 켠 동안만 쌓입니다. 체결이 아주 많은 종목은 그 사이 일부만 받는 표본이라 금액은 실제보다 작고, 비율(체결강도)로 보는 게 맞습니다. 꺼져 있던 시간은 비어 있습니다), FINRA Reg SHO(일별 공매도 거래량, 다음 날 아침 반영),
        예탁결제원 세이브로(서학개미 보관 금액, 직전 영업일). 금액은 토스 원화 환산. 매수·매도 추천이 아니라 지금 상태입니다.
      </div>
    </div>
  );
}

function StockPanel({ s, flow, kd, shortDays, hold, holdDate, dayNet, bg, price48 }: {
  s: (typeof STOCKS)[number]; flow: UsTickFlow; kd: number; bg?: { t: number; close: number; base?: number }[]; price48?: { t: number; close: number; base?: number }[];
  shortDays?: { date: string; sv: number; tv: number }[];
  hold?: { amt: number; rank: number; prevRank?: number; prevAmt?: number }; holdDate?: string;
  dayNet?: number;
}) {
  const ms = flow.minutes;
  const kd2 = flow.kisDay;
  const buy = ms.reduce((a, m) => a + m.buyAmt, 0), sell = ms.reduce((a, m) => a + m.sellAmt, 0);
  const bv = ms.reduce((a, m) => a + m.buyVol, 0), sv = ms.reduce((a, m) => a + m.sellVol, 0);
  const last5 = ms.filter(m => !m.est).slice(-5), b5 = last5.reduce((a, m) => a + m.buyVol, 0), s5 = last5.reduce((a, m) => a + m.sellVol, 0);
  const pct = flow.price && flow.base ? (flow.price / flow.base - 1) * 100 : undefined;
  const bigMin = bigThreshold(flow.big);   // 그 이상이 5건 넘게 쌓이는 가장 높은 단계(국내와 같은 규칙)
  const bigs = flow.big.filter(b => b.amt >= bigMin).slice(0, 30);
  return (
    <div className="relative rounded-xl border border-gray-300 bg-white pg-box p-3 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-700">
        <button type="button" className="hover:underline" onClick={() => openExternal(`https://www.tossinvest.com/stocks/${s.toss}`)}>{s.name} <span className="text-gray-400 font-normal">{s.ticker}</span></button>
        {/* 서학개미 — 종목명 옆 한 줄(사용자 2026-11-21 "이건 종목명 옆으로") */}
        <span className="ml-2 text-[10.5px] font-normal text-gray-600" title={`예탁결제원 세이브로 — 보관 ${holdDate ?? ""} 기준, 하루 순매수는 직전 결제일`}>
          🐜 {hold ? <>보관 {hold.rank}위 ${(hold.amt / 1e9).toFixed(2)}B{hold.prevAmt ? <span className={tone(hold.amt - hold.prevAmt)}>({hold.amt >= hold.prevAmt ? "+" : "−"}${(Math.abs(hold.amt - hold.prevAmt) / 1e6).toFixed(0)}M)</span> : null}</> : <span className="text-gray-400">보관 50위 밖</span>}
          {dayNet != null && <> · 하루 <span className={tone(dayNet)}>{dayNet >= 0 ? "+" : "−"}${(Math.abs(dayNet) / 1e6).toFixed(1)}M</span></>}
        </span>
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
          <FlowChart ms={ms} etDate={flow.etDate} kd={kd} price={price48} bg={bg} base={flow.base} />
          <div className="mt-0.5 text-[10.5px] text-gray-400">
            {flow.error ? <span className="text-rose-500">체결 받기 실패 — {flow.error}</span>
              : flow.since ? <><span className="text-gray-500">가격·나스닥 = 5분봉 24시간 · </span>{ms.some(m => m.kis) && <span className="text-emerald-600">한투로 정확히 나눈 분 {ms.filter(m => m.kis).length}개 · </span>}체결은 한국 시각 {etToKst(flow.since.slice(0, 5), kd)}부터 쌓는 중 · 마지막 {etToKst(flow.last!.slice(0, 5), kd)}{flow.gaps ? ` · 빠진 구간 ${flow.gaps}번` : ""}</>
              : "체결을 기다리는 중 — 장이 쉬는 시간엔 쌓이지 않습니다"}
          </div>
        </div>
        <div className="mt-1.5 sm:mt-1 sm:w-[180px] sm:shrink-0">
          <div className="text-[11px] font-bold text-gray-600">큰 체결({wonStep(bigMin)}원 이상)</div>
          {bigs.length ? (
            <div className="mt-0.5 sm:max-h-[96px] sm:overflow-y-auto overscroll-contain [scrollbar-width:thin] text-[11px] tabular-nums grid grid-cols-2 sm:grid-cols-1 gap-x-3">
              {bigs.map((b, i) => (
                <div key={i} className="flex gap-1.5 whitespace-nowrap">
                  <span className="text-gray-400">{etToKst(b.time.slice(0, 5), kd)}{b.time.slice(5)}</span>
                  <span className={b.side === "BUY" ? "text-rose-600" : "text-blue-600"}>{b.side === "BUY" ? "매수" : "매도"} {won(b.amt)}</span>
                  <span className="text-gray-400 sm:hidden">${b.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : <div className="text-[10.5px] text-gray-400">아직 없음</div>}
          <ShortRatioBox compact days={shortDays?.map(d => ({ date: d.date, ratio: (d.sv / d.tv) * 100 }))} band={5}
                         help={<>그날 체결된 주식 중 '빌려서 판 것(공매도)'으로 보고된 거래량의 비중입니다(FINRA). 시장조성 물량이 섞여 평소에도 30~50%라 값 자체보다 <b>평소(20일 평균)보다 높아졌는지</b>를 봅니다. 높아지면 하락에 거는 매도가 늘었다는 뜻이고, 공매도 '잔고'는 아닙니다. 하루 늦게 반영됩니다.</>} />
        </div>
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

// 48시간 그래프(사용자 2026-11-21 "그래프를 48시간으로 고정") — 가로축 = 지금부터 48시간 전까지(실제 시각).
//   가격·배경 나스닥 = 토스 5분봉 48시간 · 매수·매도 막대·체결 누적 = 이 기기가 쌓은 오늘 체결(15분씩 묶어 막대) · 세로선 = 날마다 장 구간(ET 04:00·09:30·16:00·20:00)
//   글자(현재가·최고·최저·체결 누적)는 국내 반도체 수급과 같은 꼴 — svg 가 가로로 늘어나므로 HTML 로 얹는다
const HRS = 24, BIN = 10 * 60_000;   // 48 → 24시간(사용자 2026-11-21 "24시간으로 줄이자"), 막대 10분 묶음
/** ET 날짜 + "HH:MM" → 시각(ms). kstDiff = KST − ET(분) */
const etEpoch = (date: string, t: string, kstDiff: number) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +t.slice(0, 2), +t.slice(3, 5)) - (540 - kstDiff) * 60_000;
const kstLabel = (ms: number, withDay = false) => { const d = new Date(ms + 9 * 3600_000); const hm = d.toISOString().slice(11, 16); return withDay ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}` : hm; };

function FlowChart({ ms, etDate, kd, price, bg, base }: {
  ms: { t: string; buyAmt: number; sellAmt: number; close: number; est?: boolean }[]; etDate: string; kd: number;
  price?: { t: number; close: number; base?: number }[]; bg?: { t: number; close: number; base?: number }[]; base?: number;
}) {
  const W = 600, H = 190, mid = 116, top = 8, PR = 92;   // PR = 오른쪽 끝 글자 자리(viewBox px)
  const uid = useId().replace(/:/g, "");   // clipPath id — 칸이 넷이라 겹치지 않게
  const real = ms.filter(m => !m.est).map(m => ({ ...m, at: etEpoch(etDate, m.t, kd) }));
  // 가격 = 5분봉 + 끝에 지금 체결가(5분봉은 진행 중인 봉이 늦다)
  const pts: { t: number; close: number; base?: number }[] = [...(price ?? [])];
  const lastReal = real[real.length - 1];
  if (lastReal && (!pts.length || lastReal.at > pts[pts.length - 1].t)) pts.push({ t: lastReal.at, close: lastReal.close, base: pts[pts.length - 1]?.base ?? base });
  if (pts.length < 2) return <div className="mt-1 h-[190px] rounded-md border border-dashed border-gray-200 flex items-center justify-center text-[11px] text-gray-400">가격을 받는 중…</div>;
  const T1 = Math.max(Date.now(), pts[pts.length - 1].t), T0 = T1 - HRS * 3600_000;
  const x = (t: number) => ((t - T0) / (T1 - T0)) * (W - PR - 8) + 4;
  const inR = <T extends { t: number }>(a: T[]) => a.filter(p => p.t >= T0);
  const P = inR(pts);
  const prices = P.map(p => p.close);
  // 종목 가격은 날마다 자기 기준가(그 전 정규장 종가) 위 빨강·아래 파랑(사용자 2026-11-21 "나스닥은 선으로만, 종목에 색상") — 봉의 base 가 바뀌는 곳에서 나눈다
  const pGroups: { base: number; from: number; pts: typeof P }[] = [];
  for (const p of P) {
    const g = pGroups[pGroups.length - 1];
    if (p.base && (!g || g.base !== p.base)) pGroups.push({ base: p.base, from: p.t, pts: [p] });
    else if (g) g.pts.push(p);
  }
  const pVals = [...prices, ...pGroups.map(g => g.base)];
  const pMin = Math.min(...pVals), pMax = Math.max(...pVals), pr = pMax - pMin || 1;
  const py = (p: number) => top + 10 + (1 - (p - pMin) / pr) * (mid - top - 24);
  // 선은 40분 넘게 빈 곳(주말·쉬는 시간)에서 끊는다
  const segs = (a: { t: number }[], yf: (i: number) => number) => {
    const out: string[] = []; let cur: string[] = [];
    a.forEach((p, i) => { if (i && p.t - a[i - 1].t > 40 * 60_000) { if (cur.length > 1) out.push(cur.join(" ")); cur = []; } cur.push(`${x(p.t)},${yf(i)}`); });
    if (cur.length > 1) out.push(cur.join(" "));
    return out;
  };
  // 막대 — 15분씩 묶음
  const bins = new Map<number, { buy: number; sell: number }>();
  for (const m of real) { const k = Math.floor(m.at / BIN) * BIN; const b = bins.get(k) ?? { buy: 0, sell: 0 }; b.buy += m.buyAmt; b.sell += m.sellAmt; bins.set(k, b); }
  const bw = Math.max(1.2, (BIN / (T1 - T0)) * (W - PR - 8) - 0.5);
  // 막대 높이 기준 = 최근 3시간 중 가장 큰 막대 — 24시간 전체로 맞추면 정규장 막대에 눌려 애프터장(지금) 막대가 0 높이로 안 보였다
  //   (사용자 2026-11-21 "지금 거래가 있는데 그래프가 갱신 안 되는 것 같은데?"). 그보다 큰 예전 막대는 칸 끝에서 자른다
  const recent = [...bins.entries()].filter(([k]) => k >= T1 - 3 * 3600_000).map(([, b]) => Math.max(b.buy, b.sell));
  const maxAmt = Math.max(1, ...(recent.length ? recent : [...bins.values()].map(b => Math.max(b.buy, b.sell))));
  const barH = (v: number, room: number) => Math.min(1, v / maxAmt) * room;
  // 체결 누적(주황) — 기록이 있는 분만
  let cum = 0; const cums = real.map(m => (cum += m.buyAmt - m.sellAmt));
  const cLo = Math.min(0, ...cums), cHi = Math.max(0, ...cums), cR = cHi - cLo || 1;
  const cy = (c: number) => top + 6 + (1 - (c - cLo) / cR) * (H - top - 30);
  // 배경 나스닥100(QQQ) — 자기 눈금, 가로 점선 = 가장 최근 봉의 기준(어제 종가)
  const B = inR(bg ?? []);
  const bBase = [...B].reverse().find(p => p.base)?.base;   // 가장 최근 날 기준(왼쪽 아래 등락률)
  const bVals = B.map(p => p.close);
  const bMin = Math.min(...bVals), bMax = Math.max(...bVals), br = bMax - bMin || 1;
  const by = (c: number) => top + (1 - (c - bMin) / br) * (H - top - 16);
  const bLast = B[B.length - 1], bPct = bLast && bBase ? (bLast.close / bBase - 1) * 100 : undefined;
  // 세로선 — 범위 안 날짜마다 ET 프리 시작·정규 시작·정규 끝·애프터 끝
  const marks: { at: number; label: string }[] = [];
  for (let d = -3; d <= 1; d++) {
    const ds = new Date(Date.parse(`${etDate}T12:00:00Z`) + d * 86400_000).toISOString().slice(0, 10);
    const wd = new Date(`${ds}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (const [t, l] of [["04:00", ""], ["09:30", "정규"], ["16:00", "마감"], ["20:00", ""]] as const) {
      const at = etEpoch(ds, t, kd);
      if (at > T0 && at < T1) marks.push({ at, label: l });
    }
  }
  const lx = (t: number) => (x(t) / W) * 100, ly = (y: number) => (y / H) * 100;
  // % = 그 시점이 속한 날의 전일 종가 대비(색칠 기준과 같게) — 글자색도 부호대로(사용자 2026-11-21 "최고가 -2.55 인데 빨간색?")
  const pc = (p: number, b = base) => (b && b > 0 ? ` ${p >= b ? "+" : ""}${((p / b - 1) * 100).toFixed(2)}%` : "");
  const pcTone = (p: number, b = base) => (b && b > 0 ? (p > b ? "text-rose-600" : p < b ? "text-blue-600" : "text-gray-600") : "text-gray-600");
  // 최고·최저 = 전일 종가 이후(오늘 구간, 지금 기준가가 같은 봉들)만(사용자 2026-11-21 "최고를 전일 종가 이후로")
  const todayP = pGroups.length ? pGroups[pGroups.length - 1].pts : P;
  const tPr = todayP.map(p => p.close);
  const hi = Math.max(...tPr), lo = Math.min(...tPr), hiP = todayP[tPr.indexOf(hi)], loP = todayP[tPr.indexOf(lo)], lastP = P[P.length - 1];
  const cLast = cums[cums.length - 1] ?? 0;
  let yPrice = ly(py(lastP.close)), yCum = cums.length ? ly(cy(cLast)) : -99;
  if (Math.abs(yPrice - yCum) < 11) { if (yPrice <= yCum) { yPrice -= 6; yCum += 6; } else { yPrice += 6; yCum -= 6; } }
  yPrice = Math.max(5, Math.min(92, yPrice)); yCum = Math.max(5, Math.min(92, yCum));
  const lab = "absolute pointer-events-none text-[10px] tabular-nums px-0.5 rounded bg-white/80 whitespace-nowrap";
  return (
    <div className="relative mt-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[190px]" preserveAspectRatio="none">
        {/* 배경 나스닥100(QQQ) — 선만(사용자 2026-11-21 "나스닥은 선으로만") */}
        {B.length > 1 && segs(B, i => by(B[i].close)).map((pp, i) => <polyline key={i} fill="none" stroke="#a78bfa" strokeWidth={1.1} opacity={0.75} points={pp} />)}
        <line x1={0} x2={W - PR} y1={mid} y2={mid} stroke="#d1d5db" strokeWidth={0.6} />
        {marks.map(m => <line key={m.at} x1={x(m.at)} x2={x(m.at)} y1={0} y2={H - 14} stroke="#818cf8" strokeDasharray="3 3" strokeWidth={0.9} opacity={m.label ? 0.8 : 0.45} />)}
        {/* 매수(위)·매도(아래)는 연하게, 둘의 차이(순매수 빨강 위 / 순매도 파랑 아래)만 진하게 — 국내 1분 띠와 같은 꼴 */}
        {[...bins.entries()].map(([k, b]) => { const cx = x(k + BIN / 2); return (
          <g key={k}>
            <rect x={cx - bw / 2} y={mid - barH(b.buy, mid - top)} width={bw} height={barH(b.buy, mid - top)} fill="#f43f5e" opacity={0.16} />
            <rect x={cx - bw / 2} y={mid} width={bw} height={barH(b.sell, H - mid - 16)} fill="#3b82f6" opacity={0.16} />
            {b.buy >= b.sell
              ? <rect x={cx - bw / 2} y={mid - barH(b.buy - b.sell, mid - top)} width={bw} height={barH(b.buy - b.sell, mid - top)} fill="#e11d48" opacity={0.85} />
              : <rect x={cx - bw / 2} y={mid} width={bw} height={barH(b.sell - b.buy, H - mid - 16)} fill="#2563eb" opacity={0.85} />}
          </g>); })}
        {/* 종목 가격 — 그날 기준가 위 빨강·아래 파랑 면 + 선(일반 지수 카드처럼), 기준가 점선은 그날 구간에만 */}
        {pGroups.length ? pGroups.map((g, gi) => {
          const gx0 = x(g.from) - (gi ? 0 : 2), gx1 = gi < pGroups.length - 1 ? x(pGroups[gi + 1].from) : W - PR, yb = py(g.base);
          return <g key={gi}>
            <defs>
              <clipPath id={`${uid}-u${gi}`}><rect x={gx0} y={0} width={Math.max(0, gx1 - gx0)} height={yb} /></clipPath>
              <clipPath id={`${uid}-d${gi}`}><rect x={gx0} y={yb} width={Math.max(0, gx1 - gx0)} height={H - yb} /></clipPath>
            </defs>
            {segs(g.pts, i => py(g.pts[i].close)).map((pp, si) => {
              const xs = pp.split(" "), x0 = xs[0].split(",")[0], x1 = xs[xs.length - 1].split(",")[0];
              const area = `${pp} ${x1},${yb} ${x0},${yb}`;
              return <g key={si}>
                <polygon clipPath={`url(#${uid}-u${gi})`} fill="#f43f5e" opacity={0.16} points={area} />
                <polygon clipPath={`url(#${uid}-d${gi})`} fill="#3b82f6" opacity={0.16} points={area} />
                <polyline clipPath={`url(#${uid}-u${gi})`} fill="none" stroke="#e11d48" strokeWidth={1.4} points={pp} />
                <polyline clipPath={`url(#${uid}-d${gi})`} fill="none" stroke="#2563eb" strokeWidth={1.4} points={pp} />
              </g>;
            })}
            <line x1={gx0} x2={gx1} y1={yb} y2={yb} stroke="#9ca3af" strokeDasharray="4 3" strokeWidth={0.9} />
          </g>;
        }) : segs(P, i => py(P[i].close)).map((pp, i) => <polyline key={i} fill="none" stroke="#475569" strokeWidth={1.3} points={pp} />)}
        {cums.some(c => c !== 0) && <polyline fill="none" stroke="#f59e0b" strokeWidth={1.6} points={real.map((m, i) => `${x(m.at)},${cy(cums[i])}`).join(" ")} />}
      </svg>
      {pGroups.filter((g, gi) => (gi < pGroups.length - 1 ? lx(pGroups[gi + 1].from) : 85) - lx(g.from) > 12).map((g, gi) => <span key={gi} className="absolute text-[9px] text-gray-500 pointer-events-none whitespace-nowrap" style={{ left: `${Math.max(0.5, lx(g.from))}%`, top: `${ly(py(g.base))}%`, transform: "translateY(-110%)" }}>전일 종가</span>)}
      {B.length > 1 && <span className="absolute left-1.5 bottom-3.5 text-[10px] text-gray-500 pointer-events-none">배경 나스닥100(QQQ){bPct != null ? <b className={bPct >= 0 ? "text-rose-600" : "text-blue-600"}> {bPct >= 0 ? "+" : ""}{bPct.toFixed(2)}%</b> : ""}</span>}
      {marks.filter(m => m.label).map(m => <span key={m.at} className="absolute bottom-0 text-[9px] text-indigo-500 pointer-events-none" style={{ left: `${lx(m.at)}%`, transform: "translateX(-50%)" }}>{m.label}</span>)}
      <span className="absolute left-1 bottom-0 text-[9.5px] text-gray-400 pointer-events-none">{kstLabel(T0, true)}</span>
      <span className="absolute bottom-0 text-[9.5px] text-gray-400 pointer-events-none" style={{ left: `${lx(T1)}%`, transform: "translateX(-100%)" }}>{kstLabel(T1)}</span>
      {/* 최고·최저 — 고: 점 위 ▼ 위에 글자, 저: 점 아래 ▲ 아래 글자(국내와 같은 꼴) */}
      {hi > lo && [{ p: hiP, up: true }, { p: loP, up: false }].map(({ p, up }) => {
        const xp = lx(p.t), y = ly(py(p.close));
        const tx = xp < 25 ? "-6px" : xp > 70 ? "calc(-100% + 6px)" : "-50%";
        const col = pcTone(p.close, p.base ?? base);
        return (
          <span key={up ? "hi" : "lo"}>
            <span className={`absolute pointer-events-none text-[8px] leading-none ${col}`} style={{ left: `${xp}%`, top: `${y}%`, transform: up ? "translate(-50%, -115%)" : "translate(-50%, 15%)" }}>{up ? "▼" : "▲"}</span>
            <span className={`${lab} ${col}`} style={{ left: `${xp}%`, top: `${y}%`, transform: `translate(${tx}, ${up ? "calc(-100% - 9px)" : "9px"})` }}>{up ? "최고" : "최저"} ${p.close.toFixed(2)}{pc(p.close, p.base ?? base)}</span>
          </span>
        );
      })}
      {/* 현재가 이름표(선 끝) */}
      <span className="absolute pointer-events-none text-[10.5px] font-bold bg-slate-100 text-slate-700 border border-slate-300 px-1 py-px rounded-sm whitespace-nowrap tabular-nums"
            style={{ left: `${lx(lastP.t)}%`, top: `${yPrice}%`, transform: "translate(6px, -50%)" }}>
        현재가 ${lastP.close.toFixed(2)}
        {pc(lastP.close) && <span className={`block text-right text-[10px] ${base && lastP.close > base ? "text-rose-600" : base && lastP.close < base ? "text-blue-600" : ""}`}>{pc(lastP.close).trim()}</span>}
      </span>
      {/* 체결 누적(주황) 이름표 */}
      {cums.some(c => c !== 0) && (
        <span className="absolute pointer-events-none text-[10.5px] font-bold bg-orange-100 text-orange-700 border border-orange-300 px-1 py-px rounded-sm whitespace-nowrap tabular-nums"
              style={{ left: `${lx(lastP.t)}%`, top: `${yCum}%`, transform: "translate(6px, -50%)" }}>체결 <span className={cLast > 0 ? "text-rose-600" : cLast < 0 ? "text-blue-600" : ""}>{won(cLast, true)}</span></span>
      )}
    </div>
  );
}
