// 한·미 섹터 비교 — "미국에서 오른 섹터가 한국엔 뭐가 있나" 한 가지에 답한다.
//
// 토스 TICS 는 **한국과 미국에 같은 한글 분류**를 쓴다(공통 53개 — 실측). 그래서 이름만으로
//   양쪽을 맞출 수 있다. 좌(한국)·우(미국)로 놓고, 한쪽을 고르면 반대쪽의 같은 이름으로
//   스크롤해 강조한다 — 매매동향(InvestorFlowTab)에서 종목을 고르면 다른 투자자 목록이
//   같이 움직이는 것과 같은 조작이다.
//
// ⚠️ 등락률은 **토스 기준**이다. 계산식이 공개돼 있지 않고 우리 섹터 카드(거래대금 상위 20종
//   중앙값)와 다르다 — 실측(양자컴퓨터): 토스 +6.58% vs 중앙값 +6.24% · 시총가중 +6.38%.
//   그래서 화면에 '토스 기준' 을 못박는다. 두 숫자를 같은 눈으로 읽으면 안 된다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTossTicsRanking,
  type TicsCategory, type TicsDuration, type TicsNation, type TicsSort,
} from "../lib/api";
import { signColor } from "../lib/format";
import { TicsStockDialog } from "./TicsStockDialog";

const DURATIONS: { key: TicsDuration; label: string }[] = [
  { key: "1d", label: "1일" }, { key: "1w", label: "1주" }, { key: "1m", label: "1개월" },
  { key: "3m", label: "3개월" }, { key: "1y", label: "1년" },
];
const SORTS: { key: TicsSort; label: string }[] = [
  { key: "FLUCTUATION_RATE", label: "등락률" },
  { key: "TRADING_AMOUNT", label: "거래대금" },
];

