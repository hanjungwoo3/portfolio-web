// ⚡ 종목 실시간 체결 팝업 — 반도체 수급 탭과 **같은 화면**에서 삼성전자·하이닉스 자리만 고른 종목 하나로(사용자 요청 2026-10-22).
//   코스피·코스닥 현물, 선물, 옵션, 신호, 수급 칸은 그대로. 종목 카드 ⚡체결·반도체 탭 체결 칸 제목에서 연다.
//   체결은 팝업이 열려 있을 때만 5초마다 받는다. 쌓인 것은 종목별로 브라우저에 남아(useTickFlow) 다시 열면 이어진다.
import { useEffect } from "react";
import { X } from "lucide-react";
import { useTickPopup, closeTickPopup } from "../lib/tickPopup";
import { SemiDashTab } from "./SemiDashTab";

export function StockTickPopupHost() {
  const t = useTickPopup();
  if (!t) return null;
  return <StockTickPopup key={t.code} code={t.code} name={t.name} />;   // 종목이 바뀌면 새로(체결 누적 상태가 종목별)
}

function StockTickPopup({ code, name }: { code: string; name: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeTickPopup(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={closeTickPopup}>
      <div className="bg-gray-50 w-full h-full sm:w-[98vw] sm:h-[96vh] sm:rounded-xl shadow-2xl flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="pg-menu flex items-baseline gap-2 px-3 py-1.5 bg-white border-b">
          <span className="font-bold text-gray-900">⚡ {name}</span>
          <span className="text-[12px] text-gray-400">{code} · 반도체 수급 화면에서 종목 칸만 바꿔 봄</span>
          <a href={`https://tossinvest.com/stocks/A${code}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:text-blue-600 underline">토스</a>
          <button onClick={closeTickPopup} title="닫기 (Esc)" className="ml-auto p-1 rounded text-gray-500 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SemiDashTab stocks={[{ code, name }]} popup />
        </div>
      </div>
    </div>
  );
}
