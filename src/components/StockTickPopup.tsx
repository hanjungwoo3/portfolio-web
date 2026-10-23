// 📊 종목정보 — ⚡ 실시간 탭 창. 반도체 수급 화면(SemiDashTab)을 **한 종목** 모드로 띄운다(popup=true 면 그 종목 것만 그린다).
//   체결은 열려 있을 때만 5초마다 받는다. 쌓인 것은 종목별로 브라우저에 남아(useTickFlow) 다시 열면 이어진다.
//   📊 기업가치 탭은 기존 ValuationModal — 머리 탭(StockInfoTabs)으로 오간다.
import { useEffect } from "react";
import { useStockInfo, closeStockInfo } from "../lib/tickPopup";
import { SemiDashTab } from "./SemiDashTab";
import { StockInfoTabs } from "./StockInfoTabs";

export function StockInfoPopupHost() {
  const t = useStockInfo();
  if (!t) return null;
  return <StockLivePopup key={t.code} code={t.code} name={t.name} />;   // 종목이 바뀌면 새로(체결 누적 상태가 종목별)
}
export const StockTickPopupHost = StockInfoPopupHost;   // 옛 이름

function StockLivePopup({ code, name }: { code: string; name: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeStockInfo(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={closeStockInfo}>
      <div className="bg-gray-50 w-full h-full sm:w-[98vw] sm:h-[96vh] sm:rounded-xl shadow-2xl flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <StockInfoTabs code={code} name={name} tab="live" onClose={closeStockInfo}
                       right={<a href={`https://tossinvest.com/stocks/A${code}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:text-blue-600 underline">토스 ↗</a>} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SemiDashTab stocks={[{ code, name }]} popup />
        </div>
      </div>
    </div>
  );
}
