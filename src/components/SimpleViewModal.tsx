// 심플 보기 팝업 — 현재 탭 종목들을 "현재가 박스"(목/고/현재가/저)만 컴팩트 그리드로.
// 카드 본체는 SimplePriceCard 가 그린다 — 섹터(업종·테마) 팝업과 같은 컴포넌트다.
// 두 곳이 각자 그리면 같은 숫자가 다르게 보이기 시작한다.
import type { Stock, Price } from "../types";
import { SimplePriceCard } from "./SimplePriceCard";
import { marketOfSymbol, isUsExtendedTradingOpen, isQuoteStale, isKrHoldingClosed } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { useEscClose } from "../lib/useEscClose";

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white shadow-xl w-full max-w-5xl rounded-t-xl sm:rounded-lg
                      max-h-[92vh] flex flex-col overflow-hidden">
        <header className="px-5 py-3 border-b bg-gray-50 flex items-center shrink-0">
          <h2 className="text-lg font-bold">💠 심플 보기{title ? ` (${title})` : ""}</h2>
          <span className="ml-3 text-xs text-gray-500">{stocks.length}종목</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>

        <div className="px-3 py-3 overflow-y-auto">
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
                : isKrHoldingClosed(reg?.tradingEnd, reg?.nextTradingStart, p.singlePrice);
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
        </div>
      </div>
    </div>
  );
}

export default SimpleViewModal;
