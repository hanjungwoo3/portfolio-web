// 따라 해 보기 안내 창(lib/guide) — 화면을 막지 않고 떠 있으며, 지금 눌러야 할 곳(data-guide)에 깜빡이는 테두리를 두른다.
//   PC = 단계 목록이 있는 작은 창 / 모바일 = 한두 줄 띠(화면이 좁아서 — 사용자 2026-10-30).
//   짚을 곳이 화면 아래쪽이면 위로, 위쪽이면 아래로 옮겨 가리지 않게 한다.
import { useEffect, useState } from "react";
import { GUIDE_STEPS, useGuide, stopGuide, nextGuide, guideFillSearch } from "../lib/guide";

export function GuideTour({ mobile = false }: { mobile?: boolean }) {
  const { active, step } = useGuide();
  const cur = GUIDE_STEPS[step];
  const [rect, setRect] = useState<DOMRect | null>(null);

  // 짚을 요소 위치 — 창이 열리고 닫히며 바뀌니 짧게 계속 본다(가벼운 getBoundingClientRect 하나)
  useEffect(() => {
    if (!active || !cur?.target) { setRect(null); return; }
    const find = () => {
      const els = [...document.querySelectorAll<HTMLElement>(`[data-guide="${cur.target}"]`)];
      const el = els.find(e => e.offsetParent !== null || e.getClientRects().length > 0);   // 보이는 것(PC·모바일 둘 다 그려져 있을 수 있다)
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 ? r : null);
    };
    find();
    const t = window.setInterval(find, 300);
    return () => window.clearInterval(t);
  }, [active, cur?.target]);

  if (!active || !cur) return null;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const atBottom = !rect || rect.top + rect.height / 2 < vh / 2;   // 짚을 곳이 위쪽이면 안내는 아래
  const last = step === GUIDE_STEPS.length - 1;

  return (
    <>
      {rect && (
        <div className="fixed z-[200] pointer-events-none rounded-lg ring-4 ring-amber-400 animate-pulse"
             style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
      )}
      {mobile ? (
        <div className={`fixed z-[200] left-2 right-2 ${atBottom ? "bottom-2" : "top-2"} rounded-lg bg-gray-900/95 text-white shadow-lg px-3 py-2`}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-widest text-amber-300 shrink-0">
              {GUIDE_STEPS.map((_, i) => (i <= step ? "●" : "○")).join("")}
            </span>
            <span className="flex-1 min-w-0 text-[12.5px] leading-snug">{cur.text}</span>
            {last
              ? <button onClick={stopGuide} className="shrink-0 px-2 py-0.5 rounded bg-amber-400 text-gray-900 text-[12px] font-bold">완료</button>
              : <>
                  {!cur.doneOn && <button onClick={nextGuide} className="shrink-0 px-2 py-0.5 rounded bg-amber-400 text-gray-900 text-[12px] font-bold">다음</button>}
                  <button onClick={stopGuide} className="shrink-0 text-[11px] text-gray-300 underline">건너뛰기</button>
                </>}
          </div>
          {cur.example && (
            <button onClick={() => guideFillSearch(cur.example!)}
                    className="mt-1.5 w-full px-2 py-1 rounded bg-amber-400 text-gray-900 text-[12px] font-bold">{cur.example} 넣어 보기</button>
          )}
        </div>
      ) : (
        <div className={`fixed z-[200] left-4 ${atBottom ? "bottom-4" : "top-4"} w-[300px] rounded-xl bg-white border-2 border-amber-400 shadow-2xl p-3 text-sm`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-bold text-gray-800">🧭 따라 해 보기</span>
            <button onClick={stopGuide} className="ml-auto text-[11px] text-gray-400 hover:text-gray-600 underline">건너뛰기</button>
          </div>
          <ol className="space-y-1 mb-2">
            {GUIDE_STEPS.map((s, i) => (
              <li key={i} className={`flex items-baseline gap-1.5 text-[12px] ${i === step ? "text-gray-900 font-bold" : i < step ? "text-emerald-600" : "text-gray-400"}`}>
                <span className="w-4 shrink-0 text-center">{i < step ? "✓" : i + 1}</span>{s.title}
              </li>
            ))}
          </ol>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[13px] text-gray-800 leading-snug">{cur.text}</div>
          {cur.example && (
            <button onClick={() => guideFillSearch(cur.example!)}
                    className="mt-2 w-full px-2 py-1.5 rounded bg-amber-400 hover:bg-amber-500 text-gray-900 font-bold text-[13px]">{cur.example} 넣어 보기</button>
          )}
          {last
            ? <button onClick={stopGuide} className="mt-2 w-full px-2 py-1.5 rounded bg-gray-900 text-white font-bold text-[13px]">완료</button>
            : !cur.doneOn && <button onClick={nextGuide} className="mt-2 w-full px-2 py-1.5 rounded bg-gray-900 text-white text-[13px]">다음</button>}
        </div>
      )}
    </>
  );
}
