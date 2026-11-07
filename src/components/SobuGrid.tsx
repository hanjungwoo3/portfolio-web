// 지수(소부장) — 단계별 4칸(기판 / 전공정 / 후공정 / 소재·부품)을 **한 화면에**(사용자 2026-11-02 "한 줄씩 하지 말고 화면을 4등분").
//   칸마다 해외 대장주(테두리 굵게, 미국은 간밤·일본은 지금 장중) ➜ 국내 종목. 카드는 최신공시·히트맵과 같은 QuoteCard(24시간·3개월 설정 따름).
//   칸 제목 옆 = 국내 종목 평균 등락률(동일가중) — 오늘 어느 단계가 강한지. PC 2×2, 모바일 세로로 한 칸씩.
//   + 카드 왼쪽 아래 공시·뉴스 개수 — 누르면 떠 있는 창(칸 아래 목록은 뺐다, 사용자 2026-11-02). 공시 = 최근 5거래일 DART(최신공시와 같은 서버 파일) · 칸별 외국인·기관(금융투자 제외) 5·20일 순매수
//     (크롤러 investor-flows.json — 수급 매집 탭과 같은 파일, 추가 호출 0). 사용자 2026-11-02 "1, 2번 진행".
import { AftPill } from "./SectorTabBar";
import { isOverseasTicker } from "../lib/avgMarket";
import { useEffect, useRef, useState } from "react";
import { useRecentDisc } from "../lib/recentDisclosures";
import { useQueries, useQuery } from "@tanstack/react-query";
import { US_PAIRS } from "../lib/usMarketData";
import { fetchDartBody, parseContract, type DartRow } from "../lib/dartDisclosures";
import { DISC_CAT_TONE } from "../lib/disclosureFilter";
import { openStockInfo } from "../lib/tickPopup";
import { fetchNaverNews } from "../lib/api";
import { loadInvestorFlows, type FlowStock } from "../lib/investorFlows";
import { openExternal } from "../lib/toss";
import { QuoteCard } from "./QuoteCard";

const NAME = new Map(US_PAIRS.map(p => [p.symbol, p.name]));

