// 지수(소부장) — 단계별 4칸(기판 / 전공정 / 후공정 / 소재·부품)을 **한 화면에**(사용자 2026-11-02 "한 줄씩 하지 말고 화면을 4등분").
//   칸마다 해외 대장주(테두리 굵게, 미국은 간밤·일본은 지금 장중) ➜ 국내 종목. 카드는 최신공시·히트맵과 같은 QuoteCard(24시간·3개월 설정 따름).
//   칸 제목 옆 = 국내 종목 평균 등락률(동일가중) — 오늘 어느 단계가 강한지. PC 2×2, 모바일 세로로 한 칸씩.
//   + 카드 왼쪽 아래 공시·뉴스 개수 — 누르면 떠 있는 창(칸 아래 목록은 뺐다, 사용자 2026-11-02). 공시 = 최근 5거래일 DART(최신공시와 같은 서버 파일) · 칸별 외국인·기관(금융투자 제외) 5·20일 순매수
//     (크롤러 investor-flows.json — 수급 매집 탭과 같은 파일, 추가 호출 0). 사용자 2026-11-02 "1, 2번 진행".
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

export function SobuGrid({ rows, labels, leadByRow, quote, dimOf }: {
  rows: string[][]; labels: string[]; leadByRow: number[];
  quote: (sym: string) => { price: number; pct: number } | undefined;
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
    const dN = kr ? (disc.data ?? []).filter(r => r.code === code).length : 0;
    const since = new Date(Date.now() + 9 * 3600_000 - 2 * 86400_000).toISOString().replace(/\D/g, "").slice(0, 12);
    const nN = kr ? news.filter(n => n.code === code && n.dt >= since).length : 0;
    // 누르면 그 종목 공시·뉴스를 카드 옆 떠 있는 창으로(사용자 2026-11-02 "클릭하면 레이어로, 마우스 hover 는 빼고")
    const openPeek = (e: import("react").MouseEvent) => {
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
           data-sobu-card
           onMouseEnter={kr && (dN || nN) ? openPeek : undefined}
           onMouseLeave={kr && (dN || nN) ? dropPeek : undefined}>   {/* 종목 카드에 마우스 → 공시·뉴스 창(사용자 2026-11-03 "버튼 말고 종목에 hover") */}
        <QuoteCard code={code} name={NAME.get(sym) ?? sym} px={q && q.price > 0 ? q : undefined} dim={dimOf?.(sym)} className="w-full h-[84px]" />
        {ct && (
          <button onClick={() => openExternal(ct.url)} title={`${ct.date} ${ct.time} ${ct.title}${info.get(ct.rcpNo)?.amountEok ? ` — ${Math.round(info.get(ct.rcpNo)!.amountEok!).toLocaleString()}억` : ""} — 눌러서 DART 원문`}
                  className="absolute -top-1.5 right-1 z-10 px-1 rounded border border-violet-300 bg-violet-50 text-violet-700 text-[9px] font-bold leading-tight hover:bg-violet-100">
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
  return (
    <div className="space-y-2">
    <div className={`grid grid-cols-1 md:grid-cols-2 ${boxes.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"} gap-2`}>   {/* 칸 수만큼 화면을 나눈다(3단계 업종은 3등분) */}
      {boxes.map(b => {
        // 평균·▲▼ 은 흐린 종목(장 안 열림·체결 없음 — 값이 지난 정규장) 빼고(사용자 2026-11-03). 다 흐리면(장 마감 뒤) 전부로
        const live = b.kr.filter(s => !dimOf?.(s));
        const ps = (live.length ? live : b.kr).map(s => quote(s)?.pct).filter((v): v is number => v != null && Number.isFinite(v));
        const avg = ps.length ? ps.reduce((a, v) => a + v, 0) / ps.length : null;
        const up = ps.filter(v => v > 0).length;
        // 칸 수급 — 국내 종목 외국인·기관(금융투자 제외) 누적 순매수 합(억원). 크롤러 기준일(전 거래일)까지
        const fsum = (w: "5" | "20", k: "fo" | "in") => b.kr.reduce((a, s) => a + (flowBy.get(s.slice(0, 6))?.w[w]?.[k] ?? 0), 0);
        const hasFlow = b.kr.some(s => flowBy.has(s.slice(0, 6)));
        return (
          <div key={b.label} className="rounded-lg border border-gray-200 bg-gray-50/50 pg-row p-2">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-bold text-gray-800">{b.label}</span>
              {avg != null && (
                <span className={`text-sm font-bold tabular-nums ${avg > 0 ? "text-rose-600" : avg < 0 ? "text-blue-600" : "text-gray-600"}`}
                      title={live.length && live.length < b.kr.length ? `국내 종목 평균 등락률(동일가중) — 흐린 ${b.kr.length - live.length}종목 제외` : "국내 종목 평균 등락률(동일가중)"}>
                  평균 {avg > 0 ? "+" : ""}{avg.toFixed(2)}%
                </span>
              )}
              {ps.length > 0 && <span className="text-[11px] text-gray-500">▲{up} · ▼{ps.length - up}</span>}
              <span className="ml-auto text-[10px] text-gray-400" title="테두리 카드 = 해외 대장주(미국은 간밤, 일본은 지금 장중)">테두리 = 해외</span>
            </div>
            {hasFlow && (
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
            <div className="grid grid-cols-2 gap-1.5">
              {b.lead.map(s => card(s, true))}
              {/* 국내 종목은 오늘 등락률 높은 순(사용자 2026-11-02) — 값 없는 종목은 뒤로. 해외 대장주는 앞에 고정 */}
              {/* 흐린 종목(장 안 열림·체결 없음)은 아래로(사용자 2026-11-03), 그 안에서 등락률 순 */}
              {[...b.kr].sort((x, y) => (Number(!!dimOf?.(x)) - Number(!!dimOf?.(y))) || (quote(y)?.pct ?? -Infinity) - (quote(x)?.pct ?? -Infinity)).map(s => card(s, false))}
            </div>
          </div>
        );
      })}
    </div>
    {peek && (() => {
      const ds = (disc.data ?? []).filter(r => r.code === peek.code);
      const ns = news.filter(n => n.code === peek.code).slice(0, 10);
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
          {ns.length > 0 && <div className="font-bold text-sky-800 pt-1">📰 뉴스</div>}
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
