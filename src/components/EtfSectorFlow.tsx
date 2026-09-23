// 섹터별 흐름 — ETF랭킹 탭의 섹터 카드. 누르면 아래 목록이 그 섹터로 좁혀진다(필터).
//
//   ※ 지수 탭도 이걸 썼지만 2026-09-09 에 테마 카드(ThemeFlow)로 갈아탔다.
//     지수 탭은 "오늘 어느 섹터가 강세인가" 만 보면 되는데, ETF 로 나누면 상품이 있는
//     테마만 보이고 채권·미국 ETF 처럼 흐름과 무관한 칸이 자리를 차지했다.
//     여기는 'ETF 를 분류해서 랭킹을 좁히는' 용도라 이름 규칙 분류가 그대로 맞다.
//
// ★ 데이터는 '스냅샷' 이다. 전체 ETF 시세 조회는 약 17 프록시 콜이라 폴링에 못 태운다
//   (etfRanking.ts 주석 참조). 그래서 localStorage 캐시를 읽어 쓰고, 캐시가 아예 없을 때만
//   1회 조회한다. 지수 탭의 다른 카드들이 실시간인 것과 달리 여기는 '기준 시각' 이 붙는다.

import { useEffect, useState } from "react";
import { signColor } from "../lib/format";
import type { EtfSectorStat } from "../lib/etfSectors";

