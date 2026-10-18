// 심플 보기 → 히트맵 — 지금 그룹 종목을 네모 지도로. 크기·색 기준은 히트맵 탭과 같은 종류에서 고른다.
//   - 1일 등락·보유금액은 실시간 시세(priceMap) — 카드와 같은 숫자(전일 종가 대비)
//   - 시가총액·거래대금·거래량·기간 수익률은 TradingView 스캐너(히트맵 탭과 같은 출처, 종목당 추가 호출 없이 한 번)
//   - 미국 종목의 시총·거래대금은 달러라, 그 종목의 원화 현재가 ÷ 달러 종가로 원화로 맞춘다(한·미 섞인 그룹 비교용)
//   배치 = 히트맵 탭과 같은 squarify, 색 = 같은 heatColor.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Stock, Price } from "../types";
import { squarify } from "../lib/treemap";
import { heatColor, sectorKr } from "../lib/heatColor";
import { fetchHeatmapForTickers, heatmapLogoUrl, type HeatmapItem } from "../lib/api";
import { marketOfSymbol, isKrHoldingClosed, tradeSecOf, isEtfOrEtnByName, isUsExtendedTradingOpen, isQuoteStale } from "../lib/format";
import { HEAT_SIZE_OPTS, HEAT_COLOR_OPTS, type HeatSizeBy, type HeatColorBy, type HeatGroupBy, type HeatSign, HEAT_FAINT_RATIO } from "../lib/holdingsHeat";

interface Cell { ticker: string; name: string; held: number; price: number; d1: number | null; shares: number; cost: number; asleep: boolean; tv?: HeatmapItem; krwPer: number }
// 한국 종목 거래시간 — 흐림(장 안 열림) 판정용. App 의 fetchKrRegularPrices 결과를 그대로 받는다.
interface KrRegLite { tradingEnd?: string; nextTradingStart?: string }

const fmtPct = (p: number | null | undefined) => p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
function fmtWon(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1)}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString()}원`;
}
// 로고 크기 — 칸의 짧은 변에 비례(16~40px)
const logoPx = (w: number, h: number) => Math.round(Math.max(16, Math.min(40, Math.min(w, h) * 0.22)));
const fmtCount = (v: number) => v >= 1e8 ? `${(v / 1e8).toFixed(1)}억주` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만주` : `${Math.round(v)}주`;

