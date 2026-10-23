// 🗺️ 히트맵 팝업 — 카드의 '🗺️ 히트맵'(코덱스200·코스닥150·밸류업)을 누르면 탭을 옮기지 않고 그 자리에 띄운다
//   (사용자 요청 2026-10-23: 탭으로 이동해 버리면 보던 화면으로 돌아가기 어렵다). 닫으면 보던 화면 그대로.
//   내용은 히트맵 탭(HeatmapTab) 그대로 — 소스·크기모드는 requestHeatmap 이 남긴 pending 을 마운트 때 소비한다.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { GOTO_HEATMAP_EVENT } from "../lib/heatmapNav";
import { HeatmapTab } from "./HeatmapTab";

export function HeatmapPopupHost() {
  const [n, setN] = useState(0);   // 0 = 닫힘, 요청마다 +1(같은 창에서 소스를 바꿔 다시 열 때 새로 마운트)
  useEffect(() => {
    const h = () => setN(v => v + 1);
    window.addEventListener(GOTO_HEATMAP_EVENT, h);
    return () => window.removeEventListener(GOTO_HEATMAP_EVENT, h);
  }, []);
  useEffect(() => {
    if (!n) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setN(0); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);
  if (!n) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setN(0)}>
      <div className="bg-white w-full h-full sm:w-[96vw] sm:h-[94vh] sm:rounded-xl shadow-2xl flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="pg-menu flex items-center gap-2 px-3 py-1.5 border-b bg-white shrink-0">
          <span className="font-bold text-gray-900">🗺️ 히트맵</span>
          <button onClick={() => setN(0)} title="닫기 (Esc)" className="ml-auto p-1 rounded text-gray-500 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="pg-bg flex-1 min-h-0 overflow-y-auto">
          <HeatmapTab key={n} />
        </div>
      </div>
    </div>
  );
}