// 지금 몇 단으로 깔려 있나 — 아래 grid 클래스의 breakpoint 와 **같은 값**을 들고 있어야 한다.
//   "2줄만" 을 CSS 로는 못 센다(칸 수가 화면 폭마다 달라서). 그래서 여기서 세어 잘라낸다.
//   ⚠️ 그리드 클래스를 고치면 이 표도 같이 고쳐야 한다 — 안 그러면 2줄이 아니라 애매하게 잘린다.
const FOLD_ROWS = 2;   // 접었을 때 보여줄 줄 수
const COLS = [
  { min: 1280, n: 6 },   // xl
  { min: 1024, n: 4 },   // lg
  { min: 640,  n: 3 },   // sm
  { min: 0,    n: 2 },   // base
];
function useGridCols(): number {
  const pick = () => COLS.find(c => window.innerWidth >= c.min)?.n ?? 2;
  const [n, setN] = useState(pick);
  useEffect(() => {
    const h = () => setN(pick());
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return n;
}

// 섹터 한 칸 — 중앙값 등락률로 줄 세운다. 평균은 한 종목 급등에 휘둘려서 안 쓴다.
//   막대는 '오른 종목 비율' — 중앙값이 같아도 고르게 간 섹터와 한두 개가 끈 섹터를 가른다.
export function SectorCard({ s, on, onClick }: {
  s: EtfSectorStat; on: boolean; onClick: () => void;
}) {
  // 카드 아래 줄은 '오늘 가장 많이 오른 것'. 이 카드가 답하는 질문이 "오늘 어느 섹터가
  //   가는가" 라서, 거래대금 1위(대표 상품)보다 등락률 1위가 맞다.
  //   거래대금 1위는 팝업 목록과 툴팁에서 확인할 수 있다.
  const lead = s.best;
  const rep = s.rows[0];
  return (
    <button onClick={onClick}
            title={`${s.label} ${s.count}종\n오늘 최고 ${lead?.name ?? "—"}\n대표(거래대금 1위) ${rep?.name ?? "—"}`}
            className={`w-full h-full text-left px-2.5 py-2 rounded-lg border transition-colors
                        ${on ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
      <span className="flex items-baseline gap-1.5">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{s.label}</span>
        {/* 표본이 1~2 종뿐인 섹터는 중앙값이 한 종목에 좌우된다 — 숫자를 눈에 띄게 해 경고 */}
        <span className={`shrink-0 text-[10px] tabular-nums ${
                s.count < 3 ? "text-amber-600 font-bold" : "text-gray-400"}`}>
          {s.count}
        </span>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${signColor(s.median)}`}>
          {s.median > 0 ? "+" : ""}{s.median.toFixed(2)}%
        </span>
      </span>
      {/* 오른 종목 비율 */}
      <span className="block mt-1 h-1 rounded bg-gray-200 overflow-hidden">
        <span className="block h-full bg-rose-400" style={{ width: `${Math.round(s.upRatio * 100)}%` }} />
      </span>
      <span className="mt-1 flex items-baseline gap-1 text-[11px]">
        <span className="flex-1 min-w-0 truncate text-gray-500">{lead?.name ?? "—"}</span>
        {lead && (
          <span className={`shrink-0 tabular-nums ${signColor(lead.pct)}`}>
            {lead.pct > 0 ? "+" : ""}{lead.pct.toFixed(2)}%
          </span>
        )}
      </span>
    </button>
  );
}

// 섹터 카드 그리드. fetchedAt 을 주면 '기준 시각' 캡션을 위에 붙인다(지수 탭용 —
//   그 탭의 다른 카드는 실시간인데 여기만 스냅샷이라 언제 기준인지 밝혀야 한다).
export function EtfSectorFlow({ sectors, selectedKey, onPick, fetchedAt, onRefresh, refreshing }: {
  sectors: EtfSectorStat[];
  selectedKey?: string | null;
  onPick: (s: EtfSectorStat) => void;
  fetchedAt?: number;
  onRefresh?: () => void;      // 주면 캡션에 새로고침 버튼이 붙는다(지수 탭용)
  refreshing?: boolean;
}) {
  // 기본 2줄만 — 섹터가 30개 넘어 카드만으로 화면을 다 먹었다. 누르면 전부 편다.
  const cols = useGridCols();
  const [open, setOpen] = useState(false);
  const limit = cols * FOLD_ROWS;
  const shown = open ? sectors : sectors.slice(0, limit);
  const hidden = Math.max(0, sectors.length - shown.length);
  // ⚠️ hooks 는 early return 보다 위에 있어야 한다 — 아래 sectors.length 가드보다 먼저.
  if (sectors.length === 0) return null;
  const stamp = fetchedAt
    ? new Date(fetchedAt + 9 * 3600_000).toISOString().slice(11, 16)   // KST HH:MM
    : null;
  return (
    <>
    {stamp && (
      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 -mt-0.5 mb-1 flex-wrap">
        <span>
          중앙값 등락률 순 · 레버리지·인버스·선물 제외 ·{" "}
          <span className="text-gray-400">기준 {stamp} · 누르면 종목 목록</span>
        </span>
        {/* 이 블록만 스냅샷이라(전수 조회 약 17콜) 자동 갱신하지 않는다 — 여기서 직접 받는다 */}
        {onRefresh && (
          <button onClick={onRefresh} disabled={refreshing}
                  title="전체 ETF 시세를 다시 조회합니다 (프록시 약 17콜)"
                  className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                             hover:bg-gray-100 disabled:opacity-50">
            {refreshing ? "조회 중…" : "🔄 새로고침"}
          </button>
        )}
      </div>
    )}
    {/* ★ 가로 정렬(grid) — 예전엔 CSS 다단(columns)이라 1,2,3 이 **세로로** 내려갔다.
        등락률 순으로 줄 세운 카드라 위→오른쪽으로 읽히는 게 맞다. */}
    {open && (
      <button onClick={() => setOpen(false)}
              className="mb-2 w-full py-1 rounded-md border border-gray-300 bg-white
                         text-[11px] font-bold text-gray-600 hover:bg-gray-100">
        ▲ 접기 ({FOLD_ROWS}줄만 보기)
      </button>
    )}
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 items-stretch">
      {shown.map(s => (
        <SectorCard key={s.key} s={s} on={s.key === selectedKey} onClick={() => onPick(s)} />
      ))}
    </div>
    {/* 펼치기·접기 — 같은 자리에서 토글한다. 펼치면 카드가 화면을 다 먹어 버튼이 저 아래로
        내려가므로, 그땐 위에도 접기 버튼을 하나 더 둔다(스크롤해서 올라올 필요 없게). */}
    {(hidden > 0 || open) && (
      <button onClick={() => setOpen(o => !o)}
              className={`mt-2 w-full py-1.5 rounded-md border text-[11px] font-bold transition-colors
                          ${open ? "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                                 : "border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"}`}>
        {open ? `▲ 접기 (${FOLD_ROWS}줄만 보기)` : `▼ 전체 보기 (${hidden}개 더)`}
      </button>
    )}
    </>
  );
}
