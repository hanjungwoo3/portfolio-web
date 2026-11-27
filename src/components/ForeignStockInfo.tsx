// 🌎 해외 종목정보 창 — 미국·일본 종목(사용자 2026-11-27 "미국/일본 종목들도 종목정보 창" → 2026-11-28 "국장과 동일한 크기로 같은 구성으로 하고 없는것만 빼면").
//   국내 종목정보 창(ValuationModal)과 같은 틀: 전체 화면(98vw·96vh) · 맨 위 '📊 종목정보' 줄 · 가격 머리 · 칩 · 한 페이지 스크롤.
//   ⚡ 실시간(미국만: 반도체 수급(미국) 칸 + 뉴스|공시 + 토스·네이버 대화) → 요약(기업개요 + 3단 지표) → 실적·재무 → 차트(년·월·주봉 + 일봉)
//   일본은 토스에 없어 실시간·실적이 빠지고 맨 아래 '소식·대화'(네이버)만.
//   없는 것(국내 전용): 투자자별 수급·거래원·프로그램·신용/대차·DART·5% 대주주.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEscClose } from "../lib/useEscClose";
import { fetchTossEstimate, fetchYahooPriceHistory, resolveTossUsCode, heatmapLogoUrl, fetchTossNewsLink, fetchTossUsPricesBySymbol } from "../lib/api";
import {
  OPEN_FOREIGN_INFO, type ForeignInfoReq, isJpSym, fetchTossForeignOverview, fetchTossSegments, fetchTvFundamentals,
  fetchTossConsensus, fetchTossFilings, fetchTossCompanyNews, fetchTossIndicators, fetchTossStability, naverWorldCode, type TossConsensus,
} from "../lib/foreignInfo";
import { dayChangePct } from "../lib/format";
import { openExternal } from "../lib/toss";
import { openGoogleAi, STOCK_ANALYSIS_PROMPT, aiNowStamp } from "../lib/googleAi";
import { ConsensusCharts } from "./ConsensusCharts";
import { PriceMultiSparks } from "./PriceMultiSparks";
import { UsStockLive } from "./UsSemiDashTab";
import { TossPane, NaverPane } from "./CommunityDialog";
const CandleChartLight = lazy(() => import("./CandleChartLight"));

