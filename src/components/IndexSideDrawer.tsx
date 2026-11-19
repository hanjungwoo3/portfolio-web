// 폭 = 1480px(작은 화면은 왼쪽 40px 만 남김) — 1240 은 카드가 작고, 화면 전체는 큰 모니터에서 너무 컸다(사용자 2026-11-09 "원래 크기로", "지금은 너무 큰데")
// 지수 서랍 — 어느 탭에서든 오른쪽 가장자리 '📈 지수' 손잡이를 누르면 미끄러져 나오는 판
//   (사용자 2026-11-09 "지수 상단을 다른 탭들에서 side 에 숨겨 놓고 슬라이드로", "레이어 팝업도 괜찮고", "어디서든 탭을 두고",
//    "지금 있는 카드를 그대로", "글자는 눈에 안 들어온다").
//   내용 = 지수 탭 카드 그대로(UsMarketTab sectionsOverride) — 주간 시장(한국 지수) · 미국 지수 · 환율·금리·투심 · 선물 · 현물.
//   열 때만 그린다(닫으면 내려서 호출이 없다). Esc·바깥 누르기로 닫는다.
import { useEscClose } from "../lib/useEscClose";
import { useEffect, useMemo, useState } from "react";
import { buildIndexSections, type DashboardSection } from "../lib/dashboardGroups";
import { UsMarketTab } from "./UsMarketTab";
import { useDrawerPins } from "../lib/drawerPins";
import { krSchedule, krScheduleLoaded } from "../lib/format";
import { usSchedule } from "../lib/krSchedule";