export function HoldingsHeatmap({ stocks, priceMap, krRegMap, sizeBy, colorBy, groupBy = "none", sign = "all", hideFaint = false, onOpen }: {
  stocks: Stock[];
  priceMap: Map<string, Price>;
  krRegMap?: Map<string, KrRegLite | undefined>;
  sizeBy: HeatSizeBy;
  colorBy: HeatColorBy;
  groupBy?: HeatGroupBy;
  sign?: HeatSign;
  hideFaint?: boolean;   // 색이 흐린(거의 보합) 종목 빼기
  onOpen?: (ticker: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  // 커스텀 호버 상자 — 마우스 따라 즉시 표시(브라우저 title 은 1초 넘게 늦게 떠서 안 보였다, 2026-10-13). 히트맵 탭과 같은 방식.
  const [hover, setHover] = useState<{ c: Cell; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const h = Math.max(360, Math.round(w * 0.55));

  // 같은 종목이 여러 계좌에 있으면(합산 탭) 한 칸으로 — 수량을 더한다
  const byTicker = new Map<string, Omit<Cell, "tv" | "krwPer">>();
  for (const s of stocks) {
    const p = priceMap.get(s.ticker);
    if (!p || !(p.price > 0)) continue;
    const base = p.prevClose || p.base || p.price;
    const prev = byTicker.get(s.ticker);
    const sh = s.shares > 0 && s.avg_price > 0 ? s.shares : 0;
    // 흐림(장 안 열림) — 기본 종목 카드와 같은 판정. NXT 프리장(08:00~)엔 NXT 종목만 움직이고 KRX 전용 종목은
    //   지난 정규장 값에 멈춰 있어, 둘이 섞이면 '오늘 움직임'과 '지난 거래일 움직임'이 한 지도에 칠해진다(2026-10-19).
    const reg = krRegMap?.get(s.ticker);
    const mk = marketOfSymbol(s.ticker);
    const asleep = mk === "KR"
      ? isKrHoldingClosed(reg?.tradingEnd, reg?.nextTradingStart, p.singlePrice, tradeSecOf(p.trade_dt), isEtfOrEtnByName(s.name))
      : mk === "US" ? (!isUsExtendedTradingOpen() || isQuoteStale(p.freshTime)) : false;
    byTicker.set(s.ticker, {
      ticker: s.ticker, name: s.name, price: p.price, asleep,
      d1: base > 0 ? (p.price / base - 1) * 100 : null,
      held: (prev?.held ?? 0) + Math.max(0, s.shares || 0) * p.price,
      // 내 수익률용 — 여러 계좌면 수량 가중 평단(매입금액 합 ÷ 수량 합)
      shares: (prev?.shares ?? 0) + sh,
      cost: (prev?.cost ?? 0) + sh * (s.avg_price || 0),
    });
  }
  const tickers = [...byTicker.keys()].sort();

  // TradingView — 시총·거래대금·기간 수익률과 **회사 로고**. 로고 때문에 기준과 무관하게 늘 부른다(한·미 합쳐 2콜, 5분 캐시).
  //   다만 '지표 없으면 그릴 수 없는' 기준일 때만 로딩·실패 안내를 띄운다(로고만 없으면 조용히 이름만).
  const colorDef = HEAT_COLOR_OPTS.find(o => o.key === colorBy) ?? HEAT_COLOR_OPTS[0];
  const needTv = !["value", "equal", "change"].includes(sizeBy) || !!colorDef.field || groupBy === "sector";
  const tvQ = useQuery({
    queryKey: ["holdings-heat-tv", tickers.join(",")],
    queryFn: () => fetchHeatmapForTickers(tickers),
    enabled: tickers.length > 0,
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1,
  });

  const cells: Cell[] = [...byTicker.values()].map(c => {
    const tv = tvQ.data?.get(c.ticker);
    // 미국(달러) 지표 → 원화: 원화 현재가 ÷ 달러 종가. 한국 종목은 1.
    const isUs = !/\d/.test(c.ticker);
    const krwPer = isUs && tv && tv.close > 0 ? c.price / tv.close : 1;
    return { ...c, tv, krwPer };
  });
  const anyHeld = cells.some(c => c.held > 0);
  const sizeOf = (c: Cell): number => {
    switch (sizeBy) {
      case "value": return anyHeld ? c.held : 1;
      // ETF 는 시가총액이 비어 있다 — 순자산총액(AUM)으로 대신한다(KODEX 200 25조 등, 2026-10-13)
      case "marketCap": return ((c.tv?.marketCap || c.tv?.aum) ?? 0) * c.krwPer;
      case "traded": return (c.tv?.valueTraded ?? 0) * c.krwPer;
      case "volume": return c.tv?.volume ?? 0;
      // 등락률 변동폭 — **색과 같은 기간**의 절댓값(면적은 음수 불가, 방향은 색으로). 보합도 안 사라지게 하한 0.01.
      //   예전엔 히트맵 탭처럼 늘 1일 값이라, 색=1개월일 때 1개월 +1.18% 인 파두가 오늘 많이 움직여 크게 나왔다(2026-10-13).
      case "change": { const v = colorVal(c); return v == null ? 0 : Math.max(Math.abs(v), 0.01); }
      default: return 1;
    }
  };
  // 내 수익률 = 현재가 ÷ 평단 − 1 (보유분만) — 종목 카드의 손익률(StockCard pnlPct)과 같은 계산.
  const pnlOf = (c: Cell): number | null => c.shares > 0 && c.cost > 0 ? (c.price / (c.cost / c.shares) - 1) * 100 : null;
  const colorVal = (c: Cell): number | null =>
    colorDef.key === "pnl" ? pnlOf(c) : colorDef.field ? (c.tv ? colorDef.field(c.tv) : null) : c.d1;
  // 부호 필터 — 색 기준 값이 +인 것만 / −인 것만. 색과 같은 값으로 걸러야 '상승만' 에 파란 칸이 안 섞인다.
  const signOk = (c: Cell) => { if (sign === "all") return true; const v = colorVal(c); return v != null && (sign === "up" ? v > 0 : v < 0); };
  // 흐린 종목 제외 — 값이 없는 회색 칸은 '흐림' 이 아니라 그대로 둔다
  const faintCut = colorDef.sat * HEAT_FAINT_RATIO;
  const isFaint = (c: Cell) => { const v = colorVal(c); return v != null && Math.abs(v) < faintCut; };
  const signed = cells.filter(signOk);
  // '흐린 종목' 은 둘 — 색이 연한 보합 칸, 그리고 장이 안 열려 지난 거래일 값에 멈춘 칸(카드에서 흐린 것).
  //   후자는 **일부만 잠들어 있을 때만** 뺀다. 밤·주말처럼 전부 닫혀 있으면 지난 거래일 지도가 맞는 그림이라 그대로 둔다.
  const someAwake = signed.some(c => !c.asleep);
  const sleepOut = hideFaint && someAwake ? signed.filter(c => c.asleep).length : 0;
  const shown = hideFaint ? signed.filter(c => !isFaint(c) && !(someAwake && c.asleep)) : signed;
  const faintN = signed.length - shown.length - sleepOut;
  const inputs = shown.map(c => ({ item: c, value: sizeOf(c) })).filter(x => x.value > 0);
  const missing = shown.length - inputs.length;
  // 배치 — 그룹 없음 / 섹터(섹터 묶음 안에 종목) / 등락 방향(왼→오 상승·보합·하락 고정). 히트맵 탭과 같은 방식.
  const HEAD = 13;
  const headers: { label: string; x: number; y: number; w: number }[] = [];
  const tiles: { item: Cell; x: number; y: number; w: number; h: number }[] = [];
  if (w > 0 && inputs.length) {
    if (groupBy === "none") {
      tiles.push(...squarify(inputs, { x: 0, y: 0, w, h }));
    } else {
      const keyOf = groupBy === "dir"
        ? (c: Cell) => { const v = colorVal(c); return v == null ? "값 없음" : v > 0 ? "상승" : v < 0 ? "하락" : "보합"; }
        : (c: Cell) => sectorKr(c.tv?.sector || "기타");
      const groups = new Map<string, typeof inputs>();
      for (const x of inputs) { const k = keyOf(x.item); groups.set(k, [...(groups.get(k) ?? []), x]); }
      const place = (label: string, list: typeof inputs, rect: { x: number; y: number; w: number; h: number }) => {
        const head = rect.h > 34 && rect.w > 46 ? HEAD : 0;
        if (head) headers.push({ label: `${label} ${list.length}`, x: rect.x, y: rect.y, w: rect.w });
        tiles.push(...squarify(list, { x: rect.x, y: rect.y + head, w: rect.w, h: rect.h - head }));
      };
      if (groupBy === "dir") {
        // 자리를 고정해야 날마다 비교가 된다. 상승·하락은 화면을 반씩 — 크기 합에 비례시키면
        //   하락 236 : 상승 33 같은 날 상승이 실처럼 가늘어져 안 읽힌다. 보합·값 없음만 크기 합에 비례.
        const blocks = ["상승", "보합", "하락", "값 없음"].map(k => ({ k, list: groups.get(k) ?? [] })).filter(g => g.list.length)
          .map(g => ({ ...g, total: g.list.reduce((a, x) => a + x.value, 0) }));
        const sum = blocks.reduce((a, g) => a + g.total, 0);
        const halves = blocks.filter(g => g.k === "상승" || g.k === "하락");
        const sideW = blocks.filter(g => !halves.includes(g)).reduce((a, g) => a + (w * g.total) / sum, 0);
        let x = 0;
        blocks.forEach((g, i) => {
          const bw = i === blocks.length - 1 ? w - x
            : halves.includes(g) ? (w - sideW) / halves.length : (w * g.total) / sum;
          place(g.k, g.list, { x, y: 0, w: bw, h });
          x += bw;
        });
      } else {
        const secTiles = squarify([...groups].map(([k, list]) => ({ item: { k, list }, value: list.reduce((a, x) => a + x.value, 0) })), { x: 0, y: 0, w, h });
        for (const st of secTiles) place(st.item.k, st.item.list, st);
      }
    }
  }
  const total = inputs.reduce((a, x) => a + x.value, 0);
  const sizeLabel = HEAT_SIZE_OPTS.find(o => o.key === sizeBy)?.label ?? "";
  const fmtSize = (v: number) => sizeBy === "volume" ? fmtCount(v) : fmtWon(v);
  // 등락률 크기는 큰 글씨 등락률이 곧 크기라 따로 안 적는다(예전엔 금액 형식으로 "7원" 이 찍혔다)
  const showSize = sizeBy !== "equal" && sizeBy !== "change" && !(sizeBy === "value" && !anyHeld);

  return (
    <div className="space-y-1">
      {sizeBy === "value" && !anyHeld && (
        <div className="text-[11px] text-amber-700">보유 수량이 없는 그룹이라 같은 크기로 그렸습니다.</div>
      )}
      {needTv && tvQ.isLoading && <div className="text-[11px] text-gray-500">지표 불러오는 중…</div>}
      {needTv && tvQ.isError && <div className="text-[11px] text-rose-600">지표를 못 받았습니다 — 잠시 뒤 다시 열어 주세요</div>}
      <div ref={boxRef} className="relative w-full rounded overflow-hidden bg-gray-100" style={{ height: h }}>
        {headers.map(hd => (
          <div key={`${hd.label}-${hd.x}-${hd.y}`}
               className="absolute z-10 px-1 text-[10px] font-bold text-white bg-gray-800/80 truncate pointer-events-none leading-[13px]"
               style={{ left: hd.x, top: hd.y, width: hd.w, height: HEAD }}>{hd.label}</div>
        ))}
        {tiles.map(t => {
          const c = t.item;
          const v = colorVal(c);
          const big = t.w > 90 && t.h > 54, mid = t.w > 54 && t.h > 30;
          return (
            <button key={c.ticker}
                    onClick={() => onOpen?.(c.ticker)}
                    onMouseMove={e => setHover({ c, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                    className="absolute border border-white/70 text-white overflow-hidden hover:brightness-110 transition
                               flex flex-col items-center justify-center text-center leading-tight"
                    style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: v == null ? "rgb(156,163,175)" : heatColor(v, colorDef.sat) }}>
              {/* 회사 로고 — 히트맵 탭과 같은 TradingView 로고. 칸 크기에 맞춰 크기, 못 불러오면 숨김 */}
              {mid && c.tv?.logoid && (
                <img src={heatmapLogoUrl(c.tv.logoid)} alt="" loading="lazy"
                     onError={e => { e.currentTarget.style.display = "none"; }}
                     className="rounded-full bg-white/90 object-contain pointer-events-none mb-0.5"
                     style={{ width: logoPx(t.w, t.h), height: logoPx(t.w, t.h), padding: 1 }} />
              )}
              {mid && <span className={`font-bold truncate max-w-full px-1 ${big ? "text-sm" : "text-[11px]"}`}>{c.name}</span>}
              {mid && <span className={`tabular-nums ${big ? "text-base font-bold" : "text-[10px]"}`}>{fmtPct(v)}</span>}
              {big && showSize && <span className="text-[10px] opacity-80 tabular-nums">{fmtSize(sizeOf(c))}</span>}
            </button>
          );
        })}
      </div>
      {hover && (() => {
        const c = hover.c, v = colorVal(c), pnl = pnlOf(c), sz = sizeOf(c);
        const row = (k: string, val: string, cls = "") => (
          <div className="flex justify-between gap-4"><span className="text-gray-400">{k}</span><span className={cls}>{val}</span></div>);
        const pctCls = (x: number | null) => x == null ? "" : x >= 0 ? "text-rose-300 font-bold" : "text-blue-300 font-bold";
        const cap = c.tv ? ((c.tv.marketCap || c.tv.aum) * c.krwPer) : 0;
        return (
          <div className="fixed z-[70] pointer-events-none bg-gray-900/95 text-white rounded-md shadow-lg px-2.5 py-1.5 text-xs leading-tight"
               style={{ left: Math.min(hover.x + 14, window.innerWidth - 230), top: Math.min(hover.y + 14, window.innerHeight - 220) }}>
            <div className="flex items-center gap-1.5 mb-1">
              {c.tv?.logoid && <img src={heatmapLogoUrl(c.tv.logoid)} alt="" className="w-4 h-4 rounded-full bg-white object-contain"
                                    onError={e => { e.currentTarget.style.display = "none"; }} />}
              <span className="font-bold truncate max-w-[190px]">{c.name}</span>
              <span className="text-gray-400 text-[10px]">{c.ticker}</span>
            </div>
            <div className="tabular-nums space-y-0.5">
              {row(colorDef.label, fmtPct(v), pctCls(v))}
              {colorDef.key !== "d1" && row("1일 등락률", fmtPct(c.d1), pctCls(c.d1))}
              {colorDef.key !== "pnl" && pnl != null && row("내 수익률", fmtPct(pnl), pctCls(pnl))}
              {row("현재가", `${c.price.toLocaleString()}원`)}
              {c.shares > 0 && row("평단", `${Math.round(c.cost / c.shares).toLocaleString()}원`)}
              {c.held > 0 && row("보유", fmtWon(c.held))}
              {showSize && sizeBy !== "value" && sizeBy !== "marketCap" && row(sizeLabel, fmtSize(sz))}
              {showSize && total > 0 && row("크기 비중", `${((sz / total) * 100).toFixed(1)}%`)}
              {cap > 0 && row(c.tv?.marketCap ? "시가총액" : "순자산(ETF)", fmtWon(cap))}
              {c.tv && c.tv.valueTraded > 0 && sizeBy !== "traded" && row("거래대금", fmtWon(c.tv.valueTraded * c.krwPer))}
            </div>
            {onOpen && <div className="mt-1 text-[10px] text-gray-400">누르면 기업가치</div>}
          </div>
        );
      })()}
      <div className="text-[10px] text-gray-400">
        크기 = {sizeBy === "change" ? `${colorDef.label} 변동폭(색과 같은 기간)` : showSize ? sizeLabel : "같은 크기"}{sizeBy === "value" && showSize ? "(수량 × 현재가)" : ""}
        {" · "}색 = {colorDef.label}(±{colorDef.sat}%에서 가장 진함)
        {colorDef.key === "d1" ? " · 실시간" : colorDef.key === "pnl" ? " · 실시간, 보유 안 한 종목은 회색" : " · TradingView 기간 수익률"}
        {sizeBy === "marketCap" && " · ETF 는 순자산총액"}
        {(sizeBy === "marketCap" || sizeBy === "traded") && " · 미국 종목은 원화 환산"}
        {sign !== "all" && ` · ${sign === "up" ? "+" : "−"}인 ${shown.length}종목만(전체 ${cells.length})`}
        {sleepOut > 0 && ` · 장 안 열린 종목 ${sleepOut}개 제외`}
        {faintN > 0 && ` · 흐린 종목 ${faintN}개 제외(±${faintCut.toFixed(2).replace(/\.?0+$/, "")}% 미만)`}
        {missing > 0 && ` · 값이 없어 빠진 종목 ${missing}개`}
      </div>
    </div>
  );
}