const eok = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(1)}억`;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");

export function SobuGrid({ rows, labels, leadByRow, quote, dimOf, etfs, renderCard, hotOf, headersOnly }: {
  rows: string[][]; labels: string[]; leadByRow: number[];
  etfs?: string[];   // 업종 ETF — 칸들 위 한 줄
  quote: (sym: string) => { price: number; pct: number; reg?: { price: number; pct: number } } | undefined;
  // 지수 탭 종목 카드 그대로(사용자 2026-11-03 "지수에 있는 종목 카드와 동일하게, 똑같은 기능으로") — 주면 QuoteCard 대신 이걸 그린다
  renderCard?: (sym: string) => import("react").ReactNode;
  hotOf?: (sym: string) => number;   // 거래대금 급증 배수(한국투자 레이더) — 0 이 아니면 칸 맨 앞으로
  headersOnly?: boolean;   // 칸 제목(국내·해외 평균)만 — 5일/20일 수급 줄도 뺀다 — 지수(업종) 한눈에(사용자 2026-11-07 "한눈에 이거 다 넣으면")
  dimOf?: (sym: string) => boolean;   // 장 마감 흐림 — 지수 탭 카드와 같은 판정(dashboardCardDim, 설정 따름)
}) {
  // 다섯 단계 → 네 칸: 소재·부품을 한 칸으로
  const boxes: { label: string; lead: string[]; kr: string[] }[] = [];
  rows.forEach((r, i) => {
    const n = leadByRow[i] ?? 1;
    const lead = r.slice(0, n), kr = r.slice(n);
    if (i >= 4 && boxes[3]) { boxes[3].label = `${boxes[3].label}·${labels[i]}`; boxes[3].lead.push(...lead); boxes[3].kr.push(...kr); }
    else boxes.push({ label: labels[i], lead: [...lead], kr: [...kr] });
  });
  const krCodes = new Set(rows.flat().filter(s => /\.KS$/.test(s)).map(s => s.slice(0, 6)));
  // 공시 = 전 종목 공통 자료(lib/recentDisclosures — 지수·내 종목 카드와 같은 한 번 받기)
  const discMap = useRecentDisc();
  const disc = { data: [...krCodes].flatMap(c => discMap.get(c) ?? []).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)), isLoading: false };
  const contractRows = (disc.data ?? []).filter(r => r.cat === "계약");
  // 계약 공시 본문 → 금액·매출액 대비·상대(오늘·어제치는 서버 파일, 그 전은 직접 — 웹에선 프록시가 막으면 빈칸)
  const bodyQs = useQueries({
    queries: contractRows.map(r => ({
      queryKey: ["dart-contract", r.rcpNo], queryFn: async () => parseContract(await fetchDartBody(r.date, r.rcpNo)),
      staleTime: 24 * 3600_000, retry: 0,
    })),
  });
  const info = new Map(contractRows.map((r, i) => [r.rcpNo, bodyQs[i]?.data ?? null]));
  // 뉴스 — 종목마다 1콜(네이버, 10분마다). 칸마다 그 단계 종목 기사(사용자 2026-11-02 "각각 안에서 공시/뉴스도")
  const krList = [...krCodes];
  const newsQs = useQueries({
    queries: krList.map(c => ({
      queryKey: ["sobu-news", c], queryFn: () => fetchNaverNews(c, 6),
      staleTime: 5 * 60_000, refetchInterval: 10 * 60_000, retry: 0,
    })),
  });
  const news = (() => {
    const seen = new Set<string>(), out: { code: string; id: string; title: string; press: string; dt: string; url: string }[] = [];
    newsQs.forEach((q, i) => (q.data ?? []).forEach(n => { if (seen.has(n.id)) return; seen.add(n.id); out.push({ code: krList[i], id: n.id, title: n.title, press: n.press, dt: n.datetime, url: n.url }); }));
    return out.sort((a, b) => b.dt.localeCompare(a.dt));
  })();
  const flows = useQuery({ queryKey: ["investor-flows"], queryFn: loadInvestorFlows, staleTime: 3 * 3600_000, retry: 1 });
  const flowBy = new Map<string, FlowStock>((flows.data?.stocks ?? []).map(x => [x.code, x]));
  const lastContract = new Map<string, DartRow>();
  for (const r of contractRows) if (r.code && !lastContract.has(r.code)) lastContract.set(r.code, r);
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const card = (sym: string, lead: boolean) => {
    const kr = /\.KS$/.test(sym);
    const code = kr ? sym.slice(0, 6) : sym;
    const q = quote(sym);
    const ct = kr ? lastContract.get(code) : undefined;
    // 카드 왼쪽 아래 — 공시(5거래일)·뉴스(최근 2일) 개수(사용자 2026-11-02). 없으면 안 붙인다
    const since = new Date(Date.now() + 9 * 3600_000 - 2 * 86400_000).toISOString().replace(/\D/g, "").slice(0, 12);
    const nN = kr ? news.filter(n => n.code === code && n.dt >= since).length : 0;
    // 누르면 그 종목 공시·뉴스를 카드 옆 떠 있는 창으로(사용자 2026-11-02 "클릭하면 레이어로, 마우스 hover 는 빼고")
    const openPeek = (e: import("react").MouseEvent) => {
      // 카드 아래 꼬리표 줄(VI·실적·고배당·📊·AI)로 들어왔으면 공시·뉴스 창을 띄우지 않는다 — 꼬리표 자기 설명이 먼저(사용자 2026-11-04)
      if ((e.target as Element | null)?.closest?.("[data-no-peek]")) return;
      e.stopPropagation(); keepPeek();
      const el = (e.currentTarget as HTMLElement).closest("[data-sobu-card]") as HTMLElement | null;
      const r = (el ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
      const left = r.right + 340 > window.innerWidth;   // 오른쪽 자리가 없으면 카드 왼쪽에
      const next = { code, name: NAME.get(sym) ?? code, x: left ? r.left - 8 : r.right + 8, y: r.top, left };
      setPeek(p => (e.type === "click" && p?.code === code ? null : next));
    };
    // 카드 왼쪽 아래 공시 종류 꼬리표는 QuoteCard 가 직접 붙인다(DiscTags — 지수·내 종목 카드와 같은 부품)
    return (
      <div key={sym} className={`relative rounded-lg transition ${peek?.code === code ? "ring-4 ring-amber-400 shadow-lg z-20" : lead ? "ring-2 ring-indigo-400" : ""}`}
           data-sobu-card>   {/* 카드 전체 hover 는 뺐다 — 아래 📰 버튼에만(사용자 2026-11-07 "카드에 올리면 나오는 레이어 없애고, 뉴스도 버튼으로, hover 는 버튼에만") */}
        {renderCard ? renderCard(sym)
          : <QuoteCard code={code} name={NAME.get(sym) ?? sym} px={q && q.price > 0 ? q : undefined} reg={q?.reg} dim={dimOf?.(sym)} className="w-full h-[84px]" />}
        {kr && nN > 0 && (   /* 뉴스만 — 공시는 카드 아래 공시 꼬리표 버튼이 따로 있다(사용자 2026-11-07) */
          // 공시·뉴스 창 버튼 — 카드 안 오른쪽 위(위 가장자리는 가격 책갈피·수주 꼬리표, 아래는 공시 종류 꼬리표라 겹쳤다, 사용자 2026-11-07). 숫자 = 뉴스+공시. 올리거나 누르면 창
          <button type="button" onMouseEnter={openPeek} onMouseLeave={dropPeek} onClick={openPeek}
                  className={`absolute top-[14px] right-1 z-30 px-1 rounded border text-[9.5px] font-bold leading-tight ${peek?.code === code ? "border-amber-400 bg-amber-100 text-amber-800" : "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"}`}>
            뉴스 {nN}
          </button>
        )}
        {ct && (
          <button onClick={() => openExternal(ct.url)} title={`${ct.date} ${ct.time} ${ct.title}${info.get(ct.rcpNo)?.amountEok ? ` — ${Math.round(info.get(ct.rcpNo)!.amountEok!).toLocaleString()}억` : ""} — 눌러서 DART 원문`}
                  className={`absolute -top-1.5 ${renderCard ? "left-1 z-30" : "right-1 z-10"} px-1 rounded border border-violet-300 bg-violet-50 text-violet-700 text-[9px] font-bold leading-tight hover:bg-violet-100`}>   {/* 지수 카드는 오른쪽 위에 정규장 종가 책갈피가 있어 왼쪽으로 */}
            📑수주 {md(ct.date)}
          </button>
        )}
      </div>
    );
  };
  // 카드의 공시·뉴스 개수를 누르면 그 종목 공시·뉴스를 떠 있는 창으로. ✕·바깥 누르기·Esc 로 닫는다
  const [peek, setPeek] = useState<{ code: string; name: string; x: number; y: number; left: boolean } | null>(null);
  // 마우스를 올리면 뜨고(사용자 2026-11-03), 꼬리표·창에서 벗어나면 잠깐 뒤 닫는다(창으로 옮겨 가 링크를 누를 수 있게)
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepPeek = () => { if (closeT.current) { clearTimeout(closeT.current); closeT.current = null; } };
  const dropPeek = () => { keepPeek(); closeT.current = setTimeout(() => setPeek(null), 250); };
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPeek(null); };
    const onScroll = (e: Event) => { if (e.target === document || e.target === document.documentElement) setPeek(null); };   // 페이지 스크롤만(창 안 스크롤은 그대로)
    // 바깥을 누르면 닫기(창·꼬리표 안은 제외)
    const onDown = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.("[data-sobu-peek]")) setPeek(null); };
    window.addEventListener("keydown", onKey); window.addEventListener("scroll", onScroll, true); window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("mousedown", onDown); };
  }, [peek]);
  const ndt = (dt: string) => `${+dt.slice(4, 6)}/${+dt.slice(6, 8)} ${dt.slice(8, 10)}:${dt.slice(10, 12)}`;
  // 카드 폭 = 지수 탭 카드와 같게(사용자 2026-11-03 "지수(업종) 카드 넓이가 더 넓은데") — 지수 탭 카드 = (그룹 폭 − 56)/8,
  //   업종 페이지는 왼쪽 세로 탭(116+8)만큼 좁아 +124. 칸이 4개면 칸 테두리·여백 때문에 다 못 들어가 그만큼만 줄인다(지수 탭 짝 줄과 같은 규칙).
  //   넓은 화면(xl)에서만 — 그보다 좁으면 예전처럼 칸을 화면에 나눠 채운다.
  const nb = boxes.length;
  // 칸마다 열 수 — 한 줄 8장(지수 탭과 같은 눈금)을 칸에 나눈다. 기본 2열, 남는 열은 종목이 많은 칸부터(사용자 2026-11-03 "이런 경우 브랜드를 4개씩").
  //   종목 수보다 많은 열은 주지 않는다.
  const TOTAL = Math.max(8, nb * 2);
  const nOf = (b: (typeof boxes)[number]) => b.lead.length + b.kr.length;
  const cols = boxes.map(b => Math.min(2, Math.max(1, nOf(b))));
  for (let left = TOTAL - cols.reduce((a, c) => a + c, 0); left > 0; left--) {
    // 열 하나 늘렸을 때 줄 수가 가장 많이 주는(= 지금 줄 수가 가장 많은) 칸에
    let best = -1, bestRows = 1;
    boxes.forEach((b, i) => { const r = Math.ceil(nOf(b) / cols[i]); if (cols[i] < nOf(b) && r > bestRows) { best = i; bestRows = r; } });
    if (best < 0) break;
    cols[best]++;
  }
  const T = cols.reduce((a, c) => a + c, 0);
  // 칸 테두리 2 + 안쪽 여백 16, 칸 안 카드 사이 8, 칸 사이 8 — 이만큼 빼고 T 장으로 나눈다(지수 탭 카드 폭을 넘지는 않게)
  const chrome = nb * 18 + (T - nb) * 8 + (nb - 1) * 8;
  const cw = renderCard ? `min(calc((100cqw + 68px) / 8), calc((100cqw - ${chrome}px) / ${T}))` : undefined;
  return (
    <div className="space-y-2 [container-type:inline-size]" style={cw ? ({ "--cw": cw } as import("react").CSSProperties) : undefined}>
    {!headersOnly && etfs && etfs.length > 0 && renderCard && (
      // ETF 줄도 아래 칸의 카드 세로줄에 맞춘다(사용자 2026-11-03 "ETF도 같이 줄을 맞춰야지") — 두 장씩 칸 폭(테두리 1 + 여백 8)만큼 안쪽으로
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-4 pt-1.5 xl:flex xl:flex-wrap">
        {/* 칸마다 그 칸 열 수만큼 — 아래 칸의 카드 세로줄과 맞는다 */}
        {(() => { const g: string[][] = []; let at = 0; for (const c of cols) { if (at >= etfs.length) break; g.push(etfs.slice(at, at + c)); at += c; } if (at < etfs.length) g.push(etfs.slice(at)); return g; })().map((pair, i) => (
          <div key={i} className="contents xl:flex xl:gap-2 xl:px-[9px]">
            {pair.map(sym => <div key={sym} className="relative xl:w-[var(--cw)]">{renderCard(sym)}</div>)}
          </div>
        ))}
      </div>
    )}
    {!headersOnly && etfs && etfs.length > 0 && !renderCard && (
      // ETF 카드 크기를 아래 종목 카드와 같게(사용자 2026-11-03 "ETF 카드만 크기가 달라") — 칸 수×2 열 격자, 칸 안쪽 여백만큼 양옆을 띄운다
      <div className={`grid grid-cols-2 sm:grid-cols-4 ${boxes.length === 3 ? "xl:grid-cols-6" : "xl:grid-cols-8"} gap-x-3.5 gap-y-1.5 px-2`}>
        {etfs.map(sym => { const q = quote(sym); return (
          <div key={sym} className="relative rounded-lg ring-1 ring-violet-300">
            <span className="absolute -top-1.5 left-1 z-10 px-1 rounded bg-violet-600 text-white text-[9px] font-bold leading-tight">ETF</span>
            <QuoteCard code={sym.slice(0, 6)} name={NAME.get(sym) ?? sym} px={q && q.price > 0 ? q : undefined} reg={q?.reg} dim={dimOf?.(sym)} className="w-full h-[84px]" />
          </div>
        ); })}
      </div>
    )}
    <div className={renderCard ? "grid grid-cols-1 md:grid-cols-2 xl:flex xl:items-start gap-2" : `grid grid-cols-1 md:grid-cols-2 ${boxes.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"} gap-2`}>   {/* 칸 수만큼 화면을 나눈다(3단계 업종은 3등분) */}
      {boxes.map((b, bi) => {
        // 평균·▲▼ 은 흐린 종목(장 안 열림·체결 없음 — 값이 지난 정규장) 빼고(사용자 2026-11-03). 다 흐리면(장 마감 뒤) 전부로
        // 해외 평균 — 이 칸의 해외 대장주(미국·일본)(사용자 2026-11-05 "국내·해외 평균 둘 다")
        //   미국이 장 밖이면 정규장 등락(reg)으로 평균, 꼬리표 = 프리·애프터(정규장 종가 대비) — 국내와 같은 꼴(사용자 2026-11-05)
        const ovQ = b.lead.filter(isOverseasTicker).map(s => quote(s));
        const ovPs = ovQ.map(q => q?.reg?.pct ?? q?.pct).filter((v): v is number => v != null && Number.isFinite(v));
        const ovAvg = ovPs.length ? ovPs.reduce((a, v) => a + v, 0) / ovPs.length : null;
        const ovEx = ovQ.flatMap(q => q?.reg && q.reg.price > 0 && q.price > 0 ? [(q.price / q.reg.price - 1) * 100] : []).filter(v => Math.abs(v) >= 0.005);   // 0 = 값 없음
        const ovAft = ovEx.length ? ovEx.reduce((a, v) => a + v, 0) / ovEx.length : null;
        const live = b.kr.filter(s => !dimOf?.(s));
        const ps = (live.length ? live : b.kr).map(s => quote(s)?.pct).filter((v): v is number => v != null && Number.isFinite(v));
        const avg = ps.length ? ps.reduce((a, v) => a + v, 0) / ps.length : null;
        const up = ps.filter(v => v > 0).length;
        // 정규장 마감 뒤(NXT 애프터) 평균 — 정규장 종가 대비 지금 값(카드 오른쪽 위 빨강·파랑 꼬리표의 평균, 사용자 2026-11-05)
        const as = b.kr.map(s => { const q = quote(s); return q?.reg && q.reg.price > 0 && q.price > 0 ? (q.price / q.reg.price - 1) * 100 : null; }).filter((v): v is number => v != null && Number.isFinite(v) && Math.abs(v) >= 0.005);
        const aft = as.length ? as.reduce((a, v) => a + v, 0) / as.length : null;
        // 마감 뒤엔 평균을 정규장 등락률로(애프터는 옆 꼬리표) — "정규장%(애프터%)"(사용자 2026-11-05)
        const rps = b.kr.map(s => quote(s)?.reg?.pct).filter((v): v is number => v != null && Number.isFinite(v));
        const avgShown = aft != null && rps.length ? rps.reduce((a, v) => a + v, 0) / rps.length : avg;
        const upShown = aft != null && rps.length ? rps.filter(v => v > 0).length : up;
        const nShown = aft != null && rps.length ? rps.length : ps.length;
        // 칸 수급 — 국내 종목 외국인·기관(금융투자 제외) 누적 순매수 합(억원). 크롤러 기준일(전 거래일)까지
        const fsum = (w: "5" | "20", k: "fo" | "in") => b.kr.reduce((a, s) => a + (flowBy.get(s.slice(0, 6))?.w[w]?.[k] ?? 0), 0);
        const hasFlow = b.kr.some(s => flowBy.has(s.slice(0, 6)));
        return (
          <div key={b.label} className={`rounded-lg border border-gray-200 bg-gray-50/50 pg-row p-2 ${renderCard ? "xl:shrink-0 min-w-0" : ""}`}>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-bold text-gray-800 shrink-0">{b.label}</span>
              {/* 국내 · 해외 두 줄, 같은 위치에 같은 꼴(사용자 2026-11-05 "해외 한 줄 내려 국내와 동일한 위치로") */}
              <div className="flex flex-col gap-0.5 min-w-0">
                {avgShown != null && (
                  <div className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className={`text-sm font-bold tabular-nums ${avgShown > 0 ? "text-rose-600" : avgShown < 0 ? "text-blue-600" : "text-gray-600"}`}
                          title={live.length && live.length < b.kr.length ? `국내 종목 평균 등락률(동일가중) — 흐린 ${b.kr.length - live.length}종목 제외` : "국내 종목 평균 등락률(동일가중)"}>
                      국내 {avgShown > 0 ? "+" : ""}{avgShown.toFixed(2)}%{aft != null && <AftPill v={aft} n={as.length} />}
                    </span>
                    {nShown > 0 && <span className="text-[11px] text-gray-500">▲{upShown} · ▼{nShown - upShown}</span>}
                  </div>
                )}
                {ovAvg != null && (
                  <div className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className={`text-sm font-bold tabular-nums ${ovAvg > 0 ? "text-rose-600" : ovAvg < 0 ? "text-blue-600" : "text-gray-600"}`}
                          title={`해외 대장주(테두리 카드, 미국은 장 밖이면 정규장 등락 + 꼬리표 = 프리·애프터, 일본은 지금 장중) ${ovPs.length}종목 평균`}>
                      해외 {ovAvg > 0 ? "+" : ""}{ovAvg.toFixed(2)}%{ovAft != null && <AftPill v={ovAft} n={ovEx.length} />}
                    </span>
                    {ovPs.length > 0 && <span className="text-[11px] text-gray-500">▲{ovPs.filter(v => v > 0).length} · ▼{ovPs.filter(v => v < 0).length}</span>}
                  </div>
                )}
              </div>
            </div>
            {hasFlow && !headersOnly && (   /* 한눈에(제목만)에선 수급 줄 뺌(사용자 2026-11-07 "여긴 제외") */
              <div className="flex flex-col text-[11px] tabular-nums leading-4 -mt-1 mb-1.5"   /* 5일·20일 늘 두 줄 — 숫자 길이에 따라 칸마다 줄 수가 달라 높이가 어긋났다(사용자 2026-11-02) */
                   title={`국내 종목 누적 순매수 합 — 기관은 금융투자 제외(ETF·차익거래가 섞여 방향이 흐려진다). ${flows.data?.meta.asOf ?? ""} 기준`}>
                {(["5", "20"] as const).map(w => (
                  <span key={w} className="whitespace-nowrap truncate"><span className="text-gray-400 inline-block w-7">{w}일</span>
                    외국인 <b className={tone(fsum(w, "fo"))}>{eok(fsum(w, "fo"))}</b>{" · "}
                    기관 <b className={tone(fsum(w, "in"))}>{eok(fsum(w, "in"))}</b>
                  </span>
                ))}
              </div>
            )}
            {!headersOnly && <div className={`grid grid-cols-2 ${renderCard ? "gap-x-2 gap-y-4 pt-1.5 xl:[grid-template-columns:repeat(var(--cols),var(--cw))]" : "gap-1.5"}`} style={renderCard ? ({ "--cols": cols[bi] } as import("react").CSSProperties) : undefined}>   {/* 지수 카드는 아래 책갈피가 걸쳐 줄 간격을 지수 탭과 같게 */}
              {b.lead.map(s => card(s, true))}
              {/* 국내 종목은 오늘 등락률 높은 순(사용자 2026-11-02) — 값 없는 종목은 뒤로. 해외 대장주는 앞에 고정 */}
              {/* 흐린 종목(장 안 열림·체결 없음)은 아래로(사용자 2026-11-03), 그 안에서 등락률 순 */}
              {[...b.kr].sort((x, y) => ((hotOf?.(y) ?? 0) - (hotOf?.(x) ?? 0)) || (Number(!!dimOf?.(x)) - Number(!!dimOf?.(y))) || (quote(y)?.pct ?? -Infinity) - (quote(x)?.pct ?? -Infinity)).map(s => card(s, false))}   {/* 거래대금 급증 종목은 맨 앞(사용자 2026-11-03) */}
            </div>}
          </div>
        );
      })}
    </div>
    {peek && (() => {
      const ds: typeof disc.data & object = [];   // 창은 뉴스만(공시는 카드 아래 꼬리표 버튼) — 사용자 2026-11-07
      // 버튼 숫자와 같은 기준 — 공시 5거래일 + 뉴스 최근 2일(사용자 2026-11-07 "숫자 3 이면 내용도 3개만")
      const since2d = new Date(Date.now() + 9 * 3600_000 - 2 * 86400_000).toISOString().replace(/\D/g, "").slice(0, 12);
      const ns = news.filter(n => n.code === peek.code && n.dt >= since2d).slice(0, 10);
      if (!ds.length && !ns.length) return null;   // 공시·뉴스 둘 다 없으면 창을 띄우지 않는다(사용자 2026-11-02 "없는 건 표시하지 말자")
      const top = Math.max(8, Math.min(peek.y, window.innerHeight - 380));
      return (
        <>
        <div data-sobu-peek className="fixed z-[60] w-[330px] max-h-[370px] overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-xl p-2 text-[11px] pg-card"
             style={{ top, ...(peek.left ? { right: window.innerWidth - peek.x } : { left: peek.x }) }}
             onMouseEnter={keepPeek} onMouseLeave={dropPeek}>
          <div className="flex items-center mb-1">
            <button onClick={() => openStockInfo(peek.code, peek.name)} className="font-bold text-[12px] text-gray-800 hover:underline" title="종목정보 창">{peek.name}</button>
            <button onClick={() => setPeek(null)} className="ml-auto px-1 text-gray-400 hover:text-gray-700" title="닫기 (Esc)">✕</button>
          </div>
          {ds.length > 0 && <div className="font-bold text-violet-800">📑 공시 <span className="font-normal text-gray-400">5거래일 {ds.length}건</span></div>}
          {ds.map(r => {
            const c = r.cat === "계약" ? info.get(r.rcpNo) : null;
            return (
              <button key={r.rcpNo} onClick={() => openExternal(r.url)} title={r.title} className="flex items-baseline gap-1 w-full text-left leading-[18px] hover:bg-violet-50 rounded min-w-0">
                <span className="text-gray-400 tabular-nums shrink-0">{md(r.date)} {r.time}</span>
                <span className={`shrink-0 px-0.5 rounded text-[9.5px] font-bold ${DISC_CAT_TONE[r.cat].tag}`}>{r.cat}</span>
                <span className="truncate text-gray-700">
                  {c?.amountEok != null ? <b className="text-violet-800">{Math.round(c.amountEok).toLocaleString()}억{c.ratio != null ? `(${c.ratio}%)` : ""} </b> : null}
                  {c?.name ?? r.title.replace(/\s+/g, " ")}
                </span>
              </button>
            );
          })}
          {ns.length > 0 && <div className="font-bold text-sky-800 pt-1">📰 뉴스 <span className="font-normal text-gray-400">최근 2일 {ns.length}건</span></div>}
          {ns.map(n => (
            <button key={n.id} onClick={() => openExternal(n.url)} title={`${n.title} — ${n.press}`} className="flex items-baseline gap-1 w-full text-left leading-[18px] hover:bg-sky-50 rounded min-w-0">
              <span className="text-gray-400 tabular-nums shrink-0">{ndt(n.dt)}</span>
              <span className="truncate text-gray-700">{n.title}</span>
            </button>
          ))}
        </div>
        </>
      );
    })()}
    </div>
  );
}