// 손잡이 위 빈자리 — 오늘 국내 장 시간표(토스 trading-info, 수능 등 바뀐 날은 주황)(사용자 2026-11-19 "거기 작은 글씨로 시간표")
function KrScheduleTag({ onHide }: { onHide: () => void }) {
  const [, tick] = useState(0);
  // 국장/미장 고른 것 기억(사용자 2026-11-19 "선택한 거 유지되게")
  type Tab = "now" | "kr" | "us";
  const [mkt, setMkt] = useState<Tab>(() => { try { const v = localStorage.getItem("schedule_tab"); return v === "us" || v === "kr" ? v : "now"; } catch { return "now"; } });
  const pickMkt = (v: Tab) => { setMkt(v); try { localStorage.setItem("schedule_tab", v); } catch { /* 이번만 */ } };
  useEffect(() => {
    // 1분마다(지금 구간 칸 옮기기) + 시간표가 들어오는 즉시(처음 열 때는 받기 전이라 비어 있었다 — 사용자 2026-11-19 "안 나오는데?")
    const f = () => tick(x => x + 1);
    const t = setInterval(f, 60_000);
    window.addEventListener("kr-schedule", f);
    return () => { clearInterval(t); window.removeEventListener("kr-schedule", f); };
  }, []);
  // 못 받았으면(웹 공용 서버는 토스가 막혀 있다) 평소 시간을 사실처럼 보이지 않게 띄우지 않는다
  if (!krScheduleLoaded()) return null;
  const s = krSchedule();
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;   // 09:00 처럼 두 자리(사용자 2026-11-19)
  const k = new Date(Date.now() + 9 * 3600_000), now = k.getUTCHours() * 60 + k.getUTCMinutes(), wk = k.getUTCDay() >= 1 && k.getUTCDay() <= 5;
  const cur = (a: number, b: number) => (wk && a <= now && now < b ? "bg-indigo-100 text-indigo-800 font-bold" : "");
  const us = usSchedule();
  const dow = k.getUTCDay(), usWk = !(dow === 0 || (dow === 6 && now >= 10 * 60) || (dow === 1 && now < 10 * 60));
  const usCur = (a: number, b: number) => (usWk && (a <= b ? a <= now && now < b : now >= a || now < b) ? "bg-indigo-100 text-indigo-800 font-bold" : "");
  const view: Tab = mkt === "us" && !us ? "kr" : mkt;
  const showUs = view === "us";
  const tab = (v: Tab, l: string) => (
    <button type="button" onClick={() => pickMkt(v)}
            className={`px-1 rounded-t border border-b-0 text-[9.5px] leading-[14px] font-bold ${view === v ? "bg-white border-gray-300 text-gray-800" : "bg-gray-100 border-gray-200 text-gray-400 hover:text-gray-600"}`}>{l}</button>
  );
  // '현재' 탭 — 국장·미장 각각 지금 구간 한 줄씩(사용자 2026-11-19 "현재 국장(장전)·미장(애프터) 시간을 보여주고, 국장/미장은 별도로")
  const krSegs: [string, number, number][] = s.holiday ? [] : [
    ...(s.openStart != null ? [["장전", s.openStart, s.regStart] as [string, number, number]] : []),
    ["정규", s.regStart, s.regEnd],
    ...(s.closingEnd > s.regEnd ? [["시간외", s.regEnd, s.afterStart ?? s.closingEnd] as [string, number, number]] : []),
    ["애프터", s.afterStart ?? s.closingEnd, s.afterEnd],
  ];
  const krNow = wk ? krSegs.find(([, a, b]) => a <= now && now < b) : undefined;
  const usNow = us && !us.holiday && usWk ? us.segs.find(g => (g.start <= g.end ? g.start <= now && now < g.end : now >= g.start || now < g.end)) : undefined;
  const nowRow = (lb: string, seg?: [string, number, number] | null, closed = "닫힘") => (
    // 한 줄씩 — 왼쪽 '국장', 오른쪽 지금 구간(사용자 2026-11-19 "국장 닫힘 / 미장 프리: 처럼 2줄로")
    <div className="flex items-baseline justify-between gap-1">
      <span className="shrink-0 text-[9px] text-gray-400">{lb}</span>
      {seg ? <span className="px-0.5 text-indigo-700 font-bold">{seg[0]}: {hm(seg[1])}~{hm(seg[2])}</span> : <span className="px-0.5 text-gray-400">{closed}</span>}
    </div>
  );
  return (
    <div className="w-[156px] flex flex-col items-end shrink-0">
      {/* 국장/미장 책갈피 탭 — 고른 쪽만(사용자 2026-11-19 "국장/미장 탭으로, 책갈피 탭"), 고른 것 기억 */}
      <div className="flex gap-0.5 pr-1">{tab("now", "현재")}{tab("kr", "국장")}{us && tab("us", "미장")}
        {/* 닫기 — 작은 화면에서 본문을 가린다(사용자 2026-11-19). 시간표·고정 카드를 접고 '📈 지수' 손잡이만 남긴다 */}
        <button type="button" onClick={onHide} title="시간표·고정 카드 접기(손잡이 위 ◂ 로 다시 펼침)"
                className="px-1 rounded-t border border-b-0 bg-gray-100 border-gray-200 text-[9.5px] leading-[14px] font-bold text-gray-400 hover:text-rose-600">✕</button>
      </div>
      <div title={showUs ? "오늘 미국 장 시간(토스, 한국 시각)" : `오늘 국내 장 시간(토스) — 장전 ${s.openStart != null ? hm(s.openStart) : "?"}~ · 정규장 ${hm(s.regStart)}~${hm(s.regEnd)} · 시간외 ~${hm(s.closingEnd)} · 애프터 ~${hm(s.afterEnd)}${s.holiday ? " · 휴장일" : ""}`}
           className={`pg-sched w-full rounded-l-md border border-r-0 border-gray-300 px-1 py-0.5 text-[9.5px] leading-tight tabular-nums text-right whitespace-nowrap text-gray-500`}>   {/* 얇은 테두리, 바탕 없음 · 국내가 바뀐 날은 주황 글씨 */}
        {view === "now"
          ? <>{nowRow("국장", krNow, s.holiday ? "휴장" : "닫힘")}{us && nowRow("미장", usNow ? [usNow.name, usNow.start, usNow.end] : null, us.holiday ? "휴장" : usWk ? "닫힘" : "주말")}</>
          : showUs
          ? (us!.holiday ? <b>미국 휴장</b> : us!.segs.map(g => (
              // 자정을 넘는 구간(정규 23:30~06:00 등)도 칠한다 · 주말(토 10:00~월 10:00)은 칠하지 않음
              <div key={g.name} className={`px-0.5 rounded ${usCur(g.start, g.end)}`}>{g.name} {hm(g.start)}~{hm(g.end)}</div>)))
          : s.holiday ? <b>국내 휴장</b> : <>
            {/* 토스 시간표 그대로 — 장전(동시호가)·정규·시간외·애프터, 지금 구간은 배경색. NXT 프리마켓은 토스가 시간을 주지 않아 적지 않는다 */}
            {s.openStart != null && <div className={`px-0.5 rounded ${cur(s.openStart, s.regStart)}`}>장전 {hm(s.openStart)}~{hm(s.regStart)}</div>}
            <div className={`px-0.5 rounded ${cur(s.regStart, s.regEnd)}`}>정규 {hm(s.regStart)}~{hm(s.regEnd)}</div>
            {s.closingEnd > s.regEnd && <div className={`px-0.5 rounded ${cur(s.regEnd, s.afterStart ?? s.closingEnd)}`}>시간외 {hm(s.regEnd)}~{hm(s.afterStart ?? s.closingEnd)}</div>}
            <div className={`px-0.5 rounded ${cur(s.afterStart ?? s.closingEnd, s.afterEnd)}`}>애프터 {hm(s.afterStart ?? s.closingEnd)}~{hm(s.afterEnd)}</div>
          </>}
      </div>
    </div>
  );
}

