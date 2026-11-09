// 지수 서랍 — 어느 탭에서든 오른쪽 가장자리 '📈 지수' 손잡이를 누르면 미끄러져 나오는 판
//   (사용자 2026-11-09 "지수 상단을 다른 탭들에서 side 에 숨겨 놓고 슬라이드로", "레이어 팝업도 괜찮고", "어디서든 탭을 두고",
//    "지금 있는 카드를 그대로", "글자는 눈에 안 들어온다").
//   내용 = 지수 탭 카드 그대로(UsMarketTab sectionsOverride) — 주간 시장(한국 지수) · 미국 지수 · 환율·금리·투심 · 선물 · 현물.
//   열 때만 그린다(닫으면 내려서 호출이 없다). Esc·바깥 누르기로 닫는다.
import { useEffect, useMemo, useState } from "react";
import { buildDashboardPage } from "../lib/dashboardGroups";
import { UsMarketTab } from "./UsMarketTab";

const NIGHT_IDS = ["macro", "krfx", "krnight", "dayfut", "spot"];   // 선물은 시간대에 따라 둘 중 하나만 페이지에 있다

export function IndexSideDrawer() {
  const [open, setOpen] = useState(false);
  const sections = useMemo(() => [
    ...buildDashboardPage("day").filter(s => s.id === "kr"),
    ...buildDashboardPage("night").filter(s => NIGHT_IDS.includes(s.id)),
  ], [open]);   // eslint-disable-line react-hooks/exhaustive-deps — 열 때마다(주간·야간 선물이 시간 따라 바뀐다)
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className={`fixed right-0 top-1/2 -translate-y-1/2 z-[70] rounded-l-lg border border-r-0 border-indigo-300 bg-indigo-50 text-indigo-700 shadow px-1 py-2 text-[11px] font-bold [writing-mode:vertical-rl] hover:bg-indigo-100 ${open ? "hidden" : ""}`}
              title="지수·환율·금리·선물·원자재 카드 (Esc 로 닫기)">📈 지수</button>
      {open && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/20" onClick={() => setOpen(false)} />
          <aside className="fixed top-0 right-0 bottom-0 z-[71] w-[min(1240px,96vw)] bg-gray-50 pg-bg border-l border-gray-300 shadow-2xl overflow-y-auto animate-[slideIn_.18s_ease-out]">
            <div className="sticky top-0 z-40 bg-white/95 border-b border-gray-200 px-3 py-2 flex items-center gap-2">
              <b className="text-gray-800">📈 지수</b>
              <span className="text-[11px] text-gray-400">지수 탭 카드 그대로 — 지금 보던 탭은 그대로 있습니다</span>
              <button onClick={() => setOpen(false)} className="ml-auto px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 text-[12px]" title="닫기 (Esc)">✕ 닫기</button>
            </div>
            <div className="p-2">
              <UsMarketTab sectionsOverride={sections} page="night" />
            </div>
          </aside>
          <style>{"@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}"}</style>
        </>
      )}
    </>
  );
}
