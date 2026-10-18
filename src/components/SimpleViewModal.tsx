// 히트맵 팝업(옛 심플 보기) — 현재 탭 종목을 히트맵(기본) 또는 "현재가 박스"(목/고/현재가/저) 카드 그리드로.
// 카드 본체는 SimplePriceCard 가 그린다 — 섹터(업종·테마) 팝업과 같은 컴포넌트다.
// 두 곳이 각자 그리면 같은 숫자가 다르게 보이기 시작한다.
import type { Stock, Price } from "../types";
import { SimplePriceCard } from "./SimplePriceCard";
import { marketOfSymbol, isUsExtendedTradingOpen, isQuoteStale, isKrHoldingClosed, tradeSecOf, isEtfOrEtnByName } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { useEscClose } from "../lib/useEscClose";
import { useState } from "react";
import { HoldingsHeatmap } from "./HoldingsHeatmap";
import { HEAT_SIZE_OPTS, HEAT_COLOR_OPTS, HEAT_GROUP_OPTS, HEAT_SIGN_OPTS, type HeatSizeBy, type HeatColorBy, type HeatGroupBy, type HeatSign } from "../lib/holdingsHeat";

// 보기 전환(카드 | 히트맵)·히트맵 크기 기준 — 마지막 선택을 기억한다(2026-10-13)
const SIZE_KEY = "simple_heat_size", COLOR_KEY = "simple_heat_color", GROUP_KEY = "simple_heat_group", FAINT_KEY = "simple_heat_hide_faint";
const load = <T extends string>(k: string, ok: readonly T[], d: T): T => { try { const v = localStorage.getItem(k) as T; return ok.includes(v) ? v : d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 이번 세션만 */ } };

// 흐림 판정에 필요한 최소 형태만 — StockCard·MobileStockCard 가 각자 KrRegInfo 를
//   로컬 선언해 둬서 가져올 곳이 없다. 여기서도 쓰는 필드만 구조적으로 받는다.
interface KrRegLite { tradingEnd?: string; nextTradingStart?: string }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title?: string;                                 // 현재 그룹/탭 이름
  stocks: Stock[];
  priceMap: Map<string, Price>;
  chartMap: Map<string, number[]>;
  targetMap?: Map<string, number | undefined>;   // ticker → 컨센서스 목표가
  onOpenValuation?: (ticker: string) => void;    // 📊 기업가치 — 카드 오른쪽 위 책갈피
  // 흐림 판정용 — 기본 종목 카드(StockCard)와 같은 규칙을 쓰려면 거래시간 정보가 필요하다.
  krRegMap?: Map<string, KrRegLite | undefined>;
}

