// 섹터 흐름(토스 TICS) 공용 조각 — 카드(TicsCard)·기간/정렬 목록·금액 포맷.
//   화면을 그리는 건 TicsSectorBoard(지수 탭 '한·미 섹터') 하나다. 여기는 그 재료만 둔다.
//   ※ 예전엔 이 파일에 한 나라짜리 TicsFlow 화면과 TicsCompareTab 비교 탭이 같이 있었는데,
//     한·미를 한 판에 합치면서 둘 다 안 쓰게 됐다(참조 0곳) → 2026-09 제거.
//
// 한국 섹터 카드(ThemeFlow)와 **같은 모양**이다. 다른 건 출처 하나뿐이다:
//   · ThemeFlow: 크롤러 분류 + 토스 시세 3콜, 등락률은 우리가 계산(거래대금 상위 20종 중앙값)
//   · 여기:      토스 TICS 랭킹 1콜, 등락률은 토스가 준 값
// 토스로 바꾸면 **한국과 미국이 같은 한글 분류**가 된다(공통 53개 — 실측). 그게 이 화면의 값어치다.
//   "미국에서 오른 분류가 한국엔 뭐가 있나" 를 두 블록을 위아래로 보며 이름으로 맞출 수 있다.
//
// ⚠️ 등락률 계산식은 공개돼 있지 않다(실측 양자컴퓨터: 토스 +6.58% vs 중앙값 +6.24% ·
//   시총가중 +6.38% — 무엇과도 안 맞는다). 그래서 카드에 '토스 기준' 을 밝힌다.
// ⚠️ 막대는 한국 카드의 '오른 종목 비율' 이 아니다 — 토스가 그 값을 안 준다. 여기서는
//   **거래대금 비중**(그 기간 1위 분류 대비)이다. 무엇을 그린 막대인지 툴팁에 적는다.

import type { TicsCategory, TicsDuration, TicsSort } from "../lib/api";
import { signColor } from "../lib/format";

export const TOP_FOLD = 15;   // 한국 카드와 같은 접기 기준

export const DURATIONS: { key: TicsDuration; label: string }[] = [
  { key: "1d", label: "1일" }, { key: "1w", label: "1주" }, { key: "1m", label: "1개월" },
  { key: "3m", label: "3개월" }, { key: "1y", label: "1년" },
];
export const SORTS: { key: TicsSort; label: string }[] = [
  { key: "FLUCTUATION_RATE", label: "등락률" },
  { key: "TRADING_AMOUNT", label: "거래대금" },
];

export function fmtEok(won: number): string {
  if (!(won > 0)) return "—";
  const eok = won / 1e8;
  if (eok >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

export function TicsCard({ c, maxAmount, onClick, onOpen, selected, pulledRank }: {
  c: TicsCategory; maxAmount: number;
  /** 접힌 구간에서 끌어온 카드의 원래 순위 — 정렬이 어긋나 보이는 이유를 카드가 스스로 말한다 */
  pulledRank?: number;
  /** 카드 본체 클릭 — 선택/해제 */
  onClick: () => void;
  /** 우하단 버튼 — 종목 목록. 본체 클릭과 동작을 가른다(누를 때마다 팝업이 뜨면 비교를 못 한다) */
  onOpen?: () => void;
  selected?: boolean;
}) {
  const ratio = maxAmount > 0 ? Math.min(1, c.tradingAmountKrw / maxAmount) : 0;
  return (
    // ★ 루트가 <button> 이면 안쪽에 버튼을 못 넣는다(중첩 금지) → div + role.
    //   카드 높이는 h-full + flex-col 로 맞춘다. 시그널이 없는 카드도 그 줄을 비워 두어
    //   한 행의 카드들이 같은 높이로 선다(줄이 들쭉날쭉하면 훑어보기가 어렵다).
    <div role="button" tabIndex={0}
         onClick={onClick}
         onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
         title={`${c.name} — ${c.stockCount}종 · 거래대금 ${fmtEok(c.tradingAmountKrw)}`
                + (c.leaderName ? `\n주도 ${c.leaderName}` : "")
                + (c.leaderSignal ? ` — ${c.leaderSignal}` : "")}
         className={`h-full flex flex-col text-left px-2.5 py-2 rounded-lg border cursor-pointer
                     transition-colors ${selected
                       ? "border-amber-500 bg-amber-100 ring-1 ring-amber-500"
                       : "border-gray-200 bg-white hover:bg-gray-50"}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{c.name}</span>
        {pulledRank != null && (
          <span className="shrink-0 px-1 rounded bg-amber-200/70 text-[9px] font-bold text-amber-800"
                title={`이 시장에서는 ${pulledRank}위 — 접힌 구간에 있어 여기로 끌어왔습니다(정렬 위치가 아닙니다)`}>
            {pulledRank}위
          </span>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-gray-400">{c.stockCount}</span>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${signColor(c.pct)}`}>
          {c.pct > 0 ? "+" : ""}{c.pct.toFixed(2)}%
        </span>
      </div>
      {/* 거래대금 비중 — 오른 비율이 아니다(토스가 안 준다). 돈이 얼마나 몰렸는지를 본다.
          ★ 라벨 없는 막대는 "이게 뭐냐" 를 부른다(실제로 두 번 물어봤다) → 막대에 직접 설명을 건다. */}
      <div className="mt-1 h-1 rounded bg-gray-200 overflow-hidden"
           title={`거래대금 비중 ${Math.round(ratio * 100)}% — 이 시장 거래대금 1위 분류 대비`}>
        <div className="h-full bg-indigo-400" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="mt-1 flex items-baseline gap-1 text-[11px]">
        <span className="flex-1 min-w-0 truncate text-gray-500">{c.leaderName ?? "—"}</span>
        <span className="shrink-0 tabular-nums text-gray-400">{fmtEok(c.tradingAmountKrw)}</span>
      </div>
      {/* 시그널 + 종목 목록 버튼 — 마지막 줄에 붙여 카드 바닥을 맞춘다 */}
      <div className="mt-auto pt-0.5 flex items-end gap-1 min-h-[16px]">
        <span className="flex-1 min-w-0 truncate text-[10px] text-amber-700">{c.leaderSignal ?? ""}</span>
        {onOpen && (
          <button type="button"
                  onClick={e => { e.stopPropagation(); onOpen(); }}
                  title={`${c.name} 종목 목록`}
                  className="shrink-0 text-[11px] leading-none px-0.5 opacity-50
                             hover:opacity-100 transition-opacity">📋</button>
        )}
      </div>
    </div>
  );
}
