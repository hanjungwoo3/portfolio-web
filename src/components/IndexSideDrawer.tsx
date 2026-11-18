// 폭 = 1480px(작은 화면은 왼쪽 40px 만 남김) — 1240 은 카드가 작고, 화면 전체는 큰 모니터에서 너무 컸다(사용자 2026-11-09 "원래 크기로", "지금은 너무 큰데")
// 지수 서랍 — 어느 탭에서든 오른쪽 가장자리 '📈 지수' 손잡이를 누르면 미끄러져 나오는 판
//   (사용자 2026-11-09 "지수 상단을 다른 탭들에서 side 에 숨겨 놓고 슬라이드로", "레이어 팝업도 괜찮고", "어디서든 탭을 두고",
//    "지금 있는 카드를 그대로", "글자는 눈에 안 들어온다").
//   내용 = 지수 탭 카드 그대로(UsMarketTab sectionsOverride) — 주간 시장(한국 지수) · 미국 지수 · 환율·금리·투심 · 선물 · 현물.
//   열 때만 그린다(닫으면 내려서 호출이 없다). Esc·바깥 누르기로 닫는다.
import { useEscClose } from "../lib/useEscClose";
import { useEffect, useMemo, useState } from "react";
import { buildIndexSections } from "../lib/dashboardGroups";
import { UsMarketTab } from "./UsMarketTab";
import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, fetchYasunNightFutures } from "../lib/api";
import { US_PAIRS } from "../lib/usMarketData";
import { displayPctOf } from "../lib/format";
import { useDrawerPins } from "../lib/drawerPins";
import { fetchUpDown } from "../lib/upDown";

// 닫혀 있을 때 손잡이 아래 작은 카드 — 이름 · 등락률 · 값(사용자 2026-11-19 "지수 창이 닫혀 있을 때 일부를 이 형태로")
const NAME = new Map<string, string>(US_PAIRS.map(p => [p.symbol, p.name]));
// 선물(야간선물·지수 선물·원자재 선물·무기한)은 테두리 색을 달리(사용자 2026-11-19 "선물은 테두리 색을 다르게")
const isFut = (s: string) => /=F$/.test(s) || /^\^K[SQ]\d+N$/.test(s) || /-PERP$/.test(s);
function PinnedMini({ onOpen }: { onOpen: () => void }) {
  const pins = useDrawerPins();
  // 야간선물(^KS200N·^KQ150N)은 야후에 없는 가상 심볼 — yasun.gg 로 따로(지수 창과 같은 경로, 사용자 2026-11-19 "야간 선물 안 나오네")
  const q = useQuery({
    queryKey: ["drawer-pins", pins.join(",")],
    queryFn: async () => {
      const night: string[] = pins.filter(s => s === "^KS200N" || s === "^KQ150N");
      const [m, ...ns] = await Promise.all([
        fetchYahooBatch(pins.filter(s => !night.includes(s)).map(symbol => ({ symbol, name: NAME.get(symbol) ?? symbol }))),
        ...night.map(s => fetchYasunNightFutures(s).catch(() => null)),
      ]);
      night.forEach((s, i) => { const d = ns[i]; if (d) m.set(s, d.index); });
      return m;
    },
    enabled: pins.length > 0, refetchInterval: 30_000, staleTime: 15_000,
  });
  // 코스피·코스닥은 오른·내린 종목 수도(업종 탭 왼쪽 칸과 같은 꼴)
  const ud = useQuery({ queryKey: ["updown"], queryFn: fetchUpDown, enabled: pins.includes("^KS11") || pins.includes("^KQ11"), refetchInterval: 120_000, staleTime: 60_000, retry: 1 }).data;
  if (!pins.length) return null;
  return (
    <div className="fixed right-0 top-[205px] z-40 flex flex-col gap-1 w-[92px]">
      {pins.map(sym => {
        const d = q.data?.get(sym), pct = d ? displayPctOf(sym, d) ?? d.pct : null;
        const tone = pct == null ? "text-gray-400" : pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-600";
        return (
          <button key={sym} type="button" onClick={onOpen} title={`${NAME.get(sym) ?? sym} — 누르면 지수 창`}
                  className={`rounded-l-lg border-2 border-r-0 ${isFut(sym) ? "border-amber-400 bg-amber-50/95" : "border-gray-300 bg-white/95"} shadow px-1.5 py-1 text-left leading-tight hover:bg-indigo-50`}>
            <span className="block truncate text-[11px] font-bold text-gray-700">{NAME.get(sym) ?? sym}</span>
            <span className={`block text-[12px] font-bold tabular-nums ${tone}`}>{pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}</span>
            {d && d.price > 0 && <span className="block text-[10px] text-gray-400 tabular-nums">{d.price < 100 ? d.price.toFixed(2) : Math.round(d.price).toLocaleString()}</span>}
            {(() => { const u = sym === "^KS11" ? ud?.kospi : sym === "^KQ11" ? ud?.kosdaq : undefined; return u ? <span className="block text-[10px] font-bold tabular-nums"><span className="text-rose-600">▲{u.rise}</span> <span className="text-blue-600">▼{u.fall}</span></span> : null; })()}
          </button>
        );
      })}
    </div>
  );
}


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
  // Esc = 맨 위 창만 닫는다(모달 스택 공용 훅) — 서랍 위 종목정보에서 Esc 한 번에 둘 다 닫혔다(사용자 2026-11-13)
  useEscClose(open, close);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className={`fixed right-0 top-[150px] z-50 rounded-l-lg border border-r-0 border-indigo-300 bg-indigo-50 text-indigo-700 shadow px-1 py-2 text-[11px] font-bold [writing-mode:vertical-rl] hover:bg-indigo-100 ${open ? "hidden" : ""}`}
              title="지수·환율·금리·선물·원자재 카드 — 단축키 ` (숫자 1 왼쪽) 로 열고 닫기">📈 지수<span className="mt-1 px-0.5 rounded border border-indigo-300 bg-white text-[9px] font-mono [writing-mode:horizontal-tb]">`</span></button>
      {!open && <PinnedMini onOpen={() => setOpen(true)} />}
      {open && (
        <>
          {/* z-50 = 헤더와 같은 층, 그 뒤 DOM 이라 헤더는 덮고 — App 에서 더 뒤에 그려지는 종목정보·히트맵 창(z-50)은 서랍 위로 뜬다(사용자 2026-11-13 "버튼을 누르면 뒤에 뜨는데") */}
          <div className={`fixed inset-0 z-50 bg-black/20 transition-opacity duration-200 ${closing ? "opacity-0" : "opacity-100"}`} onClick={close} />
          {/* 판 안 빈 곳(카드·버튼·링크가 아닌 곳)을 눌러도 닫힌다(사용자 2026-11-09 "열린 창의 빈 공간 클릭하면 닫히게") */}
          <aside onClick={e => { if (!(e.target as Element | null)?.closest?.(".pg-card, a, button, input, select, label, [data-sobu-peek], [data-disc-popup]")) close(); }}
                 className={`fixed top-0 right-0 bottom-0 z-50 w-[min(1480px,calc(100vw-40px))] bg-gray-50 pg-bg border-l border-gray-300 shadow-2xl overflow-y-auto ${closing ? "animate-[slideOut_.18s_ease-in_forwards]" : "animate-[slideIn_.18s_ease-out]"}`}>
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
