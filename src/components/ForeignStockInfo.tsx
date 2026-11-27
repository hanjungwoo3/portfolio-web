// 🌎 해외 종목정보 창 — 미국·일본 종목(사용자 2026-11-27 "미국/일본 종목들도 종목정보 창 만들 수 있지 않아?" → "시작해").
//   한 페이지 스크롤 + 위 칩(국내 종목정보 창과 같은 꼴): ⚡ 실시간(미국만, 반도체 수급(미국) 칸 그대로) → 요약 → 실적·추정(미국만) → 차트(일봉)
//   여는 곳: openForeignStockInfo(lib/foreignInfo) → App·Mobile 최상위 ForeignStockInfoHost.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEscClose } from "../lib/useEscClose";
import { fetchTossEstimate, fetchYahooPriceHistory, resolveTossUsCode, heatmapLogoUrl, fetchTossNewsLink } from "../lib/api";
import { OPEN_FOREIGN_INFO, type ForeignInfoReq, isJpSym, fetchTossForeignOverview, fetchTossSegments, fetchTvFundamentals, fetchTossConsensus, fetchTossFilings, fetchTossCompanyNews, naverWorldCode, type TossConsensus } from "../lib/foreignInfo";
import { openExternal } from "../lib/toss";
import { ConsensusCharts } from "./ConsensusCharts";
import { UsStockLive } from "./UsSemiDashTab";
import { TossPane, NaverPane } from "./CommunityDialog";
const CandleChartLight = lazy(() => import("./CandleChartLight"));

