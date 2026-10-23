// 📊 종목정보 팝업 머리 — 두 창(실시간·기업가치)이 같은 탭 줄을 써서 하나의 팝업처럼 보이게.
//   탭을 누르면 지금 창을 닫고 다른 창을 연다(두 창은 각각 다른 곳에 마운트돼 있다 — tickPopup.ts 주석).
import { X } from "lucide-react";
import { openStockInfo, canStockInfo, type StockInfoTab } from "../lib/tickPopup";

export function StockInfoTabs({ code, name, tab, onClose, right }: {
  code: string; name: string; tab: StockInfoTab;
  onClose: () => void;            // 지금 창 닫기(탭 전환 때도 먼저 부른다)
  right?: React.ReactNode;        // 탭 오른쪽에 둘 것(가격·링크 등)
}) {
  const live = canStockInfo(code);
  const go = (t: StockInfoTab) => { if (t === tab) return; onClose(); openStockInfo(code, name, t); };
  const btn = (t: StockInfoTab, label: string, enabled = true) => (
    <button key={t} onClick={() => go(t)} disabled={!enabled}
            title={!enabled ? "미국 종목은 체결·호가 소스가 없어 기업가치만" : undefined}
            className={`px-2.5 py-1 text-[12px] font-bold rounded-t-md border-b-2 -mb-px transition
                        ${tab === t ? "border-blue-500 text-blue-700 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-100"}
                        disabled:opacity-40 disabled:cursor-not-allowed`}>
      {label}
    </button>
  );
  return (
    <div className="pg-menu flex items-center gap-2 px-3 border-b bg-white shrink-0 flex-wrap">
      <span className="font-bold text-gray-900 py-1.5">📊 종목정보</span>
      <span className="font-bold text-gray-800">{name}</span>
      <span className="text-[12px] text-gray-400">{code}</span>
      <span className="flex items-end self-stretch ml-1">
        {btn("live", "⚡ 실시간", live)}
        {btn("value", "📊 기업가치")}
      </span>
      {right}
      <button onClick={onClose} title="닫기 (Esc)" className="ml-auto p-1 rounded text-gray-500 hover:bg-gray-100"><X size={18} /></button>
    </div>
  );
}