// 오른쪽 고정 카드 — 지수 창 카드 그대로(아래 PinnedMini)
// 묶음 = 지수 창 블록(지수·환율·금리·투심·선물·현물) — 심볼이 어느 블록에 있나(서랍 구성 그대로)
const BLOCKS: [string, string[]][] = [["지수", ["kr", "macro"]], ["환율·금리", ["krfx"]], ["선물", ["krnight", "dayfut"]], ["현물", ["spot"]]];
let blockMap: Map<string, string> | null = null;
const orderMap = new Map<string, number>();   // 지수 창 카드 순서(사용자 2026-11-19 "sort 도 지수탭 순서대로")
function blockOf(sym: string): string | undefined {
  if (!blockMap) {
    blockMap = new Map();
    for (const sec of buildIndexSections()) {
      const b = BLOCKS.find(([, ids]) => ids.includes(sec.id))?.[0];
      if (b) for (const r of sec.rows) for (const x of r) { if (!blockMap.has(x)) blockMap.set(x, b); if (!orderMap.has(x)) orderMap.set(x, orderMap.size); }
    }
  }
  return blockMap.get(sym);
}
function PinnedMini() {
  const pins = useDrawerPins();
  // 블록대로 묶은 섹션(지수 창 순서) — 지수 창 카드 그대로 그린다(UsMarketTab cardsColumn)
  const sections = useMemo<DashboardSection[]>(() => {
    const ordered = [...pins].sort((a, b) => { blockOf(a); return (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999); });
    return BLOCKS.flatMap(([lb]) => { const syms = ordered.filter(x => (blockOf(x) ?? "지수") === lb); return syms.length ? [{ id: `pin-${lb}`, label: lb, rows: [syms] } as DashboardSection] : []; });
  }, [pins]);
  if (!pins.length) return null;
  return (
    <div className="w-[156px] min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] pr-0">
      <UsMarketTab sectionsOverride={sections} page="night" cardsColumn />
    </div>
  );
}

export function IndexSideDrawer() {
  const [open, setOpen] = useState(false);
  // 고정 카드가 하나라도 있으면 '📈 지수' 손잡이는 숨긴다 — 카드를 누르면 열리고, 단축키 ` 도 그대로(사용자 2026-11-19)
  // 접기 — 시간표·고정 카드를 숨기고 손잡이만(기기에 기억)
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem("index_side_folded") === "1"; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem("index_side_folded", v ? "1" : "0"); } catch { /* 이번만 */ } };
  const hasPins = useDrawerPins().length > 0 && !folded;
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
              className={`fixed right-0 top-[150px] z-50 rounded-l-lg border border-r-0 border-indigo-300 bg-indigo-50 text-indigo-700 shadow px-1 py-2 text-[11px] font-bold [writing-mode:vertical-rl] hover:bg-indigo-100 ${open || hasPins ? "hidden" : ""}`}
              title="지수·환율·금리·선물·원자재 카드 — 단축키 ` (숫자 1 왼쪽) 로 열고 닫기">📈 지수<span className="mt-1 px-0.5 rounded border border-indigo-300 bg-white text-[9px] font-mono [writing-mode:horizontal-tb]">`</span></button>
      {/* 시간표 + 고정 카드 = 한 세로 줄 — 시간표 줄 수가 바뀌어도 사이가 안 뜬다(사용자 2026-11-19 "공간 남기지 말고") */}
      {!open && !folded && (
        <div className="fixed right-0 top-[80px] bottom-2 z-40 flex flex-col items-end gap-1 pointer-events-none [&>*]:pointer-events-auto">
          <KrScheduleTag onHide={() => fold(true)} />
          <PinnedMini />
        </div>
      )}
      {!open && folded && (
        <button type="button" onClick={() => fold(false)} title="시간표·고정 카드 펼치기"
                className="fixed right-0 top-[122px] z-50 rounded-l-md border border-r-0 border-gray-300 bg-white px-1 text-[11px] font-bold text-gray-500 hover:text-indigo-600 shadow">◂</button>
      )}
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