export function SimpleViewModal({
  isOpen, onClose, title, stocks, priceMap, chartMap, targetMap, onOpenValuation, krRegMap,
}: Props) {
  useEscClose(isOpen, onClose);
  // 열 때는 늘 히트맵부터(사용자 결정 2026-10-13) — 카드는 전환 버튼으로. 그래서 보기는 기억하지 않는다.
  const [view, setView] = useState<"card" | "heat">("heat");
  const [sizeBy, setSizeBy] = useState<HeatSizeBy>(() => load(SIZE_KEY, HEAT_SIZE_OPTS.map(o => o.key), "value"));
  const [colorBy, setColorBy] = useState<HeatColorBy>(() => load(COLOR_KEY, HEAT_COLOR_OPTS.map(o => o.key), "d1"));
  const [groupBy, setGroupBy] = useState<HeatGroupBy>(() => load(GROUP_KEY, HEAT_GROUP_OPTS.map(o => o.key), "none"));
  const [sign, setSign] = useState<HeatSign>("all");   // +만 / −만 — 열 때마다 전체부터(걸러 둔 걸 잊고 종목이 사라진 줄 알지 않게)
  // 흐린(거의 보합) 종목 제외 — 기본 켬. 잘게 쪼개진 이름 없는 칸이 사라진다(2026-10-14).
  const [hideFaint, setHideFaint] = useState(() => { try { return localStorage.getItem(FAINT_KEY) !== "0"; } catch { return true; } });
  if (!isOpen) return null;
  const seg = (on: boolean) => `px-2 py-0.5 ${on ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white shadow-xl w-full max-w-5xl rounded-t-xl sm:rounded-lg
                      max-h-[92vh] flex flex-col overflow-hidden">
        <header className="px-5 py-3 border-b bg-gray-50 flex items-center shrink-0">
          <h2 className="text-lg font-bold">🗺️ 히트맵{title ? ` (${title})` : ""}</h2>
          <span className="ml-3 text-xs text-gray-500">{stocks.length}종목</span>
          <span className="ml-3 inline-flex rounded border border-gray-300 overflow-hidden text-[12px] font-bold">
            <button onClick={() => setView("heat")} className={seg(view === "heat")}>히트맵</button>
            <button onClick={() => setView("card")} className={seg(view === "card")}>카드</button>
          </span>
          {view === "heat" && (
            <span className="ml-3 inline-flex items-center gap-1.5 text-[12px] text-gray-600">
              크기
              <select value={sizeBy} onChange={e => { const v = e.target.value as HeatSizeBy; setSizeBy(v); save(SIZE_KEY, v); }}
                      className="border border-gray-300 rounded px-1 py-0.5 bg-white">
                {HEAT_SIZE_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              색
              <select value={colorBy} onChange={e => { const v = e.target.value as HeatColorBy; setColorBy(v); save(COLOR_KEY, v); }}
                      className="border border-gray-300 rounded px-1 py-0.5 bg-white">
                {HEAT_COLOR_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              그룹
              <select value={groupBy} onChange={e => { const v = e.target.value as HeatGroupBy; setGroupBy(v); save(GROUP_KEY, v); }}
                      className="border border-gray-300 rounded px-1 py-0.5 bg-white">
                {HEAT_GROUP_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <span className="inline-flex rounded border border-gray-300 overflow-hidden font-bold" title="색 기준 값이 +인 종목만 / −인 종목만">
                {HEAT_SIGN_OPTS.map(o => (
                  <button key={o.key} onClick={() => setSign(o.key)}
                          className={`px-2 py-0.5 ${sign === o.key
                            ? (o.key === "up" ? "bg-rose-600 text-white" : o.key === "down" ? "bg-blue-600 text-white" : "bg-gray-800 text-white")
                            : "bg-white text-gray-600 hover:bg-gray-100"}`}>{o.label}</button>
                ))}
              </span>
              <label className="inline-flex items-center gap-1 cursor-pointer select-none" title="장이 안 열려 지난 거래일 값에 멈춘(카드에서 흐린) 종목을 뺀다 — 전부 닫혀 있을 땐 그대로 둔다">
                <input type="checkbox" checked={hideFaint}
                       onChange={e => { setHideFaint(e.target.checked); save(FAINT_KEY, e.target.checked ? "1" : "0"); }} />
                흐린 종목 제외
              </label>
            </span>
          )}
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>

        <div className="px-3 py-3 overflow-y-auto">
          {view === "heat" ? (
            <HoldingsHeatmap stocks={stocks} priceMap={priceMap} krRegMap={krRegMap} sizeBy={sizeBy} colorBy={colorBy} groupBy={groupBy} sign={sign} hideFaint={hideFaint}
                             onOpen={onOpenValuation ? (t => { if (/^[\dA-Za-z]{6}$/.test(t)) onOpenValuation(t); }) : undefined} />
          ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-2 gap-y-3.5 items-stretch">
            {stocks.map(stock => {
              const p = priceMap.get(stock.ticker);
              if (!p) {
                return (
                  <div key={`${stock.ticker}_${stock.account || ""}`}
                       className="border border-gray-200 rounded-md bg-gray-50/60 px-2 py-2">
                    <div className="text-sm font-bold text-gray-900 truncate">{stock.name}</div>
                    <div className="text-gray-400 text-sm">—</div>
                  </div>
                );
              }
              // 흐림 — 기본 카드와 같은 판정(마감이면 흐리게). 설정으로 끌 수 있다.
              const reg = krRegMap?.get(stock.ticker);
              const sleeping = marketOfSymbol(stock.ticker) === "US"
                ? (!isUsExtendedTradingOpen() || isQuoteStale(p.freshTime))
                : isKrHoldingClosed(reg?.tradingEnd, reg?.nextTradingStart, p.singlePrice, tradeSecOf(p.trade_dt),
                                    isEtfOrEtnByName(stock.name));
              return (
                <SimplePriceCard key={`${stock.ticker}_${stock.account || ""}`}
                                 dimmed={sleeping && getDimSleepingEnabled()}
                                 ticker={stock.ticker} name={stock.name}
                                 price={p.price} base={p.prevClose || p.base || p.price}
                                 high={p.high} low={p.low}
                                 target={targetMap?.get(stock.ticker)}
                                 chart={chartMap.get(stock.ticker) ?? []}
                                 actions={onOpenValuation && /^[\dA-Za-z]{6}$/.test(stock.ticker)
                                   ? <button onClick={() => onOpenValuation(stock.ticker)}
                                             title={`${stock.name} 기업가치 보기`}
                                             className="text-[11px] leading-none opacity-70 hover:opacity-100">📊</button>
                                   : null} />
              );
            })}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SimpleViewModal;
