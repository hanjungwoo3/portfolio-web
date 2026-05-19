import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrSectorEtfRanking, type KrSectorEtfRank,
  fetchKrSectorRanking, type KrSectorRankItem,
} from "../lib/api";
import { SectorBumpChart } from "./SectorBumpChart";
import { EtfCompositionDialog } from "./EtfCompositionDialog";

// 정렬 모드 — 3가지 관점:
// - amount: 거래대금 순위 (실제 자금 이동량)
// - pct: 등락률(%) 순위 (가격 변동 강도)
// - obv: 일별 상승/하락 부호 × close×volume 누적 (정밀 자금 유출입)
export type SortMode = "pct" | "amount" | "obv";

// 모드별 정렬 키 추출 (큰 값이 1위)
function sortKey(mode: SortMode, pct: number | null, amt: number | null, obv: number | null): number | null {
  if (mode === "pct") return pct;
  if (mode === "amount") return amt;
  return obv;
}

// 한국 섹터 순위 — 우리 KODEX/TIGER ETF 12개 기반 자체 ranking (4기간 활성).
// + 토스 TICS depth1 ranking (오늘만, 세분화된 leaf 분류) 도 보조로 표시.
// 색: 한국식 빨강=상승 / 파랑=하락.

type PeriodKey = "today" | "d5" | "d10" | "d20";
type AmountKey = "amountToday" | "amountD5" | "amountD10" | "amountD20";
type ObvKey = "obvToday" | "obvD5" | "obvD10" | "obvD20";
// 그래프 X축과 동일 순서 — 왼쪽=과거 → 오른쪽=오늘 (시간순)
const PERIODS: { key: PeriodKey; amtKey: AmountKey; obvKey: ObvKey; label: string; sub: string }[] = [
  { key: "d20",   amtKey: "amountD20",   obvKey: "obvD20",   label: "20일", sub: "1달" },
  { key: "d10",   amtKey: "amountD10",   obvKey: "obvD10",   label: "10일", sub: "2주" },
  { key: "d5",    amtKey: "amountD5",    obvKey: "obvD5",    label: "5일",  sub: "1주" },
  { key: "today", amtKey: "amountToday", obvKey: "obvToday", label: "오늘", sub: "1일" },
];

// 거래대금/흐름 단축 — 원 → 억/조 만 (만 단위 생략, 1억 미만은 소수점 억)
function fmtAmount(amt: number | null): string {
  if (amt == null || !Number.isFinite(amt)) return "";
  const sign = amt < 0 ? "-" : "";
  const abs = Math.abs(amt);
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
  if (abs >= 1e8)  return `${sign}${Math.round(abs / 1e8).toLocaleString()}억`;
  if (abs >= 1e7)  return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs > 0)     return `${sign}<0.1억`;
  return "0원";
}

function pctColor(pct: number | null): string {
  if (pct == null) return "text-gray-400";
  if (pct > 0) return "text-rose-600";
  if (pct < 0) return "text-blue-600";
  return "text-gray-500";
}
// 그래프 SectorBumpChart 와 동일 12색 팔레트 (Tableau)
const PALETTE_12 = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
  "#9467bd", "#8c564b", "#e377c2", "#17becf",
  "#bcbd22", "#e7ba52", "#ad494a", "#a55194",
];
function tickerColor(index: number, _total: number, isMarket?: boolean): string {
  if (isMarket) return "#d1d5db";  // gray-300 (연한 회색)
  return PALETTE_12[index % PALETTE_12.length];
}

function rankBg(rank: number): string {
  if (rank <= 3) return "bg-amber-50 border-amber-200";
  if (rank <= 5) return "bg-rose-50/30 border-rose-100";
  return "bg-white border-gray-200";
}

