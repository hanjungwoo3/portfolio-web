// ETF 비교(미국) 탭 — 같은 기초지수 추종 국내 ETF를 한 줄씩 비교. 행 배경에 1년 추세 스파크라인.
//   종목 셀: 이름·운용사·🔍AI·📊수수료정보 / 컬럼: 현재가·시총·순자산·보수·배당·1주~1년 수익률
//   데이터: fetchEtfKeyIndicator + fetchKrPriceHistory(기간수익률) + fetchTossPrices(현재가). 데스크톱·모바일 공용.
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchEtfKeyIndicator, fetchTossPrices, fetchKrPriceHistory } from "../lib/api";
import type { PricePoint } from "../lib/api";
import { ETF_COMPARE_GROUPS } from "../lib/etfCompareGroups";
import { Sparkline } from "./Sparkline";
import { fmtAgo } from "../lib/format";
import { openGoogleAi, STOCK_ANALYSIS_PROMPT, aiNowStamp } from "../lib/googleAi";

interface Props {
  onOpenValuation?: (ticker: string, name: string) => void;
}

// "32조 4,463억" / "2,089억" → 억 단위 숫자 (정렬용). 못 읽으면 null.
function parseEok(s?: string): number | null {
  if (!s) return null;
  const jo = /(\d[\d,]*)\s*조/.exec(s);
  const eok = /(\d[\d,]*)\s*억/.exec(s);
  let v = 0; let ok = false;
  if (jo) { v += Number(jo[1].replace(/,/g, "")) * 10000; ok = true; }
  if (eok) { v += Number(eok[1].replace(/,/g, "")); ok = true; }
  if (!ok) { const n = Number(s.replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n / 1e8 : null; }
  return v;
}
// 기간 수익률(%) — 마지막 종가 대비 (오늘-back) 시점 이하 마지막 종가 기준. prices 는 날짜 오름차순.
function periodReturn(prices: PricePoint[] | undefined, back: { d?: number; m?: number }): number | undefined {
  if (!prices || prices.length < 2) return undefined;
  const last = prices[prices.length - 1];
  const dt = new Date(`${last.date}T00:00:00Z`);
  if (back.d) dt.setUTCDate(dt.getUTCDate() - back.d);
  if (back.m) dt.setUTCMonth(dt.getUTCMonth() - back.m);
  const target = dt.toISOString().slice(0, 10);
  let base: PricePoint | undefined;
  for (const p of prices) { if (p.date <= target) base = p; else break; }
  if (!base) base = prices[0];
  if (!(base.close > 0)) return undefined;
  return (last.close - base.close) / base.close * 100;
}
const round = (v: number | undefined, d: number): number | null =>
  v == null ? null : Math.round(v * 10 ** d) / 10 ** d;

interface Row {
  code: string; name: string; issuer?: string;
  price?: number; base?: number; prevClose?: number; closes: number[]; tradeDt?: string;
  fee?: number; div?: number;
  aumStr?: string; aum: number | null;
  mcapStr?: string; mcap: number | null;
  navStr?: string; navNum: number | null;
  devRate?: number; devSign?: string; chaseErr?: number;
  r1w?: number; r1m?: number; r3m?: number; r6m?: number; r1y?: number;
  loading: boolean;
}

type SortKey = "name" | "price" | "aum" | "mcap" | "nav" | "fee" | "div" | "dev" | "chase" | "r1w" | "r1m" | "r3m" | "r6m" | "r1y";
interface ColDef { key: SortKey; label: string; sub?: string; }
const COLS: ColDef[] = [
  { key: "r1w",   label: "1주" },
  { key: "r1m",   label: "1개월" },
  { key: "r3m",   label: "3개월" },
  { key: "r6m",   label: "6개월" },
  { key: "r1y",   label: "1년" },
  { key: "fee",   label: "총보수", sub: "낮을수록↑" },
  { key: "div",   label: "분배율", sub: "TTM" },
  { key: "dev",   label: "괴리율", sub: "시장가-NAV" },
  { key: "chase", label: "추적오차", sub: "낮을수록↑" },
  { key: "mcap",  label: "시총" },
  { key: "aum",   label: "순자산", sub: "AUM" },
  { key: "nav",   label: "NAV", sub: "1좌 순자산" },
];
// name(넓게, 현재가 포함) + 12개 데이터 컬럼. 모바일은 가로 스크롤.
const GRID_COLS = "minmax(250px,2.4fr) repeat(12, minmax(52px,1fr))";

const pctColor = (v?: number) => v == null ? "text-gray-400" : v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500";
const fmtPct = (v?: number) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export function EtfCompareTab({ onOpenValuation }: Props = {}) {
  const [groupId, setGroupId] = useState<string>(ETF_COMPARE_GROUPS[0].id);
  const [sortKey, setSortKey] = useState<SortKey>("aum");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const group = ETF_COMPARE_GROUPS.find(g => g.id === groupId) ?? ETF_COMPARE_GROUPS[0];
  const codes = group.items.map(i => i.code);

  const kiQs = useQueries({
    queries: group.items.map(it => ({
      queryKey: ["etf-key-indicator", it.code],
      queryFn: () => fetchEtfKeyIndicator(it.code),
      staleTime: 30 * 60_000, refetchOnWindowFocus: false,
    })),
  });
  const histQs = useQueries({
    queries: group.items.map(it => ({
      queryKey: ["etf-compare-hist", it.code],
      queryFn: () => fetchKrPriceHistory(it.code, "1y"),
      staleTime: 60 * 60_000, refetchOnWindowFocus: false,
    })),
  });
  const { data: prices } = useQuery({
    queryKey: ["etf-compare-prices", codes],
    queryFn: () => fetchTossPrices(codes),
    refetchInterval: 60_000, staleTime: 30_000,
  });
  const priceMap = useMemo(() => new Map((prices ?? []).map(p => [p.ticker, p])), [prices]);

  const rows: Row[] = group.items.map((it, i) => {
    const ki = kiQs[i]?.data ?? undefined;
    const hist = histQs[i]?.data as PricePoint[] | undefined;
    const p = priceMap.get(it.code);
    return {
      code: it.code, name: it.name, issuer: ki?.issuerName,
      price: p?.price, base: p?.base, prevClose: p?.prevClose, closes: (hist ?? []).map(h => h.close), tradeDt: p?.trade_dt,
      fee: ki?.totalFee,
      div: ki?.dividendYieldTtm ?? ki?.dividendYield,
      aumStr: ki?.totalNav, aum: parseEok(ki?.totalNav),
      mcapStr: ki?.marketValue, mcap: parseEok(ki?.marketValue),
      navStr: ki?.nav, navNum: ki?.nav ? (Number(ki.nav.replace(/,/g, "")) || null) : null,
      devRate: ki?.deviationRate, devSign: ki?.deviationSign, chaseErr: ki?.chaseErrorRate,
      r1w: periodReturn(hist, { d: 7 }), r1m: periodReturn(hist, { m: 1 }),
      r3m: periodReturn(hist, { m: 3 }), r6m: periodReturn(hist, { m: 6 }),
      r1y: periodReturn(hist, { m: 12 }),
      loading: (kiQs[i]?.isLoading ?? false) || (histQs[i]?.isLoading ?? false),
    };
  });

  const sortVal = (r: Row): number | null => {
    switch (sortKey) {
      case "name": return null;
      case "price": return r.price ?? null;
      case "aum": return r.aum; case "mcap": return r.mcap;
      case "nav": return r.navNum;
      case "fee": return r.fee ?? null; case "div": return r.div ?? null;
      case "dev": return r.devRate != null ? (r.devSign === "-" ? -r.devRate : r.devRate) : null;
      case "chase": return r.chaseErr ?? null;
      case "r1w": return r.r1w ?? null; case "r1m": return r.r1m ?? null;
      case "r3m": return r.r3m ?? null; case "r6m": return r.r6m ?? null; case "r1y": return r.r1y ?? null;
    }
  };
  const sorted = [...rows].sort((a, b) => {
    if (sortKey === "name") return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    const av = sortVal(a), bv = sortVal(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; if (bv == null) return -1;
    return sortAsc ? av - bv : bv - av;
  });

  // 최적값 — 총보수는 원값 그대로 최저(소수점 다 표시, 동률이면 모두 최저). 배당·1년은 표시 자릿수(2자리) 최고.
  const bestFee = Math.min(...rows.map(r => r.fee).filter((v): v is number => typeof v === "number"), Infinity);
  const bestDiv = Math.max(...rows.map(r => round(r.div, 2)).filter((v): v is number => v != null), -Infinity);
  const bestR1y = Math.max(...rows.map(r => round(r.r1y, 2)).filter((v): v is number => v != null), -Infinity);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc(a => !a);
    else { setSortKey(k); setSortAsc(k === "fee"); }
  };
  const arrow = (k: SortKey) => sortKey === k ? (sortAsc ? " ▲" : " ▼") : "";

  const openAi = (r: Row) => {
    const chg = r.price != null && r.base ? ((r.price - r.base) / r.base) * 100 : undefined;
    const ctx = [`${r.name}(${r.code})`];
    if (r.price != null) ctx.push(`현재가 ${Math.round(r.price).toLocaleString()}원` + (chg != null ? `(${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%)` : ""));
    ctx.push(`${group.benchmark} 추종 국내 ETF`);
    openGoogleAi(`${STOCK_ANALYSIS_PROMPT}\n\n[기준시각] ${aiNowStamp()}\n[분석 대상] ${ctx.join(", ")}`);
  };

  return (
    <div className="space-y-3">
      {/* 카테고리 */}
      <div className="flex flex-wrap items-center gap-2">
        {ETF_COMPARE_GROUPS.map(g => (
          <button key={g.id} onClick={() => setGroupId(g.id)}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition ${
                    g.id === groupId ? "bg-blue-600 text-white border-blue-600"
                                     : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="text-xs text-gray-500 -mt-1">
        <span className="font-semibold text-gray-700">{group.benchmark}</span>
        {group.desc && <> · {group.desc}</>}
        <span className="text-gray-400"> · 출처: 네이버 금융/토스 · 순수 지수추종만 (H=환헤지)</span>
      </div>

      {/* 비교 — 한 종목당 한 줄. 행 배경에 1년 추세 스파크라인. 가로 스크롤(모바일). */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <div className="min-w-[1160px]">
          {/* 헤더 */}
          <div className="grid items-end gap-x-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-gray-500 text-xs"
               style={{ gridTemplateColumns: GRID_COLS }}>
            <button onClick={() => onSort("name")} className="text-left font-semibold hover:text-gray-800">ETF{arrow("name")}</button>
            {COLS.map(c => (
              <button key={c.key} onClick={() => onSort(c.key)} className="text-right font-semibold hover:text-gray-800 leading-tight">
                {c.label}{arrow(c.key)}
                {c.sub && <div className="text-[9px] text-gray-400 font-normal leading-none">{c.sub}</div>}
              </button>
            ))}
          </div>
          {/* 행 */}
          {sorted.map(r => {
            // 등락 기준가 = 직전 거래일 종가(prevClose). 비거래일엔 base=현재가라 0%가 되므로 prevClose 우선.
            const ref = r.prevClose && r.prevClose > 0 ? r.prevClose : r.base;
            const chg = r.price != null && ref ? ((r.price - ref) / ref) * 100 : undefined;
            const diff = r.price != null && ref ? Math.round(r.price - ref) : undefined;
            // 일반 카드 스타일 — 현재가·% 방향색 + 옅은 배경 틴트
            const clr = chg == null ? "text-gray-800" : chg > 0 ? "text-rose-600" : chg < 0 ? "text-blue-600" : "text-gray-800";
            const tint = chg == null ? "" : chg > 0 ? "bg-rose-50/40" : chg < 0 ? "bg-blue-50/40" : "";
            const sparkColor = r.closes.length > 1
              ? (r.closes[r.closes.length - 1] >= r.closes[0] ? "#dc2626" : "#2563eb") : undefined;
            const feeBest = r.fee != null && r.fee === bestFee;
            const divBest = round(r.div, 2) === bestDiv;
            const r1yBest = round(r.r1y, 2) === bestR1y;
            return (
              <div key={r.code} className="border-b border-gray-100 last:border-b-0 hover:bg-blue-50/20">
                <div className="grid items-center gap-x-2 px-3 text-sm tabular-nums min-h-[84px]"
                     style={{ gridTemplateColumns: GRID_COLS }}>
                  {/* 종목 — 배경에 1년 추세 스파크라인 (이 칸만) */}
                  <div className={`relative self-stretch min-w-0 overflow-hidden flex flex-col justify-center ${tint}`}>
                    {r.closes.length > 1 && (
                      <Sparkline data={r.closes} width={200} height={84} color={sparkColor} strokeWidth={0.7}
                                 className="absolute inset-0 w-full h-full opacity-30 pointer-events-none" />
                    )}
                    <div className="relative z-10 pl-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] font-bold text-amber-700 bg-amber-100/80 border border-amber-300/50 rounded px-0.5 leading-tight shrink-0">ETF</span>
                      <button onClick={() => onOpenValuation
                                ? onOpenValuation(r.code, r.name)
                                : window.open(`https://www.tossinvest.com/stocks/A${r.code}`, "_blank")}
                              className="font-bold text-gray-800 hover:text-blue-600 hover:underline leading-tight text-left truncate">
                        {r.name}
                      </button>
                      <button onClick={() => openAi(r)} title="구글 AI 분석"
                              className="shrink-0 inline-flex items-center px-1 rounded text-[9px] font-bold leading-none
                                         border border-blue-300 text-blue-700 bg-blue-50/90 hover:bg-blue-100">🔍AI</button>
                    </div>
                    <div className="text-[10px] text-gray-400 leading-tight truncate">{r.issuer ?? (r.loading ? "…" : r.code)}</div>
                    {r.price != null && (
                      <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                        <span className={`text-lg font-bold tabular-nums leading-none ${clr}`}>{Math.round(r.price).toLocaleString()}원</span>
                        {chg != null && <span className={`text-sm font-bold tabular-nums ${clr}`}>{fmtPct(chg)}</span>}
                        {diff ? <span className="text-[10px] text-gray-400 tabular-nums">({diff >= 0 ? "+" : ""}{diff.toLocaleString()}원)</span> : null}
                      </div>
                    )}
                    {(() => {
                      const ago = r.tradeDt ? fmtAgo(Date.parse(r.tradeDt) / 1000, "정규장 마감") : "";
                      return ago ? <div className="text-[9px] text-gray-400 leading-none mt-0.5">{ago}</div> : null;
                    })()}
                    </div>
                  </div>
                  {/* 기간 수익률 (이름 오른쪽) */}
                  <div className={`text-right ${pctColor(r.r1w)}`}>{fmtPct(r.r1w)}</div>
                  <div className={`text-right ${pctColor(r.r1m)}`}>{fmtPct(r.r1m)}</div>
                  <div className={`text-right ${pctColor(r.r3m)}`}>{fmtPct(r.r3m)}</div>
                  <div className={`text-right ${pctColor(r.r6m)}`}>{fmtPct(r.r6m)}</div>
                  <div className={`text-right font-semibold ${r1yBest ? "bg-emerald-50 rounded px-0.5" : ""} ${pctColor(r.r1y)}`}>{fmtPct(r.r1y)}</div>
                  {/* 지표 — 총보수·분배율·괴리율·추적오차·시총·순자산·NAV */}
                  <div className={`text-right font-semibold ${feeBest ? "text-emerald-600" : "text-gray-800"}`}>
                    {feeBest && <span className="mr-0.5 text-[9px] font-normal">최저</span>}{r.fee != null ? `${r.fee}%` : "—"}
                  </div>
                  <div className={`text-right font-semibold ${divBest ? "text-emerald-600" : "text-gray-800"}`}>
                    {divBest && <span className="mr-0.5 text-[9px] font-normal">최고</span>}{r.div != null ? `${r.div.toFixed(2)}%` : "—"}
                  </div>
                  <div className="text-right text-gray-600">
                    {r.devRate != null ? `${r.devSign ?? ""}${r.devRate}%` : "—"}
                  </div>
                  <div className="text-right text-gray-600">
                    {r.chaseErr != null ? `${r.chaseErr}%` : "—"}
                  </div>
                  <div className="text-right text-gray-700">{r.mcapStr ?? "—"}</div>
                  <div className="text-right text-gray-700">{r.aumStr ?? "—"}</div>
                  <div className="text-right text-gray-700">{r.navStr ?? "—"}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        종목명 클릭=기업가치 상세, 🔍AI=구글 AI 분석. 헤더 클릭 정렬(기본 순자산순). 기간수익률=일봉 종가(1h 캐시), 총보수·분배율 30분 캐시, 현재가 실시간. 초록=최저보수·최고분배율·최고 1년.
      </p>

      {/* 용어 설명 — 표 아래 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-gray-500 leading-relaxed">
        <div className="border border-gray-200 rounded-md bg-gray-50/60 p-2.5">
          <div className="font-bold text-gray-600 mb-1">📖 용어</div>
          <ul className="space-y-1">
            <li><b className="text-gray-700">순자산(AUM)</b> — ETF 총 순자산 규모. 클수록 유동성·안정성 유리</li>
            <li><b className="text-gray-700">NAV</b> — 1좌당 순자산가치(ETF 이론 적정가). 시장가는 이 근처에서 거래</li>
            <li><b className="text-gray-700">총보수</b> — 연 운용·판매 등 총 보수율. 낮을수록 비용 유리</li>
            <li><b className="text-gray-700">분배율(TTM)</b> — 최근 1년 분배금 ÷ 주가 (ETF 배당수익률)</li>
            <li><b className="text-gray-700">괴리율</b> — 시장가 − NAV 차이. +면 비싸게, −면 싸게 거래 중</li>
            <li><b className="text-gray-700">추적오차</b> — 기초지수 대비 이탈 정도. 패시브는 낮을수록 추종 정확</li>
          </ul>
        </div>
        <div className="border border-amber-200 rounded-md bg-amber-50/60 p-2.5">
          <div className="font-bold text-gray-600 mb-1">💡 총보수는 이렇게 적용돼요</div>
          <ul className="list-disc pl-4 space-y-1">
            <li>매일 순자산(NAV)에서 <b>연 보수 ÷ 365</b>씩 자동 차감 — 별도 청구·출금 없음</li>
            <li>ETF 가격에 이미 반영 → <b>보유한 일수만큼만 부담</b> (예: 0.05%면 1개월 보유 ≈ 0.004%)</li>
            <li>매수·매도가에 이미 녹아 있어 따로 떼거나 계산하지 않음</li>
            <li>증권사 매매수수료·세금, ETF 내부 매매비용은 <b>총보수와 별개</b></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default EtfCompareTab;