type Sec = "live" | "summary" | "fin" | "chart" | "news";
const SEC_LABEL: Record<Sec, string> = { live: "⚡ 실시간", summary: "요약", fin: "실적·재무", chart: "차트", news: "소식·대화" };
const NO_INVESTORS: never[] = [];
const MA = [5, 20, 60, 120];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pctT = (v: number | null, sign = true) => (v == null ? null : `${sign && v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null) => (v == null ? "text-gray-400" : v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-900");
// 큰 금액 — 달러는 B·T, 엔은 억·조엔, 원은 조·억
function big(v: number | null | undefined, cur: string): string | null {
  if (v == null) return null;
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (cur === "KRW") return a >= 1e12 ? `${s}${(a / 1e12).toFixed(a >= 1e14 ? 0 : 1)}조원` : `${s}${Math.round(a / 1e8).toLocaleString()}억원`;
  if (cur === "JPY") return a >= 1e12 ? `${s}${(a / 1e12).toFixed(2)}조엔` : `${s}${Math.round(a / 1e8).toLocaleString()}억엔`;
  return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : `${s}$${Math.round(a / 1e6).toLocaleString()}M`;
}
const money = (v: number | null | undefined, cur: string) => (v == null ? null : cur === "JPY" ? `¥${Math.round(v).toLocaleString()}` : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
// TradingView 추천 점수 1(강력 매수) ~ 5(강력 매도)
const recText = (m: number | null) => (m == null ? "—" : m < 1.5 ? "강력 매수" : m < 2.5 ? "매수" : m < 3.5 ? "중립" : m < 4.5 ? "매도" : "강력 매도");

/** 국내 창 지표 묶음(Section/IndicatorRow)과 같은 꼴 — 값 없는 줄은 뺀다, 다 없으면 칸째 감춘다 */
type Row = { k: string; v: React.ReactNode | null; desc?: string; cls?: string };
function Block({ title, sub, rows, loading }: { title: string; sub: string; rows: Row[]; loading?: boolean }) {
  const shown = rows.filter(r => r.v != null && r.v !== "");
  if (!shown.length && !loading) return null;
  return (
    <section className="bg-gray-50 rounded p-3 border border-gray-200">
      <header className="mb-2">
        <h3 className="font-bold text-gray-700">{title}{loading && !shown.length && <span className="ml-1.5 text-[10px] font-normal text-gray-400">불러오는 중…</span>}</h3>
        <p className="text-xs text-gray-400">{sub}</p>
      </header>
      <div>
        {shown.map(r => (
          <div key={r.k} className="py-1.5 border-b border-gray-100 last:border-b-0">
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-sm text-gray-700">{r.k}</span>
              <span className={`text-sm font-bold tabular-nums text-right ${r.cls ?? "text-gray-900"}`}>{r.v}</span>
            </div>
            {r.desc && <p className="text-[10.5px] text-gray-500 mt-0.5 leading-snug">{r.desc}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 뉴스·공시 칸 — 대화 칸(PaneShell)과 같은 틀(머리 줄 + 안쪽 스크롤) */
function FeedShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col min-h-0 border border-gray-200 rounded-md overflow-hidden bg-white">
      <div className="flex items-baseline gap-1.5 px-3 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0">
        <span className="text-xs font-bold text-gray-700">{title}</span><span className="text-[10.5px] text-gray-400">{sub}</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
    </div>
  );
}

function ForeignStockInfo({ req, onClose }: { req: ForeignInfoReq; onClose: () => void }) {
  useEscClose(true, onClose);
  const { sym, name } = req;
  const jp = isJpSym(sym);
  const tossQ = useQuery({ queryKey: ["toss-us-code", sym], queryFn: async () => req.toss ?? (await resolveTossUsCode(sym)) ?? "", enabled: !jp, staleTime: Infinity });
  const toss = jp ? "" : tossQ.data ?? "";
  const on = !!toss;
  const ovQ = useQuery({ queryKey: ["toss-foreign-overview", toss], queryFn: () => fetchTossForeignOverview(toss), enabled: on, staleTime: 6 * 3600_000, retry: 1 });
  const segQ = useQuery({ queryKey: ["toss-foreign-seg", toss], queryFn: () => fetchTossSegments(toss), enabled: on, staleTime: 24 * 3600_000, retry: 1 });
  const indQ = useQuery({ queryKey: ["toss-indicators", toss], queryFn: () => fetchTossIndicators(toss), enabled: on, staleTime: 6 * 3600_000, retry: 1 });
  const stQ = useQuery({ queryKey: ["toss-stability", toss], queryFn: () => fetchTossStability(toss), enabled: on, staleTime: 24 * 3600_000, retry: 1 });
  const conQ = useQuery({ queryKey: ["toss-consensus", toss], queryFn: () => fetchTossConsensus(toss), enabled: on, staleTime: 6 * 3600_000, retry: 1 });
  const tvQ = useQuery({ queryKey: ["tv-fundamentals", sym], queryFn: () => fetchTvFundamentals(sym), staleTime: 30 * 60_000, retry: 1 });
  const pxNowQ = useQuery({ queryKey: ["tile-pop-us", sym], queryFn: () => fetchTossUsPricesBySymbol([sym]), enabled: on, staleTime: 20_000, refetchInterval: 60_000 });
  const est = (m: "revenue" | "operating-income" | "eps") => ({ queryKey: ["est", toss, m], queryFn: () => fetchTossEstimate(toss, m), enabled: on, staleTime: 24 * 3600_000 });
  const revQ = useQuery(est("revenue")), opQ = useQuery(est("operating-income")), epsQ = useQuery(est("eps"));
  const cc = ovQ.data?.companyCode ?? "";
  const filQ = useQuery({ queryKey: ["toss-filings", cc], queryFn: () => fetchTossFilings(cc), enabled: !!cc, staleTime: 30 * 60_000, retry: 1 });
  const newsQ = useQuery({ queryKey: ["toss-co-news", cc], queryFn: () => fetchTossCompanyNews(cc), enabled: !!cc, staleTime: 5 * 60_000, retry: 1 });
  const pxQ = useQuery({ queryKey: ["foreign-daily", sym], queryFn: () => fetchYahooPriceHistory(sym, "2y"), staleTime: 3 * 3600_000, retry: 1 });

  const tv = tvQ.data ?? null;
  const nv = naverWorldCode(sym, tv?.tvSym);
  const cur$ = (tv?.currency as string) || (jp ? "JPY" : "USD");
  // 지금 값 — 미국 = 토스(장 밖도 데이·프리·애프터), 일본 = TradingView
  const live = pxNowQ.data?.[0];
  const px = live?.price ?? num(tv?.close);
  const chg = live ? dayChangePct(live) ?? null : num(tv?.change);

  const secs: Sec[] = on ? ["live", "summary", "fin", "chart"] : ["summary", "chart", "news"];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [curS, setCur] = useState<Sec | null>(null);
  const cur = curS && secs.includes(curS) ? curS : secs[0];
  const topIn = (root: HTMLElement, el: HTMLElement) => el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;   // offsetTop 은 스크롤 상자 기준이 아니라 칩이 엉뚱한 자리로 갔다
  const go = (k: Sec) => { const root = scrollRef.current, el = root?.querySelector<HTMLElement>(`[data-sec="${k}"]`); if (root && el) root.scrollTo({ top: topIn(root, el) - 4, behavior: "smooth" }); };
  const onScroll = () => {
    const root = scrollRef.current; if (!root) return;
    let best = secs[0];
    for (const k of secs) { const el = root.querySelector<HTMLElement>(`[data-sec="${k}"]`); if (el && topIn(root, el) - root.scrollTop <= 80) best = k; }
    if (best !== cur) setCur(best);
  };

  const prices = pxQ.data ?? [];
  const shown = prices.slice(-250);
  const tossUrl = on ? `https://www.tossinvest.com/stocks/${toss}` : null;
  const ind = indQ.data, st = stQ.data, ov = ovQ.data;
  const ttl = "px-1.5 py-0.5 rounded border border-gray-300 bg-white text-xs text-gray-600 hover:bg-gray-100 whitespace-nowrap";
  const aiQuery = () => {
    const ctx = [`${name}(${sym})`];
    if (px) ctx.push(`현재가 ${money(px, cur$)}`);
    if (ov?.capUsd) ctx.push(`시가총액 ${big(ov.capUsd, "USD")}`);
    if (ind?.per) ctx.push(`PER ${ind.per}`);
    if (conQ.data?.target) ctx.push(`평균 목표주가 $${conQ.data.target.mean}`);
    return `${STOCK_ANALYSIS_PROMPT}\n\n[기준시각] ${aiNowStamp()}\n[분석 대상] ${ctx.join(", ")}`;
  };
  const priceHead = px != null && (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-base font-bold">{money(px, cur$)}</span>
      {chg != null && <span className={`text-sm font-bold tabular-nums ${tone(chg)}`}>{chg > 0 ? "▲" : chg < 0 ? "▼" : ""}{pctT(chg)}</span>}
    </span>
  );
  const links = (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {tossUrl && <button type="button" onClick={() => openExternal(tossUrl)} className={ttl}>토스</button>}
      {nv && <button type="button" onClick={() => openExternal(`https://stock.naver.com/worldstock/stock/${nv}/total`)} className={ttl}>네이버</button>}
      <button type="button" onClick={() => openExternal(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`)} className={ttl}>야후</button>
      <button type="button" onClick={() => openGoogleAi(aiQuery())} className="px-1.5 py-0.5 rounded border border-blue-300 bg-blue-50 text-xs font-bold text-blue-700 hover:bg-blue-100 whitespace-nowrap">🔍 AI 검색</button>
    </span>
  );
  // 대화 — 토스·네이버 둘 다(사용자 2026-11-27)
  const talk = (toss || nv) ? (
    <div className={`grid gap-2 ${toss && nv ? "sm:grid-cols-2" : ""}`}>
      {toss && <TossPane ticker={toss} refreshTs={0} />}
      {nv && <NaverPane ticker={nv} refreshTs={0} />}
    </div>
  ) : null;

  const valB = <Block title="📊 가치평가" sub="주가가 비싼지 싼지 판단" loading={tvQ.isLoading || indQ.isLoading} rows={[
                  { k: "시가총액", v: ov?.capUsd ? <>{big(ov.capUsd, "USD")}<span className="ml-1 text-[11px] font-normal text-gray-500">{big(ov.capKrw, "KRW")}</span></> : big(num(tv?.market_cap_basic), cur$) },
                  { k: "기업가치(EV)", v: big(ov?.evUsd, "USD"), desc: "시가총액 + 순부채 — 회사를 통째로 살 때 드는 값" },
                  { k: "PER", v: ind?.per ?? (num(tv?.price_earnings_ttm) != null ? `${num(tv?.price_earnings_ttm)!.toFixed(1)}배` : null), desc: "주가 ÷ 주당순이익 — 몇 년치 이익인가" },
                  { k: "예상 PER", v: num(tv?.price_earnings_forward_fy) != null ? `${num(tv?.price_earnings_forward_fy)!.toFixed(1)}배` : null, desc: "올해 예상 이익 기준" },
                  { k: "PBR", v: ind?.pbr ?? (num(tv?.price_book_fq) != null ? `${num(tv?.price_book_fq)!.toFixed(2)}배` : null), desc: "주가 ÷ 주당순자산" },
                  { k: "PSR", v: ind?.psr ?? null, desc: "시가총액 ÷ 매출" },
                  { k: "EPS", v: money(ind?.eps ?? num(tv?.earnings_per_share_diluted_ttm), cur$), desc: "주당순이익(최근 1년)" },
                  { k: "BPS", v: money(ind?.bps, cur$), desc: "주당순자산" },
                ]} />;
  const profB = <Block title="💰 수익성" sub="회사가 얼마나 잘 버는지" loading={tvQ.isLoading} rows={[
                  { k: "매출액(1년)", v: big(num(tv?.total_revenue_ttm), cur$) },
                  { k: "매출총이익률", v: pctT(num(tv?.gross_margin_ttm), false) },
                  { k: "영업이익률", v: pctT(num(tv?.operating_margin_ttm), false) },
                  { k: "순이익률", v: pctT(num(tv?.net_margin_ttm), false) },
                  { k: "ROE", v: ind?.roe ?? pctT(num(tv?.return_on_equity_fq), false), desc: "자기자본으로 1년에 얼마 버나" },
                  { k: "잉여현금(1년)", v: big(num(tv?.free_cash_flow_ttm), cur$), desc: "영업으로 번 현금 − 설비투자" },
                ]} />;
  const retB = <Block title="🎁 주주환원" sub="주주에게 돌려주는 정도" rows={[
                  { k: "배당수익률", v: ind?.divYield != null ? `${(ind.divYield * 100).toFixed(2)}%` : num(tv?.dividends_yield_current) != null ? `${num(tv?.dividends_yield_current)!.toFixed(2)}%` : null },
                  { k: "연 배당금", v: money(ind?.divAnnual, cur$) },
                  { k: "배당 주기", v: ind?.divFreq ? `${({ QUARTERLY: "분기", MONTHLY: "월", ANNUAL: "연", SEMI_ANNUAL: "반기" } as Record<string, string>)[ind.divFreq] ?? ind.divFreq}${ind.divMonths?.length ? ` (${ind.divMonths.join("·")}월)` : ""}` : null },
                  { k: "최근 배당락", v: ind?.exDate ?? null },
                ]} />;
  const finB = <Block title="🏦 재무건전성" sub="빚이 너무 많지 않은지" rows={[
                  { k: "부채비율", v: st?.debt != null ? `${st.debt.toFixed(1)}%` : null, desc: st?.median != null ? `업종 중간값 ${st.median.toFixed(1)}%` : undefined, cls: st?.position === "LOW" ? "text-rose-600" : st?.position === "HIGH" ? "text-blue-600" : undefined },
                  { k: "유동비율", v: st?.current != null ? `${st.current.toFixed(0)}%` : null, desc: "1년 안에 갚을 빚 대비 현금화 자산 — 100% 위면 넉넉" },
                  { k: "이자보상비율", v: st?.interest != null ? `${st.interest.toFixed(1)}배` : null },
                  { k: "총부채", v: big(num(tv?.total_debt_fq), cur$) },
                ]} />;
  const statB = <Block title="📈 가격 통계" sub="최근 1년 가격 흐름" rows={[
                  { k: "52주 최고", v: money(num(tv?.price_52_week_high), cur$), desc: px && num(tv?.price_52_week_high) ? `지금은 최고가의 ${Math.round((px / num(tv?.price_52_week_high)!) * 100)}%` : undefined },
                  { k: "52주 최저", v: money(num(tv?.price_52_week_low), cur$) },
                  { k: "1달 · 3달", v: num(tv?.["Perf.1M"]) != null ? <><span className={tone(num(tv?.["Perf.1M"]))}>{pctT(num(tv?.["Perf.1M"]))}</span> · <span className={tone(num(tv?.["Perf.3M"]))}>{pctT(num(tv?.["Perf.3M"]))}</span></> : null },
                  { k: "올해 · 1년", v: num(tv?.["Perf.YTD"]) != null ? <><span className={tone(num(tv?.["Perf.YTD"]))}>{pctT(num(tv?.["Perf.YTD"]))}</span> · <span className={tone(num(tv?.["Perf.Y"]))}>{pctT(num(tv?.["Perf.Y"]))}</span></> : null },
                  { k: "베타(1년)", v: num(tv?.beta_1_year)?.toFixed(2) ?? null, desc: "시장이 1% 움직일 때 이 종목이 움직이는 정도" },
                  { k: "유통주식", v: pctT(num(tv?.float_shares_percent_current), false) },
                ]} />;
  const nxtB = <Block title="🗓️ 다음 실적" sub="발표 예정일(한국 날짜)" rows={[
                  { k: "실적 발표", v: num(tv?.earnings_release_next_date) ? new Date(num(tv?.earnings_release_next_date)! * 1000 + 9 * 3600_000).toISOString().slice(0, 10) : null },
                ]} />;
  const tvconB = <Block title="🎯 컨센서스" sub="애널리스트 의견 · TradingView" loading={tvQ.isLoading} rows={[
                    { k: "종합 의견", v: num(tv?.recommendation_mark) != null ? `${recText(num(tv?.recommendation_mark))} (${num(tv?.recommendation_mark)!.toFixed(2)})` : null, desc: "1 강력 매수 ~ 5 강력 매도" },
                    { k: "목표가 평균", v: money(num(tv?.price_target_average), cur$), desc: px && num(tv?.price_target_average) ? `지금 대비 ${pctT((num(tv?.price_target_average)! / px - 1) * 100)}` : undefined },
                    { k: "목표가 최고", v: money(num(tv?.price_target_high), cur$) },
                    { k: "목표가 최저", v: money(num(tv?.price_target_low), cur$) },
                  ]} />;
  const overviewBox = (ov || tv) ? (
              <section className={`p-3 bg-slate-50 border border-slate-200 rounded ${on ? "" : "mb-3"}`}>
                <header className="flex items-baseline gap-2 mb-1.5">
                  <h3 className="text-sm font-bold text-gray-700">🏢 기업개요</h3>
                  <span className="text-[10px] text-gray-400">{ov ? (ov.source?.startsWith("출처") ? ov.source : `출처: ${ov.source ?? "토스"}`) : "출처: TradingView"}</span>
                </header>
                <ul className="space-y-1 text-[13px] text-gray-700 leading-relaxed">
                  <li className="flex gap-1.5"><span className="text-slate-400 shrink-0">·</span><span>{ov?.englishName ?? String(tv?.description ?? "")}{ov?.industry ? ` — ${ov.industry}` : tv?.industry ? ` — ${String(tv.sector)} / ${String(tv.industry)}` : ""}</span></li>
                  {(ov?.listDate || num(tv?.number_of_employees)) ? <li className="flex gap-1.5"><span className="text-slate-400 shrink-0">·</span><span>{ov?.listDate ? `상장 ${ov.listDate}` : ""}{ov?.listDate && num(tv?.number_of_employees) ? " · " : ""}{num(tv?.number_of_employees) ? `직원 ${num(tv?.number_of_employees)!.toLocaleString()}명` : ""}</span></li> : null}
                  {ov?.tics.length ? <li className="flex gap-1.5 flex-wrap"><span className="text-slate-400 shrink-0">·</span>{ov.tics.map(t => <span key={t} className="px-1.5 py-0.5 rounded-full bg-white border border-slate-200 text-[11px] text-slate-600">{t}</span>)}</li> : null}
                </ul>
                {segQ.data?.items.some(x => x.ratio >= 0.05) ? (
                  <div className="mt-2">
                    <div className="text-[12px] font-bold text-gray-600 mb-1">사업부별 매출 비중 <span className="font-normal text-gray-400">({segQ.data.endDate} 회계연도)</span></div>
                    <div className="space-y-0.5">
                      {segQ.data.items.filter(x => x.ratio >= 0.05).map(x => (
                        <div key={x.name} className="flex items-center gap-2 text-[11.5px]">
                          <span className="w-[45%] sm:w-[200px] truncate text-gray-700" title={x.name}>{x.name}</span>
                          <div className="flex-1 h-2 rounded bg-white overflow-hidden"><div className="h-full bg-indigo-300" style={{ width: `${Math.min(100, x.ratio)}%` }} /></div>
                          <span className="w-12 text-right tabular-nums text-gray-600">{x.ratio.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white sm:rounded-lg shadow-xl w-full h-full sm:w-[98vw] sm:h-[96vh] flex flex-col overflow-hidden">
        {/* 📊 종목정보 줄 — 국내 창과 같은 머리 */}
        <div className="pg-menu flex items-center gap-2 px-3 py-1.5 border-b bg-white shrink-0 min-w-0">
          <span className="font-bold text-gray-900 shrink-0">📊 종목정보</span>
          {tv?.logoid ? <img src={heatmapLogoUrl(String(tv.logoid))} alt="" className="w-4 h-4 rounded-full bg-white shrink-0" /> : null}
          <span className="font-bold text-gray-800 truncate">{name}</span>
          <span className="text-[12px] text-gray-400 shrink-0">{sym}{ov?.market ? ` · ${ov.market}` : jp ? " · 도쿄" : ""}</span>
          <button onClick={onClose} title="닫기 (Esc)" className="ml-auto p-1 rounded text-gray-500 hover:bg-gray-100 text-lg leading-none">✕</button>
        </div>
        <header className="px-5 py-2 border-b bg-gray-50">
          <div className="hidden sm:flex items-baseline gap-3">{links}<span className="ml-3">{priceHead}</span></div>
          <div className="sm:hidden flex items-baseline gap-2 flex-wrap">{links}<span className="ml-auto">{priceHead}</span></div>
          <div className="text-xs text-gray-400 mt-1">출처: {on ? "토스(지표·컨센서스·실적·뉴스·공시) · " : ""}TradingView · 야후(봉){nv ? " · 네이버(토론)" : ""}</div>
        </header>
        <div className="pg-menu px-5 py-1.5 border-b bg-white flex items-center gap-1 overflow-x-auto shrink-0">
          {secs.map(k => (
            <button key={k} onClick={() => go(k)} className={`px-2.5 py-0.5 text-[12px] font-bold rounded-full whitespace-nowrap transition ${cur === k ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{SEC_LABEL[k]}</button>
          ))}
        </div>
        <div ref={scrollRef} onScroll={onScroll} className="pg-bg px-5 py-4 overflow-y-auto relative">
          {on && (
            <section data-sec="live" className="mb-6 space-y-4">
              {/* ⚡ 실시간 — 국내처럼 체결 + 새 소식 + 대화를 한자리에 */}
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] items-start">   {/* 그래프 | 기업개요 | 컨센서스 한 줄(사용자 2026-11-28 "2개를 가로로, 차트 옆에 3개가 한줄로") */}
                <div className="min-w-0 lg:col-span-2 xl:col-span-1"><UsStockLive ticker={sym} toss={toss} name={name} desc={ov?.industry} /></div>
                <div className="min-w-0 xl:mt-[30px] space-y-3">{overviewBox}{nxtB}</div>   {/* 기업개요 아래 다음 실적 */}
                <div className="min-w-0 xl:mt-[30px] space-y-3">{conQ.data ? <ConsensusBlock c={conQ.data} px={px} /> : tvconB}{retB}</div>   {/* 컨센서스 아래 주주환원 */}
              </div>
              {/* 뉴스 · 공시 · 토스 · 네이버 — 국내 실시간 칸과 같은 한 줄 4칸(사용자 2026-11-28 "국장은 4개가 한줄이야") */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5 auto-rows-[400px]">
                <FeedShell title="📰 뉴스" sub="토스 · 한국어 번역">
                  {newsQ.data?.length ? newsQ.data.map(n => (
                    <button key={n.id} type="button" onClick={() => void fetchTossNewsLink(n.id).then(u => openExternal(u ?? `https://www.tossinvest.com/stocks/${toss}/news`))} className="block w-full text-left px-2.5 py-1.5 border-b border-gray-100 hover:bg-gray-50">
                      <div className="text-[12px] text-gray-800 leading-snug line-clamp-2">{n.title}</div>
                      <div className="text-[10.5px] text-gray-400">{n.source} · {n.at.slice(5, 16).replace("T", " ")}</div>
                    </button>
                  )) : <div className="p-3 text-xs text-gray-400">{newsQ.isLoading || !cc ? "불러오는 중…" : "뉴스 없음"}</div>}
                </FeedShell>
                <FeedShell title="📋 공시" sub="SEC · 실적 발표 한국어 요약">
                  {filQ.data?.length ? filQ.data.map(f => (
                    <button key={f.id} type="button" title={f.summary} onClick={() => openExternal(`https://www.tossinvest.com/stocks/${toss}/news?menu=disclosure`)} className="block w-full text-left px-2.5 py-1.5 border-b border-gray-100 hover:bg-gray-50">
                      <div className="text-[12px] text-gray-800 leading-snug"><span className="mr-1 px-1 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-700">{f.form}</span>{f.title}<span className="ml-1 text-[10.5px] text-gray-400">{f.date.slice(5)}</span></div>
                      {f.summary && <div className="text-[10.5px] text-gray-500 line-clamp-2">{f.summary}</div>}
                    </button>
                  )) : <div className="p-3 text-xs text-gray-400">{filQ.isLoading || !cc ? "불러오는 중…" : "공시 없음"}</div>}
                </FeedShell>
                <TossPane ticker={toss} refreshTs={0} />
                {nv ? <NaverPane ticker={nv} refreshTs={0} /> : <div />}
              </div>
            </section>
          )}

          <section data-sec="summary" className="pt-1 mb-6">
            <h2 className="text-[13px] font-bold text-gray-500 mb-2 border-b pb-1">요약</h2>
            {/* 🏢 기업개요 — 미국은 위 실시간 그래프 오른쪽으로 올렸다(사용자 2026-11-28 "그래프 오른쪽에 넣어도"), 일본은 여기 */}
            {!on && overviewBox}
            {/* 3 컬럼 — 국내 창과 같은 묶음(가치평가·수익성 | 주주환원·재무건전성·가격 통계 | 컨센서스) */}
            {/* 한 줄 4칸 — 미국은 주주환원·다음 실적·컨센서스가 위 실시간 줄로 올라가 가치평가 | 수익성 | 재무건전성 | 가격 통계 (사용자 2026-11-28) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
              {on ? <>{valB}{profB}{finB}{statB}</> : <>
                <div className="space-y-3">{valB}</div>
                <div className="space-y-3">{profB}{retB}</div>
                <div className="space-y-3">{finB}{statB}</div>
                <div className="space-y-3">{tvconB}{nxtB}</div>
              </>}
            </div>
          </section>

          <section data-sec="fin" className="pt-1 mb-6">
            <h2 className="text-[13px] font-bold text-gray-500 mb-2 border-b pb-1">실적·재무</h2>
            {on ? <ConsensusCharts revenue={revQ.data ?? undefined} operatingIncome={opQ.data ?? undefined} eps={epsQ.data ?? undefined} />
              : <div className="text-xs text-gray-400 py-6 text-center">일본 종목은 분기 실적·추정 자료가 없습니다(토스 미지원) — 위 요약의 1년 매출·이익률만.</div>}
          </section>

          <section data-sec="chart" className="pt-1 mb-6">
            <h2 className="text-[13px] font-bold text-gray-500 mb-2 border-b pb-1">차트</h2>
            {/* 년·월·주봉 — 국내 창과 같은 '기간별 추이'(야후) */}
            <PriceMultiSparks ticker={sym} />
            {shown.length ? (
              <Suspense fallback={<div className="h-[360px] text-xs text-gray-400">차트 불러오는 중…</div>}>
                <div className="text-[11px] font-bold text-gray-600 mb-1">일봉 <span className="font-normal text-gray-400">최근 1년 · 이평 5·20·60·120 · 야후</span></div>
                <CandleChartLight prices={shown} maPrices={prices} investors={NO_INVESTORS} mode="candle" maPeriods={MA} ticker={sym} currency={jp ? "JPY" : "USD"} />
              </Suspense>
            ) : <div className="text-xs text-gray-400">{pxQ.isLoading ? "일봉 받는 중…" : "일봉 없음(야후)"}</div>}
          </section>

          {!on && (
            <section data-sec="news" className="pt-1 mb-6">
              <h2 className="text-[13px] font-bold text-gray-500 mb-2 border-b pb-1">소식·대화</h2>
              {talk ?? <div className="text-xs text-gray-400">대화 자료 없음</div>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** 🎯 컨센서스 — 투자의견 분포 막대 + 목표가(평균·중간·최고·최저) · 토스 */
function ConsensusBlock({ c, px }: { c: TossConsensus; px: number | null }) {
  const o = c.opinion, t = c.target;
  const parts = o ? ([["강력 매수", o.strongBuy, "bg-rose-500"], ["매수", o.buy, "bg-rose-300"], ["중립", o.hold, "bg-gray-300"], ["매도", o.sell, "bg-blue-300"], ["강력 매도", o.strongSell, "bg-blue-500"]] as const) : [];
  const tot = parts.reduce((a, p) => a + p[1], 0) || 1;
  const now = px ?? c.past[c.past.length - 1]?.price ?? null;
  const usd = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const rows: [string, number | undefined][] = t ? [["목표가 평균", t.mean], ["중간값", t.median], ["최고", t.high], ["최저", t.low]] : [];
  return (
    <section className="bg-gray-50 rounded p-3 border border-gray-200">
      <header className="mb-2">
        <h3 className="font-bold text-gray-700">🎯 컨센서스</h3>
        <p className="text-xs text-gray-400">애널리스트 의견·목표가 · 토스 {t?.date ?? o?.date ?? ""}</p>
      </header>
      {o && (
        <div className="mb-2">
          <div className="flex h-3 rounded overflow-hidden">{parts.map(([k, n, cls]) => n ? <div key={k} className={cls} style={{ width: `${(n / tot) * 100}%` }} title={`${k} ${n}명`} /> : null)}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11.5px] text-gray-600">{parts.map(([k, n]) => <span key={k}>{k} <b>{n}</b></span>)}<span className="text-gray-400">· {o.count}명</span></div>
        </div>
      )}
      {rows.map(([k, v]) => v != null && (
        <div key={k} className="py-1.5 border-b border-gray-100 last:border-b-0 flex justify-between items-baseline">
          <span className="text-sm text-gray-700">{k}</span>
          <span className="text-sm font-bold tabular-nums">{usd(v)}{k === "목표가 평균" && now ? <span className={`ml-1 text-[11px] ${tone(v - now)}`}>{pctT((v / now - 1) * 100)}</span> : null}</span>
        </div>
      ))}
      {c.past.length > 1 && <p className="mt-1.5 text-[10.5px] text-gray-500">월말 종가: {c.past.slice(-6).map(p => `${+p.date.slice(5, 7)}월 $${Math.round(p.price).toLocaleString()}`).join(" · ")}</p>}
    </section>
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