type Sec = "live" | "summary" | "fin" | "chart" | "news";
const SEC_LABEL: Record<Sec, string> = { live: "⚡ 실시간", summary: "요약", fin: "실적·의견", chart: "차트", news: "뉴스·공시·대화" };
const NO_INVESTORS: never[] = [];
const MA = [5, 20, 60, 120];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pctT = (v: number | null, sign = true) => (v == null ? "—" : `${sign && v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null) => (v == null ? "text-gray-400" : v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
// 큰 금액 — 달러는 B·T, 엔은 억·조엔, 원은 조·억
function big(v: number | null, cur: string): string {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (cur === "KRW") return a >= 1e12 ? `${s}${(a / 1e12).toFixed(a >= 1e14 ? 0 : 1)}조원` : `${s}${Math.round(a / 1e8).toLocaleString()}억원`;
  if (cur === "JPY") return a >= 1e12 ? `${s}${(a / 1e12).toFixed(2)}조엔` : `${s}${Math.round(a / 1e8).toLocaleString()}억엔`;
  return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : `${s}$${Math.round(a / 1e6).toLocaleString()}M`;
}
const money = (v: number | null, cur: string) => (v == null ? "—" : cur === "JPY" ? `¥${Math.round(v).toLocaleString()}` : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
// TradingView 추천 점수 1(강력 매수) ~ 5(강력 매도)
const recText = (m: number | null) => (m == null ? "—" : m < 1.5 ? "강력 매수" : m < 2.5 ? "매수" : m < 3.5 ? "중립" : m < 4.5 ? "매도" : "강력 매도");

function Cell({ k, v, hint, cls = "" }: { k: string; v: React.ReactNode; hint?: string; cls?: string }) {
  return (
    <div title={hint} className="flex items-baseline justify-between gap-2 px-2 py-1 rounded bg-white border border-gray-200">
      <span className="text-[11px] text-gray-500 whitespace-nowrap">{k}</span>
      <b className={`text-[12.5px] tabular-nums text-right ${cls}`}>{v}</b>
    </div>
  );
}

function ForeignStockInfo({ req, onClose }: { req: ForeignInfoReq; onClose: () => void }) {
  useEscClose(true, onClose);
  const { sym, name } = req;
  const jp = isJpSym(sym);
  // 미국 = 토스 코드(넘겨받았거나 심볼로 찾기) — 없으면 실시간·요약(토스)·실적은 비고 TradingView·차트만
  const tossQ = useQuery({ queryKey: ["toss-us-code", sym], queryFn: async () => req.toss ?? (await resolveTossUsCode(sym)) ?? "", enabled: !jp, staleTime: Infinity });
  const toss = jp ? "" : tossQ.data ?? "";
  const ovQ = useQuery({ queryKey: ["toss-foreign-overview", toss], queryFn: () => fetchTossForeignOverview(toss), enabled: !!toss, staleTime: 6 * 3600_000, retry: 1 });
  const segQ = useQuery({ queryKey: ["toss-foreign-seg", toss], queryFn: () => fetchTossSegments(toss), enabled: !!toss, staleTime: 24 * 3600_000, retry: 1 });
  const tvQ = useQuery({ queryKey: ["tv-fundamentals", sym], queryFn: () => fetchTvFundamentals(sym), staleTime: 30 * 60_000, retry: 1 });
  const tv0 = tvQ.data;
  const est = (m: "revenue" | "operating-income" | "eps") => ({ queryKey: ["est", toss, m], queryFn: () => fetchTossEstimate(toss, m), enabled: !!toss, staleTime: 24 * 3600_000 });
  const revQ = useQuery(est("revenue")), opQ = useQuery(est("operating-income")), epsQ = useQuery(est("eps"));
  const cc = ovQ.data?.companyCode ?? "";
  const conQ = useQuery({ queryKey: ["toss-consensus", toss], queryFn: () => fetchTossConsensus(toss), enabled: !!toss, staleTime: 6 * 3600_000, retry: 1 });
  const filQ = useQuery({ queryKey: ["toss-filings", cc], queryFn: () => fetchTossFilings(cc), enabled: !!cc, staleTime: 30 * 60_000, retry: 1 });
  const newsQ = useQuery({ queryKey: ["toss-co-news", cc], queryFn: () => fetchTossCompanyNews(cc), enabled: !!cc, staleTime: 5 * 60_000, retry: 1 });
  const nv = naverWorldCode(sym, tv0?.tvSym);
  const pxQ = useQuery({ queryKey: ["foreign-daily", sym], queryFn: () => fetchYahooPriceHistory(sym, "2y"), staleTime: 3 * 3600_000, retry: 1 });

  const secs: Sec[] = toss ? ["live", "summary", "fin", "chart", "news"] : ["summary", "chart", "news"];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [curS, setCur] = useState<Sec | null>(null);   // 토스 코드를 찾기 전엔 ⚡실시간 칸이 없다 — 칸 목록이 바뀌어도 맞게
  const cur = curS && secs.includes(curS) ? curS : secs[0];
  const topIn = (root: HTMLElement, el: HTMLElement) => el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;   // offsetTop 은 스크롤 상자 기준이 아니라 칩이 엉뚱한 자리로 갔다
  const go = (k: Sec) => { const root = scrollRef.current, el = root?.querySelector<HTMLElement>(`[data-sec="${k}"]`); if (root && el) root.scrollTo({ top: topIn(root, el) - 4, behavior: "smooth" }); };
  const onScroll = () => {
    const root = scrollRef.current; if (!root) return;
    let best = secs[0];
    for (const k of secs) { const el = root.querySelector<HTMLElement>(`[data-sec="${k}"]`); if (el && topIn(root, el) - root.scrollTop <= 80) best = k; }
    if (best !== cur) setCur(best);
  };

  const tv = tvQ.data ?? null;
  const cur$ = (tv?.currency as string) || (jp ? "JPY" : "USD");
  const px = num(tv?.close);
  const prices = pxQ.data ?? [];
  const shown = prices.slice(-250);   // 화면 = 최근 1년, 이평은 2년으로 계산
  const tossUrl = toss ? `https://www.tossinvest.com/stocks/${toss}` : null;
  const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`;

  return (
    <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pg-bg bg-white shadow-xl w-full max-w-5xl rounded-t-xl sm:rounded-lg h-[92vh] sm:h-[90vh] flex flex-col overflow-hidden">
        <header className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2 min-w-0">
          {tv?.logoid ? <img src={heatmapLogoUrl(String(tv.logoid))} alt="" className="w-5 h-5 rounded-full bg-white" /> : null}
          <b className="text-[15px] text-gray-800 truncate min-w-0">{name}</b>
          <span className="hidden sm:inline text-xs text-gray-500 shrink-0">{sym}{ovQ.data?.market ? ` · ${ovQ.data.market}` : jp ? " · 도쿄" : ""}</span>
          {px != null && <span className="hidden sm:inline ml-1 text-[11px] text-gray-500 shrink-0" title="TradingView — 미국은 장 밖이면 직전 정규장 종가, 지금 값은 아래 ⚡실시간">종가 <b className="text-sm text-gray-800 tabular-nums">{money(px, cur$)}</b></span>}
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {tossUrl && <button type="button" onClick={() => openExternal(tossUrl)} className="px-2 py-0.5 rounded border border-gray-300 bg-white text-[11.5px] font-bold text-gray-600 hover:bg-gray-100">토스에서 보기</button>}
            <button type="button" onClick={() => openExternal(yahooUrl)} className="px-2 py-0.5 rounded border border-gray-300 bg-white text-[11.5px] font-bold text-gray-600 hover:bg-gray-100">야후</button>
            <button onClick={onClose} className="ml-1 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </span>
        </header>
        <div className="pg-menu px-4 py-1.5 border-b bg-white flex items-center gap-1 overflow-x-auto shrink-0">
          {secs.map(k => (
            <button key={k} onClick={() => go(k)} className={`px-2.5 py-0.5 text-[12px] font-bold rounded-full whitespace-nowrap ${cur === k ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{SEC_LABEL[k]}</button>
          ))}
        </div>
        <div ref={scrollRef} onScroll={onScroll} className="px-4 py-3 overflow-y-auto space-y-5">
          {toss && (
            <section data-sec="live">
              <UsStockLive ticker={sym} toss={toss} name={name} desc={ovQ.data?.industry} />
            </section>
          )}

          <section data-sec="summary" className="space-y-2.5">
            <h3 className="text-sm font-bold text-gray-700">요약</h3>
            {(ovQ.data || tv) && (
              <div className="text-[12px] text-gray-600 leading-relaxed">
                {ovQ.data?.englishName ?? tv?.description}
                {ovQ.data?.industry && <> · 업종 <b>{ovQ.data.industry}</b></>}
                {!ovQ.data?.industry && tv?.industry && <> · {String(tv.sector)} / {String(tv.industry)}</>}
                {ovQ.data?.listDate && <> · 상장 {ovQ.data.listDate}</>}
                {num(tv?.number_of_employees) != null && <> · 직원 {num(tv?.number_of_employees)!.toLocaleString()}명</>}
                {ovQ.data?.tics.length ? <div className="mt-1 flex flex-wrap gap-1">{ovQ.data.tics.map(t => <span key={t} className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[11px] text-slate-600">{t}</span>)}</div> : null}
              </div>
            )}
            {/* 몸값 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <Cell k="시가총액" v={ovQ.data?.capUsd ? <>{big(ovQ.data.capUsd, "USD")}<span className="block text-[10.5px] font-normal text-gray-500">{big(ovQ.data.capKrw ?? null, "KRW")}</span></> : big(num(tv?.market_cap_basic), cur$)} />
              {ovQ.data?.evUsd ? <Cell k="기업가치(EV)" v={big(ovQ.data.evUsd, "USD")} hint="시가총액 + 순부채 — 회사를 통째로 살 때 드는 값" /> : null}
              <Cell k="PER" v={num(tv?.price_earnings_ttm)?.toFixed(1) ?? "—"} hint="주가 ÷ 최근 1년 주당순이익 — 몇 년치 이익인가" />
              <Cell k="PBR" v={num(tv?.price_book_fq)?.toFixed(2) ?? "—"} hint="주가 ÷ 주당순자산" />
              <Cell k="EPS(1년)" v={money(num(tv?.earnings_per_share_diluted_ttm), cur$)} hint="최근 1년 주당순이익(희석)" />
              <Cell k="배당수익률" v={num(tv?.dividends_yield_current) != null ? `${num(tv?.dividends_yield_current)!.toFixed(2)}%` : "—"} />
              <Cell k="ROE" v={pctT(num(tv?.return_on_equity_fq), false)} hint="자기자본으로 1년에 얼마 버나" />
              <Cell k="베타(1년)" v={num(tv?.beta_1_year)?.toFixed(2) ?? "—"} hint="시장이 1% 움직일 때 이 종목이 움직이는 정도" />
            </div>
            {/* 돈 버는 힘 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <Cell k="매출(1년)" v={big(num(tv?.total_revenue_ttm), cur$)} />
              <Cell k="매출총이익률" v={pctT(num(tv?.gross_margin_ttm), false)} />
              <Cell k="영업이익률" v={pctT(num(tv?.operating_margin_ttm), false)} />
              <Cell k="순이익률" v={pctT(num(tv?.net_margin_ttm), false)} />
              <Cell k="잉여현금(1년)" v={big(num(tv?.free_cash_flow_ttm), cur$)} hint="영업으로 번 현금 − 설비투자" />
              <Cell k="부채" v={big(num(tv?.total_debt_fq), cur$)} />
              <Cell k="유통주식" v={pctT(num(tv?.float_shares_percent_current), false)} hint="시장에서 실제로 사고팔 수 있는 주식 비율" />
              <Cell k="다음 실적" v={num(tv?.earnings_release_next_date) ? new Date(num(tv?.earnings_release_next_date)! * 1000 + 9 * 3600_000).toISOString().slice(0, 10) : "—"} hint="TradingView 실적 발표 예정일(한국 날짜)" />
            </div>
            {/* 흐름 */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {([["1주", "Perf.W"], ["1달", "Perf.1M"], ["3달", "Perf.3M"], ["올해", "Perf.YTD"], ["1년", "Perf.Y"]] as const).map(([k, c]) => (
                <Cell key={k} k={k} v={pctT(num(tv?.[c]))} cls={tone(num(tv?.[c]))} />
              ))}
              <Cell k="RSI" v={num(tv?.RSI)?.toFixed(0) ?? "—"} hint="70 위 = 많이 오름(과열), 30 아래 = 많이 내림" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <Cell k="52주 최고" v={money(num(tv?.price_52_week_high), cur$)} hint={px && num(tv?.price_52_week_high) ? `지금은 최고가의 ${Math.round((px / num(tv?.price_52_week_high)!) * 100)}%` : undefined} />
              <Cell k="52주 최저" v={money(num(tv?.price_52_week_low), cur$)} />
              <Cell k="20일 평균" v={money(num(tv?.SMA20), cur$)} />
              <Cell k="200일 평균" v={money(num(tv?.SMA200), cur$)} />
            </div>
            {/* 애널리스트 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <Cell k="애널리스트 의견" v={<>{recText(num(tv?.recommendation_mark))}{num(tv?.recommendation_mark) != null && <span className="ml-1 text-[10.5px] font-normal text-gray-500">{num(tv?.recommendation_mark)!.toFixed(2)}</span>}</>} hint="TradingView 종합 — 1 강력 매수 ~ 5 강력 매도" />
              <Cell k="목표가 평균" v={<>{money(num(tv?.price_target_average), cur$)}{px && num(tv?.price_target_average) ? <span className={`ml-1 text-[10.5px] ${tone(num(tv?.price_target_average)! - px)}`}>{pctT((num(tv?.price_target_average)! / px - 1) * 100)}</span> : null}</>} />
              <Cell k="목표가 최고" v={money(num(tv?.price_target_high), cur$)} />
              <Cell k="목표가 최저" v={money(num(tv?.price_target_low), cur$)} />
            </div>
            {segQ.data?.items.some(x => x.ratio > 0) ? (
              <div>
                <div className="text-[12px] font-bold text-gray-600 mb-1">사업부별 매출 비중{segQ.data.endDate ? <span className="ml-1 font-normal text-gray-400">({segQ.data.endDate} 회계연도)</span> : null}</div>
                <div className="space-y-0.5">
                  {segQ.data.items.filter(x => x.ratio > 0).map(x => (
                    <div key={x.name} className="flex items-center gap-2 text-[11.5px]">
                      <span className="w-[45%] sm:w-[260px] truncate text-gray-700" title={x.name}>{x.name}</span>
                      <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-300" style={{ width: `${Math.min(100, x.ratio)}%` }} /></div>
                      <span className="w-12 text-right tabular-nums text-gray-600">{x.ratio.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="text-[10.5px] text-gray-400">
              출처: {toss ? `토스(${ovQ.data?.source ?? "개요·사업부"}) · ` : ""}TradingView(지표·목표가, {cur$ === "JPY" ? "엔화" : "달러"}){tvQ.isError ? " — 지표 받기 실패" : ""}
            </div>
          </section>

          {toss && (
            <section data-sec="fin">
              {conQ.data && <ConsensusBlock c={conQ.data} px={px} />}
              <h3 className="text-sm font-bold text-gray-700 mb-1.5 mt-4">실적·추정 <span className="text-[11px] font-normal text-gray-500">분기 · 원화 환산(토스)</span></h3>
              <ConsensusCharts revenue={revQ.data ?? undefined} operatingIncome={opQ.data ?? undefined} eps={epsQ.data ?? undefined} />
            </section>
          )}

          <section data-sec="chart">
            <h3 className="text-sm font-bold text-gray-700 mb-1.5">일봉 <span className="text-[11px] font-normal text-gray-500">최근 1년 · 이평 5·20·60·120 · 야후</span></h3>
            {shown.length ? (
              <Suspense fallback={<div className="h-[360px] text-xs text-gray-400">차트 불러오는 중…</div>}>
                <CandleChartLight prices={shown} maPrices={prices} investors={NO_INVESTORS} mode="candle" maPeriods={MA} ticker={sym} currency={jp ? "JPY" : "USD"} />
              </Suspense>
            ) : <div className="text-xs text-gray-400">{pxQ.isLoading ? "일봉 받는 중…" : "일봉 없음(야후)"}</div>}
          </section>

          <section data-sec="news" className="space-y-4">
            {toss && (
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-bold text-gray-700 mb-1">📰 뉴스 <span className="text-[11px] font-normal text-gray-500">토스(해외 기사 한국어 번역)</span></h3>
                  <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded bg-white">
                    {newsQ.data?.length ? newsQ.data.map(n => (
                      <button key={n.id} type="button" onClick={() => void fetchTossNewsLink(n.id).then(u => openExternal(u ?? `https://www.tossinvest.com/stocks/${toss}/news`))}
                              className="block w-full text-left px-2.5 py-1.5 hover:bg-gray-50">
                        <div className="text-[12.5px] font-bold text-gray-800 leading-snug">{n.title}</div>
                        <div className="text-[11px] text-gray-500 line-clamp-2">{n.text}</div>
                        <div className="text-[10.5px] text-gray-400">{n.source} · {n.at.slice(5, 16).replace("T", " ")}</div>
                      </button>
                    )) : <div className="p-3 text-xs text-gray-400">{newsQ.isLoading || !cc ? "불러오는 중…" : "뉴스 없음"}</div>}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-700 mb-1">📋 공시·실적 발표 <span className="text-[11px] font-normal text-gray-500">SEC 제출 서류 한국어 요약(토스)</span></h3>
                  <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded bg-white">
                    {filQ.data?.length ? filQ.data.map(f => (
                      <button key={f.id} type="button" onClick={() => openExternal(`https://www.tossinvest.com/stocks/${toss}/news?menu=disclosure`)} className="block w-full text-left px-2.5 py-1.5 hover:bg-gray-50">
                        <div className="text-[12.5px] font-bold text-gray-800 leading-snug"><span className="mr-1 px-1 rounded bg-slate-100 text-[10px] font-normal text-slate-600">{f.form}</span>{f.title}<span className="ml-1.5 text-[10.5px] font-normal text-gray-400">{f.date}</span></div>
                        {f.summary && <div className="text-[11px] text-gray-500 line-clamp-3">{f.summary}</div>}
                      </button>
                    )) : <div className="p-3 text-xs text-gray-400">{filQ.isLoading || !cc ? "불러오는 중…" : "공시 없음"}</div>}
                  </div>
                </div>
              </div>
            )}
            {/* 대화 — 토스·네이버 둘 다(사용자 2026-11-27 "대화는 토스, 네이버 둘다") */}
            <div className={`grid gap-2 ${toss && nv ? "sm:grid-cols-2" : ""}`}>
              {toss && <TossPane ticker={toss} refreshTs={0} />}
              {nv && <NaverPane ticker={nv} refreshTs={0} />}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** 애널리스트 — 투자의견 분포 막대 + 목표가(평균·중간·최고·최저) 와 지금 값 위치 */
function ConsensusBlock({ c, px }: { c: TossConsensus; px: number | null }) {
  const o = c.opinion, t = c.target;
  const parts = o ? ([["강력 매수", o.strongBuy, "bg-rose-500"], ["매수", o.buy, "bg-rose-300"], ["중립", o.hold, "bg-gray-300"], ["매도", o.sell, "bg-blue-300"], ["강력 매도", o.strongSell, "bg-blue-500"]] as const) : [];
  const tot = parts.reduce((a, p) => a + p[1], 0) || 1;
  const now = c.past[c.past.length - 1]?.price ?? px ?? null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-gray-700">🎯 애널리스트 <span className="text-[11px] font-normal text-gray-500">토스 · {t?.date ?? o?.date ?? ""} 기준</span></h3>
      {o && (
        <div>
          <div className="flex h-3 rounded overflow-hidden">{parts.map(([k, n, cls]) => n ? <div key={k} className={cls} style={{ width: `${(n / tot) * 100}%` }} title={`${k} ${n}명`} /> : null)}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-gray-600">{parts.map(([k, n]) => <span key={k}>{k} <b>{n}</b></span>)}<span className="text-gray-400">· {o.count}명 의견</span></div>
        </div>
      )}
      {t && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <Cell k="목표가 평균" v={<>${t.mean.toLocaleString(undefined, { maximumFractionDigits: 2 })}{now ? <span className={`ml-1 text-[10.5px] ${tone(t.mean - now)}`}>{pctT((t.mean / now - 1) * 100)}</span> : null}</>} hint={`${t.count ?? "?"}개 목표가 평균 · 퍼센트 = 지금 값 대비`} />
          <Cell k="중간값" v={t.median != null ? `$${t.median.toLocaleString()}` : "—"} />
          <Cell k="최고" v={`$${t.high.toLocaleString()}`} />
          <Cell k="최저" v={`$${t.low.toLocaleString()}`} />
        </div>
      )}
      {c.past.length > 1 && (
        <div className="text-[11px] text-gray-500">월말 종가: {c.past.slice(-6).map(p => `${+p.date.slice(5, 7)}월 $${Math.round(p.price).toLocaleString()}`).join(" · ")}</div>
      )}
    </div>
  );
}

export function ForeignStockInfoHost() {
  const [req, setReq] = useState<(ForeignInfoReq & { n: number }) | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<ForeignInfoReq>).detail; if (d) setReq(r => ({ ...d, n: (r?.n ?? 0) + 1 })); };
    window.addEventListener(OPEN_FOREIGN_INFO, h);
    return () => window.removeEventListener(OPEN_FOREIGN_INFO, h);
  }, []);
  return req ? <ForeignStockInfo key={req.n} req={req} onClose={() => setReq(null)} /> : null;
}
