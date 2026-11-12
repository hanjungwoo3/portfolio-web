// 폭 = 1480px(작은 화면은 왼쪽 40px 만 남김) — 1240 은 카드가 작고, 화면 전체는 큰 모니터에서 너무 컸다(사용자 2026-11-09 "원래 크기로", "지금은 너무 큰데")
// 지수 서랍 — 어느 탭에서든 오른쪽 가장자리 '📈 지수' 손잡이를 누르면 미끄러져 나오는 판
//   (사용자 2026-11-09 "지수 상단을 다른 탭들에서 side 에 숨겨 놓고 슬라이드로", "레이어 팝업도 괜찮고", "어디서든 탭을 두고",
//    "지금 있는 카드를 그대로", "글자는 눈에 안 들어온다").
//   내용 = 지수 탭 카드 그대로(UsMarketTab sectionsOverride) — 주간 시장(한국 지수) · 미국 지수 · 환율·금리·투심 · 선물 · 현물.
//   열 때만 그린다(닫으면 내려서 호출이 없다). Esc·바깥 누르기로 닫는다.
import { useEffect, useMemo, useState } from "react";
import { buildIndexSections } from "../lib/dashboardGroups";
import { UsMarketTab } from "./UsMarketTab";


export function IndexSideDrawer() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  // 닫을 때도 나올 때처럼 미끄러져 들어간다(사용자 2026-11-09) — 애니메이션이 끝난 뒤 내린다
  const close = () => { if (closing) return; setClosing(true); setTimeout(() => { setOpen(false); setClosing(false); }, 180); };
  const sections = useMemo(() => buildIndexSections(), [open]);   // eslint-disable-line react-hooks/exhaustive-deps — 열 때마다(주간·야간 선물이 시간 따라 바뀐다)   // eslint-disable-line react-hooks/exhaustive-deps — 열 때마다(주간·야간 선물이 시간 따라 바뀐다)
  // 단축키 — ` (숫자 1 왼쪽, 한글 자판에서도 같은 키) 로 열고 닫기(사용자 2026-11-09 "단축키 넣고 싶은데"). 글 쓰는 칸에선 안 먹게
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setOpen(o => { if (o) { close(); return o; } return true; });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => {   // 지수 탭 안내 줄 '지금 열기'
    const h = () => setOpen(true);
    window.addEventListener("open-index-drawer", h);
    return () => window.removeEventListener("open-index-drawer", h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className={`fixed right-0 top-[150px] z-[70] rounded-l-lg border border-r-0 border-indigo-300 bg-indigo-50 text-indigo-700 shadow px-1 py-2 text-[11px] font-bold [writing-mode:vertical-rl] hover:bg-indigo-100 ${open ? "hidden" : ""}`}
              title="지수·환율·금리·선물·원자재 카드 — 단축키 ` (숫자 1 왼쪽) 로 열고 닫기">📈 지수<span className="mt-1 px-0.5 rounded border border-indigo-300 bg-white text-[9px] font-mono [writing-mode:horizontal-tb]">`</span></button>
      {open && (
        <>
          <div className={`fixed inset-0 z-[70] bg-black/20 transition-opacity duration-200 ${closing ? "opacity-0" : "opacity-100"}`} onClick={close} />
          {/* 판 안 빈 곳(카드·버튼·링크가 아닌 곳)을 눌러도 닫힌다(사용자 2026-11-09 "열린 창의 빈 공간 클릭하면 닫히게") */}
          <aside onClick={e => { if (!(e.target as Element | null)?.closest?.(".pg-card, a, button, input, select, label, [data-sobu-peek], [data-disc-popup]")) close(); }}
                 className={`fixed top-0 right-0 bottom-0 z-[71] w-[min(1480px,calc(100vw-40px))] bg-gray-50 pg-bg border-l border-gray-300 shadow-2xl overflow-y-auto ${closing ? "animate-[slideOut_.18s_ease-in_forwards]" : "animate-[slideIn_.18s_ease-out]"}`}>
            <div className="sticky top-0 z-40 bg-white/95 border-b border-gray-200 px-3 py-2 flex items-center gap-2">
              <b className="text-gray-800">📈 지수</b>
              <span className="text-[11px] text-gray-400">지수 탭 카드 그대로 — 단축키 <kbd className="px-1 rounded border border-gray-300 bg-gray-50 font-mono">`</kbd> 로 열고 닫기 · 빈 곳·바깥·Esc 로도 닫힘</span>
              <button onClick={close} className="ml-auto px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 text-[12px]" title="닫기 (Esc)">✕ 닫기</button>
            </div>
            <div className="p-2">
              <UsMarketTab sectionsOverride={sections} page="night" />
            </div>
          </aside>
          <style>{"@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}@keyframes slideOut{from{transform:translateX(0)}to{transform:translateX(100%)}}"}</style>
        </>
      )}
    </>
  );
}
