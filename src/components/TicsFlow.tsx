// 섹터 흐름(토스 TICS) — 지수 탭의 한국/미국 섹터 블록.
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

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTossTicsRanking,
  type TicsCategory, type TicsDuration, type TicsNation, type TicsSort,
} from "../lib/api";
import { signColor } from "../lib/format";
import { TicsStockDialog } from "./TicsStockDialog";

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

export function TicsFlow({ nation, onOpenValuation }: {
  nation: TicsNation;
  onOpenValuation?: (ticker: string, name: string) => void;
}) {
  const [duration, setDuration] = useState<TicsDuration>("1d");
  const [sortBy, setSortBy] = useState<TicsSort>("FLUCTUATION_RATE");
  const [expanded, setExpanded] = useState(false);
  const [dlg, setDlg] = useState<TicsCategory | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["tics-flow", nation, duration, sortBy],
    queryFn: () => fetchTossTicsRanking(nation, duration, sortBy),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const maxAmount = items.reduce((m, c) => Math.max(m, c.tradingAmountKrw), 0);
  const many = items.length > TOP_FOLD * 2;
  const shown = !many || expanded
    ? items
    : [...items.slice(0, TOP_FOLD), ...items.slice(-TOP_FOLD)];
  const stamp = data?.basedAt
    ? new Date(new Date(data.basedAt).getTime() + 9 * 3600_000).toISOString().slice(11, 16)
    : null;

  return (
    <>
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        {SORTS.map(x => (
          <button key={x.key} onClick={() => setSortBy(x.key)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                    sortBy === x.key ? "bg-gray-800 text-white border-gray-800"
                                     : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {x.label}
          </button>
        ))}
        <span className="text-gray-300 mx-0.5">|</span>
        {DURATIONS.map(x => (
          <button key={x.key} onClick={() => setDuration(x.key)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                    duration === x.key ? "bg-indigo-600 text-white border-indigo-600"
                                       : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 -mt-0.5 mb-1 flex-wrap">
        <span>
          토스 분류 {items.length}개 · 막대는 거래대금 비중 ·{" "}
          <span className="text-gray-400">{stamp ? `기준 ${stamp} · ` : ""}누르면 종목 목록</span>
        </span>
        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">토스 기준</span>
        <button onClick={() => void refetch()} disabled={isFetching}
                title="분류 랭킹을 다시 조회합니다 (프록시 1콜)"
                className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                           hover:bg-gray-100 disabled:opacity-50">
          {isFetching ? "조회 중…" : "🔄 새로고침"}
        </button>
      </div>

      {isError ? (
        <div className="py-6 text-center text-[11px] text-rose-700">
          데이터를 가져오지 못했습니다 — {(error as Error)?.message}
        </div>
      ) : isLoading && !data ? (
        <div className="py-6 text-center text-[11px] text-gray-400">불러오는 중…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 items-stretch">
          {shown.map(c => (
            <TicsCard key={c.ticsId} c={c} maxAmount={maxAmount}
                      onClick={() => setDlg(c)} onOpen={() => setDlg(c)} />
          ))}
        </div>
      )}

      {many && (
        <button onClick={() => setExpanded(v => !v)}
                className="mt-1 w-full py-1 rounded border border-gray-300 bg-white text-[11px]
                           text-gray-600 hover:bg-gray-50">
          {expanded
            ? `접기 (상·하위 ${TOP_FOLD}개씩)`
            : `전체 ${items.length}개 보기 (지금은 상·하위 ${TOP_FOLD}개씩 ${TOP_FOLD * 2}개)`}
        </button>
      )}

      {dlg && (
        <TicsStockDialog cat={dlg} nation={nation} onClose={() => setDlg(null)}
                         onOpenValuation={onOpenValuation} />
      )}
    </>
  );
}