interface EtfColumnProps {
  period: PeriodKey;
  amtKey: AmountKey;
  obvKey: ObvKey;
  label: string;
  sub: string;
  ranks: KrSectorEtfRank[];
  loading: boolean;
  sortMode: SortMode;
  hoverTicker: string | null;
  onHover: (ticker: string | null) => void;
  onOpenEtf: (etf: KrSectorEtfRank) => void;
}
function EtfColumn({ period, amtKey, obvKey, label, sub, ranks, loading, sortMode,
                     hoverTicker, onHover, onOpenEtf }: EtfColumnProps) {
  // 정렬 모드(sortMode)에 따라 sortKey 사용 — pct / amount / mixed / obv
  const sorted = [...ranks]
    .map(r => ({ r, key: sortKey(sortMode, r[period], r[amtKey], r[obvKey]) }))
    .filter(x => x.key != null)
    .sort((a, b) => b.key! - a.key!)
    .map(x => x.r);

  // 칼럼 너비 — 고정 (세로 정렬 일관성), 종목명만 최소 폭 보장
  const GRID_COLS = "1.25rem minmax(4rem,1fr) 4rem 4rem 5rem";
  return (
    <div className="min-w-0">
      <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-2 py-1.5">
        <div className="text-sm font-bold text-gray-800">{label}</div>
        <div className="text-[10px] text-gray-500">{sub} 기준</div>
      </div>
      {/* 컬럼 항목 헤더 — 각 row 와 동일한 grid template 으로 정렬 */}
      <div className="grid items-center gap-x-1 px-2 py-1 mt-1
                      text-[10px] font-semibold text-gray-500
                      border-b border-gray-200"
           style={{ gridTemplateColumns: GRID_COLS }}>
        <span></span>
        <span className="truncate">섹터(ETF)</span>
        <span className="text-right whitespace-nowrap">거래대금</span>
        <span className="text-right whitespace-nowrap">등락률</span>
        <span className="text-right whitespace-nowrap">유입</span>
      </div>
      <div className="px-1 py-2 space-y-1.5">
        {loading ? (
          <div className="text-center text-xs text-gray-400 py-8">불러오는 중...</div>
        ) : sorted.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-8">데이터 없음</div>
        ) : (() => {
          // amber 강조는 "섹터 카운트" 기준 1~3위 → 시장 ETF 가 sorted 중간에 끼어도 영향 X
          let sectorCount = 0;
          return sorted.map((etf, i) => {
            const rank = i + 1;
            if (!etf.isMarket) sectorCount += 1;
            const sectorRank = etf.isMarket ? null : sectorCount;
            const pct = etf[period]!;
            const amt = etf[amtKey];
            const obv = etf[obvKey];
            // 그래프와 동일한 색 — 원본 ranks 의 index 기반
            const origIdx = ranks.findIndex(r => r.ticker === etf.ticker);
            const tColor = tickerColor(origIdx, ranks.length, etf.isMarket);
            // 시장 ETF = 회색 / 섹터 = sectorRank 기준 amber
            const cardBg = etf.isMarket
              ? "bg-gray-100 border-gray-300"
              : rankBg(sectorRank!);
            const isActive = hoverTicker === null || hoverTicker === etf.ticker;
            const isHovered = hoverTicker === etf.ticker;
            return (
              <div key={etf.ticker}
                   onMouseEnter={() => onHover(etf.ticker)}
                   onMouseLeave={() => onHover(null)}
                   className={`grid items-center gap-x-1 rounded border px-2 py-1.5
                               text-xs tabular-nums transition-opacity
                               ${cardBg}
                               ${isActive ? "opacity-100" : "opacity-30"}
                               ${isHovered ? "ring-2 ring-blue-300" : ""}`}
                   style={{ gridTemplateColumns: GRID_COLS }}>
                <div className="flex items-center justify-center w-5 h-5 rounded
                                font-bold text-gray-800 bg-white border border-gray-300">
                  {rank}
                </div>
                <button onClick={() => onOpenEtf(etf)}
                        title={`${etf.fullName ?? etf.name} — 구성 종목 보기`}
                        className="text-left font-bold truncate min-w-0 hover:underline"
                        style={{ color: tColor }}>
                  {etf.name}
                </button>
                <span className="text-right text-gray-700"
                      title="거래대금 (실제 자금 이동량)">
                  {amt != null ? fmtAmount(amt) : "—"}
                </span>
                <span className={`text-right font-bold ${pctColor(pct)}`}
                      title="등락률 (가격 변동 강도)">
                  {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                </span>
                <span className={`text-right font-semibold ${pctColor(obv)}`}
                      title="유입: 상승일 +volume·하락일 −volume 누적 (OBV-like) — 정밀 자금 유출입 추정">
                  {obv != null ? fmtAmount(obv) : "—"}
                </span>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

function TossDepth1Section({ data, loading }: { data: KrSectorRankItem[] | undefined; loading: boolean }) {
  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="text-sm font-bold text-gray-800 mb-1">
        🔎 토스 세부 테마 — 오늘 TOP 10
      </div>
      <div className="text-[10px] text-gray-500 mb-2">
        토스 TICS depth1 (세분화 분류 425+ 중) · 자금이 몰리는 핫 테마 참고
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        {loading ? (
          <div className="col-span-full text-center text-xs text-gray-400 py-4">불러오는 중...</div>
        ) : !data || data.length === 0 ? (
          <div className="col-span-full text-center text-xs text-gray-400 py-4">데이터 없음</div>
        ) : (
          data.slice(0, 10).map(item => (
            <div key={item.ticsId}
                 className={`flex items-center gap-1.5 rounded border px-1.5 py-1
                             ${rankBg(item.ranking)}`}>
              <div className="flex items-center justify-center w-5 h-5 shrink-0 rounded-full
                              text-[10px] font-bold text-gray-800 bg-white border border-gray-300">
                {item.ranking}
              </div>
              <div className="flex-1 min-w-0 text-[11px] font-medium text-gray-900 truncate">
                {item.title}
              </div>
              <div className={`shrink-0 text-[11px] font-bold tabular-nums
                               ${item.pct > 0 ? "text-rose-600" : item.pct < 0 ? "text-blue-600" : "text-gray-500"}`}>
                {item.pct >= 0 ? "+" : ""}{item.pct.toFixed(1)}%
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const SORT_LABELS: Record<SortMode, string> = {
  pct: "등락률",
  amount: "거래대금",
  obv: "유입",
};
const SORT_HINTS: Record<SortMode, string> = {
  pct: "가격 변동 강도 기준",
  amount: "실제 자금 이동량 기준",
  obv: "상승일·하락일 부호 누적 (OBV) — 정밀 자금 유출입",
};

interface SectorRankingTabProps {
  onRequestSearch?: (query: string) => void;  // ETF 모달 "+추가" → SearchDialog 오픈
}
export function SectorRankingTab({ onRequestSearch }: SectorRankingTabProps = {}) {
  const [sortMode, setSortMode] = useState<SortMode>("obv");
  const [hoverTicker, setHoverTicker] = useState<string | null>(null);
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);

  const { data: etfRanks, isLoading: etfLoading } = useQuery({
    queryKey: ["kr-sector-etf-ranking"],
    queryFn: fetchKrSectorEtfRanking,
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  const { data: tossRanks, isLoading: tossLoading } = useQuery({
    queryKey: ["kr-sector-toss-ranking"],
    queryFn: fetchKrSectorRanking,
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  return (
    <div className="space-y-2">
      <div className="bg-blue-50/40 border border-blue-100 rounded p-2.5 text-xs text-gray-700 leading-relaxed">
        <div className="font-bold text-gray-900 mb-0.5">🏷 한국 섹터 ETF 순위 — 돈의 흐름</div>
        같은 섹터가 컬럼 사이에서 순위가 올라가면 자금이 그쪽으로 몰리고 있다는 신호입니다.
        <br />
        <span className="text-[11px] text-gray-500">
          시장 ETF(KODEX 200·KODEX 코스닥150) + 섹터 ETF 12개 · Yahoo 일별 종가 기반 · 1분 자동 갱신
        </span>
      </div>

      {/* 정렬 모드 토글 — 그래프 + 표 모두 동일 기준으로 동기화 */}
      <div className="flex items-center gap-1 flex-wrap text-xs">
        <span className="text-gray-500 mr-1">정렬:</span>
        {(["amount", "pct", "obv"] as const).map(m => (
          <button key={m}
                  onClick={() => setSortMode(m)}
                  title={SORT_HINTS[m]}
                  className={`px-2 py-0.5 rounded border font-medium
                              ${sortMode === m
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>
            {SORT_LABELS[m]}
          </button>
        ))}
        <span className="ml-2 text-[11px] text-gray-500">{SORT_HINTS[sortMode]}</span>
      </div>

      {/* 그래프 + 4 컬럼 — 동일한 min-width(84rem) 안에서 같이 가로 스크롤되도록 wrapper 통합 */}
      <div className="sm:overflow-x-auto">
        <div className="sm:min-w-[84rem]">
          {/* 순위 변동 Bump Chart — 4기간 순위 변화 */}
          {!etfLoading && etfRanks && etfRanks.length > 1 && (
            <SectorBumpChart ranks={etfRanks} sortMode={sortMode}
                             hoverTicker={hoverTicker} onHover={setHoverTicker}
                             onOpenEtf={(etf) => setEtfDialog({ ticker: etf.ticker, name: etf.fullName ?? etf.name })} />
          )}
          {/* 4 컬럼 배치 — 각 섹션 최소 21rem */}
          <div className="grid grid-cols-1 gap-3 sm:gap-6 sm:grid-cols-[repeat(4,minmax(21rem,1fr))]">
            {PERIODS.map(p => (
              <EtfColumn key={p.key}
                         period={p.key} amtKey={p.amtKey} obvKey={p.obvKey}
                         label={p.label} sub={p.sub}
                         ranks={etfRanks ?? []} loading={etfLoading}
                         sortMode={sortMode}
                         hoverTicker={hoverTicker} onHover={setHoverTicker}
                         onOpenEtf={(etf) => setEtfDialog({ ticker: etf.ticker, name: etf.fullName ?? etf.name })} />
            ))}
          </div>
        </div>
      </div>

      {/* 토스 세부 테마 — 별도 섹션 (보조 정보) */}
      <TossDepth1Section data={tossRanks} loading={tossLoading} />

      {/* ETF 구성 종목 모달 */}
      {etfDialog && (
        <EtfCompositionDialog isOpen={true}
                              ticker={etfDialog.ticker} etfName={etfDialog.name}
                              onClose={() => setEtfDialog(null)}
                              onRequestSearch={onRequestSearch ? (q) => {
                                setEtfDialog(null);   // 모달 닫고
                                onRequestSearch(q);   // SearchDialog 오픈
                              } : undefined} />
      )}
    </div>
  );
}