function fmtEok(won: number): string {
  if (!(won > 0)) return "—";
  const eok = won / 1e8;
  if (eok >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

// ─── 한쪽 목록 ────────────────────────────────────────────────────────────
function TicsList({ nation, items, selected, onSelect, onOpen, bothOnly, common }: {
  nation: TicsNation;
  items: TicsCategory[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  onOpen: (cat: TicsCategory) => void;
  bothOnly: boolean;
  common: Set<string>;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  // 반대쪽에서 고른 이름이 이 목록에선 스크롤 밖일 수 있다 → 보이는 곳까지 끌어온다.
  //   매매동향과 같은 규칙: block:"nearest" 라 이미 보이면 안 움직인다(화면이 덜 흔들린다).
  useEffect(() => {
    if (!selected) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tics="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // ★ 순위는 거르기 전 원래 순위를 유지한다 — 걸러진 목록의 1,2,3 은 거짓이다.
  const rows = items
    .map((c, i) => ({ c, rank: i + 1 }))
    .filter(x => !bothOnly || common.has(x.c.name));

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 border-b border-gray-200 pb-1 mb-1">
        <span className={`text-xs font-bold ${nation === "KR" ? "text-blue-800" : "text-emerald-800"}`}>
          {nation === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"}
        </span>
        <span className="text-[10px] text-gray-400">{rows.length}개 분류</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-gray-400">표시할 분류가 없습니다</div>
      ) : (
        <ul ref={listRef}
            className="space-y-0.5 max-h-[420px] overflow-y-auto pr-1 border border-gray-100 rounded p-1">
          {rows.map(({ c, rank }) => {
            const isSel = selected === c.name;
            const isCommon = common.has(c.name);
            return (
              <li key={c.ticsId} data-tics={c.name}
                  onClick={() => onSelect(isSel ? null : c.name)}
                  className={`flex items-center gap-1.5 px-1 py-1 rounded cursor-pointer transition-colors
                              ${isSel ? "bg-amber-200 ring-1 ring-amber-500"
                                : isCommon ? "hover:bg-gray-50"
                                : "opacity-60 hover:bg-gray-50"}`}>
                <span className="w-5 shrink-0 text-[10px] tabular-nums text-gray-400 text-right">{rank}</span>
                {c.imageUrl && (
                  <img src={c.imageUrl} alt="" loading="lazy"
                       className="w-4 h-4 rounded shrink-0 bg-gray-100" />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-xs font-medium text-gray-800">
                    {c.name}
                    {/* 반대쪽에 같은 이름이 없으면 비교가 안 된다 — 흐리게 + 표시 */}
                    {!isCommon && <span className="ml-1 text-[9px] text-gray-400">한쪽만</span>}
                  </span>
                  <span className="block truncate text-[10px] text-gray-500">
                    {c.stockCount}종
                    {c.leaderName && ` · ${c.leaderName}`}
                    {c.leaderSignal && <span className="text-amber-700"> · {c.leaderSignal}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block text-xs font-bold tabular-nums ${signColor(c.pct)}`}>
                    {c.pct > 0 ? "+" : ""}{c.pct.toFixed(2)}%
                  </span>
                  <span className="block text-[10px] tabular-nums text-gray-400">
                    {fmtEok(c.tradingAmountKrw)}
                  </span>
                </span>
                <button type="button"
                        onClick={e => { e.stopPropagation(); onOpen(c); }}
                        title={`${c.name} 구성종목`}
                        className="shrink-0 text-[11px] leading-none px-0.5 opacity-50
                                   hover:opacity-100 transition-opacity">📋</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── 선택 요약 — 한·미를 한 줄에 놓는다 ────────────────────────────────────
function CompareBar({ name, kr, us, onClear }: {
  name: string;
  kr?: { cat: TicsCategory; rank: number };
  us?: { cat: TicsCategory; rank: number };
  onClear: () => void;
}) {
  const side = (label: string, hit?: { cat: TicsCategory; rank: number }) => (
    <span className="text-[11px] tabular-nums">
      <span className="text-gray-500">{label}</span>{" "}
      {hit ? (
        <>
          <span className={`font-bold ${signColor(hit.cat.pct)}`}>
            {hit.cat.pct > 0 ? "+" : ""}{hit.cat.pct.toFixed(2)}%
          </span>
          <span className="text-gray-400"> ({hit.rank}위 · {hit.cat.stockCount}종)</span>
        </>
      ) : <span className="text-gray-400">해당 분류 없음</span>}
    </span>
  );
  const gap = kr && us ? kr.cat.pct - us.cat.pct : undefined;
  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap rounded border border-amber-300
                    bg-amber-50 px-2 py-1 mb-1.5">
      <span className="text-xs font-bold text-gray-900">{name}</span>
      {side("🇰🇷", kr)}
      {side("🇺🇸", us)}
      {gap != null && (
        <span className="text-[11px] tabular-nums">
          <span className="text-gray-500">한−미</span>{" "}
          <span className={`font-bold ${signColor(gap)}`}>
            {gap > 0 ? "+" : ""}{gap.toFixed(2)}%p
          </span>
        </span>
      )}
      <button onClick={onClear}
              className="ml-auto px-1.5 py-0.5 rounded border border-amber-400 bg-white
                         text-[11px] text-amber-700 font-medium hover:bg-amber-100">해제</button>
    </div>
  );
}

export function TicsCompareTab({ onOpenValuation }: {
  onOpenValuation?: (ticker: string, name: string) => void;
} = {}) {
  const [duration, setDuration] = useState<TicsDuration>("1d");
  const [sortBy, setSortBy] = useState<TicsSort>("FLUCTUATION_RATE");
  const [selected, setSelected] = useState<string | null>(null);
  const [bothOnly, setBothOnly] = useState(true);   // 비교가 목적이라 공통만 보기가 기본
  const [dlg, setDlg] = useState<{ cat: TicsCategory; nation: TicsNation } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["tics-compare", duration, sortBy],
    queryFn: async () => {
      const [kr, us] = await Promise.all([
        fetchTossTicsRanking("KR", duration, sortBy),
        fetchTossTicsRanking("US", duration, sortBy),
      ]);
      return { kr, us };
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const krItems = data?.kr.items ?? [];
  const usItems = data?.us.items ?? [];
  const common = useMemo(() => {
    const krNames = new Set(krItems.map(c => c.name));
    return new Set(usItems.filter(c => krNames.has(c.name)).map(c => c.name));
  }, [krItems, usItems]);

  const hitOf = (items: TicsCategory[], name: string | null) => {
    if (!name) return undefined;
    const i = items.findIndex(c => c.name === name);
    return i >= 0 ? { cat: items[i], rank: i + 1 } : undefined;
  };

  return (
    <div className="space-y-2 pt-2">
      <div className="bg-emerald-50/40 border border-emerald-100 rounded p-2.5 text-xs text-gray-700 leading-relaxed">
        <div className="font-bold text-gray-900 mb-0.5">🌏 한·미 섹터 비교</div>
        토스가 한국과 미국에 <b>같은 한글 분류</b>를 써서, 이름만으로 양쪽을 맞출 수 있습니다.
        한쪽 분류를 클릭하면 반대쪽의 같은 분류로 스크롤합니다 —
        <b> 미국에서 오른 섹터가 한국엔 뭐가 있는지</b> 바로 볼 수 있습니다.
        <br />
        <span className="text-[11px] text-gray-500">
          공통 분류 {common.size}개 ·{" "}
          <span className="text-amber-600">등락률은 토스 기준입니다</span>
          (계산식이 공개돼 있지 않아 지수 탭의 섹터 카드와 숫자가 다릅니다)
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <button type="button" onClick={() => setBothOnly(v => !v)}
                  title="한국·미국 양쪽에 다 있는 분류만 남깁니다"
                  className={`px-2 py-0.5 rounded border font-bold transition ${
                    bothOnly ? "bg-gray-800 text-white border-gray-800"
                             : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            🔗 공통만
          </button>
          <span className="text-gray-400">순위는 거르기 전 원래 순위입니다 · 📋 를 누르면 구성종목</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex rounded-md border border-gray-300 overflow-hidden">
          {SORTS.map(x => (
            <button key={x.key} onClick={() => setSortBy(x.key)}
                    className={`px-2.5 py-1 text-xs font-bold transition border-l first:border-l-0 border-gray-300 ${
                      sortBy === x.key ? "bg-white text-gray-900 shadow-sm"
                                       : "bg-gray-100 text-gray-500 hover:bg-gray-50"}`}>
              {x.label}
            </button>
          ))}
        </span>
        <span className="ml-auto inline-flex rounded-md border border-gray-300 overflow-hidden">
          {DURATIONS.map(x => (
            <button key={x.key} onClick={() => setDuration(x.key)}
                    className={`px-2.5 py-1 text-xs font-bold transition border-l first:border-l-0 border-gray-300 ${
                      duration === x.key ? "bg-white text-gray-900 shadow-sm"
                                         : "bg-gray-100 text-gray-500 hover:bg-gray-50"}`}>
              {x.label}
            </button>
          ))}
        </span>
      </div>

      {isError ? (
        <div className="py-10 text-center text-sm text-rose-700">
          데이터를 가져오지 못했습니다 — {(error as Error)?.message}
          <button onClick={() => void refetch()}
                  className="ml-2 px-2 py-0.5 rounded bg-gray-800 text-white text-xs">다시 시도</button>
        </div>
      ) : isLoading && !data ? (
        <div className="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
      ) : (
        <>
          {selected && (
            <CompareBar name={selected}
                        kr={hitOf(krItems, selected)} us={hitOf(usItems, selected)}
                        onClear={() => setSelected(null)} />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <TicsList nation="KR" items={krItems} selected={selected} onSelect={setSelected}
                      onOpen={cat => setDlg({ cat, nation: "KR" })}
                      bothOnly={bothOnly} common={common} />
            <TicsList nation="US" items={usItems} selected={selected} onSelect={setSelected}
                      onOpen={cat => setDlg({ cat, nation: "US" })}
                      bothOnly={bothOnly} common={common} />
          </div>
        </>
      )}

      {dlg && (
        <TicsStockDialog cat={dlg.cat} nation={dlg.nation} onClose={() => setDlg(null)}
                         onOpenValuation={onOpenValuation} />
      )}
    </div>
  );
}
