// 투자자별 순매수/순매도 종목 랭킹 — 독립 탭(가치표 다음).
//  컬럼 = 투자자(외국인·기관), 각 컬럼 안에 순매수/순매도를 같이 놓는다.
//  ⚠️ 수급은 제로섬이라 한쪽 방향만 보여주면 컬럼 간 비교가 안 된다 → 양방향 동시 나열.
//
//  ★ 2026-09-12 소스 교체: 토스 rankings/by-investors → 네이버 trendForeignOrg.
//    토스는 **전체 시장·당일** 고정이다(market·period 류 파라미터를 넣어도 전부 무시하고
//    같은 결과를 준다 — 실측). 코스피/코스닥 분리와 주·월 누적을 쓰려고 네이버로 옮겼다.
//    대신 **개인이 없다** — 엔드포인트 이름부터 ForeignOrg 고, INDIVIDUAL·RETAIL 등
//    8가지 값을 다 시도해도 400 이다. 개인 컬럼은 포기한 결정이다.
//  ⚠️ 상위 N 종목만 준다 — 시장 전체 순매수 합계와 다르다(중간 순위가 빠진다).
//    실측(2026-09-11 코스피 기관): 전체 −12,184억 vs 상위 100 합 −18,064억.
import { useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchInvestorRankingsByMarket, FLOW_RANK_MAX,
  type InvestorFlowGroup, type InvestorFlowRow, type FlowRankMarket, type FlowRankPeriod,
  type FlowRankTrade,
} from "../lib/api";
import { signColor } from "../lib/format";

// 한 방향에 보여줄 종목 수. 엔드포인트는 size 만큼 무제한으로 주지만(size=3000 이면 2.2MB)
// 1분 폴링에 얹을 무게가 아니라 100 으로 받고 100 을 그대로 쓴다(=버리는 데이터 없음).
const ROWS = FLOW_RANK_MAX;

const MARKETS: { key: FlowRankMarket; label: string }[] = [
  { key: "KOSPI", label: "코스피" },
  { key: "KOSDAQ", label: "코스닥" },
];
// QUARTER·YEAR 등은 400 이다 — 3개월은 THREE_MONTH 다(실측).
const PERIODS: { key: FlowRankPeriod; label: string }[] = [
  { key: "DAY", label: "1일" },
  { key: "WEEK", label: "1주" },
  { key: "MONTH", label: "1개월" },
  { key: "THREE_MONTH", label: "3개월" },
];
// "20260911" → "2026. 9. 11."
// INTEGRATED 는 KRX+NXT 합과 안 맞아 노출하지 않는다(api.ts 주석 참고).
const TRADES: { key: FlowRankTrade; label: string }[] = [
  { key: "KRX", label: "KRX" },
  { key: "NXT", label: "NXT" },
];
const ymd = (s: string) =>
  s.length === 8 ? `${s.slice(0, 4)}. ${+s.slice(4, 6)}. ${+s.slice(6, 8)}.` : s;
const EMPTY: Set<string> = new Set();

// 순매수 금액 — 억원 단위, 1조 이상은 "n조 n,nnn억"
function fmtAmount(won: number): string {
  const eokTotal = Math.round(Math.abs(won) / 1e8);
  const jo = Math.floor(eokTotal / 10000);
  const eok = eokTotal % 10000;
  if (jo > 0) return `${jo}조 ${eok.toLocaleString()}억`;
  return `${eokTotal.toLocaleString()}억`;
}

// 선택 종목이 이 투자자에서 어느 방향에 몇 위로 있는지 (없으면 null)
interface Found { side: "buy" | "sell"; amount: number; rank: number; name: string }
function findTicker(g: InvestorFlowGroup, ticker: string): Found | null {
  const bi = g.buy.findIndex(r => r.ticker === ticker);
  if (bi >= 0) return { side: "buy", amount: g.buy[bi].amount, rank: bi + 1, name: g.buy[bi].name };
  const si = g.sell.findIndex(r => r.ticker === ticker);
  if (si >= 0) return { side: "sell", amount: g.sell[si].amount, rank: si + 1, name: g.sell[si].name };
  return null;
}

// 한 방향 목록 — 선택 종목은 배경 강조 + 스크롤 밖이면 끌어온다.
interface FlowListProps {
  rows: InvestorFlowRow[];
  side: "buy" | "sell";
  selected: string | null;
  onSelect: (t: string | null) => void;
  /** 외국인·기관이 같은 방향으로 함께 잡은 종목(쌍끌이) — 이 목록의 방향에 해당하는 것만 */
  bothWay: Set<string>;
  /** 쌍끌이만 보기 */
  onlyBoth: boolean;
}
function FlowList({ rows, side, selected, onSelect, bothWay, onlyBoth }: FlowListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  // ★ 순위는 거르기 전 원래 순위를 유지한다 — 걸러진 목록의 1,2,3 은 거짓이다.
  const items = rows
    .map((r, i) => ({ r, rank: i + 1 }))
    .filter(x => !onlyBoth || bothWay.has(x.r.ticker));
  const total = items.reduce((a, x) => a + Math.abs(x.r.amount), 0);

  // 다른 컬럼에서 고른 종목이 이 목록에선 스크롤 밖일 수 있다 → 보이는 곳까지.
  //  block:"nearest" — 이미 보이면 안 움직여서 화면이 덜 흔들린다.
  useEffect(() => {
    if (!selected) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-ticker="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const buy = side === "buy";
  return (
    <div>
      <div className="flex items-baseline gap-1.5 mt-1.5 mb-0.5">
        <span className={`text-[11px] font-bold ${buy ? "text-rose-600" : "text-blue-600"}`}>
          {buy ? "순매수" : "순매도"}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-gray-500">{fmtAmount(total)}</span>
      </div>
      {items.length === 0 ? (
        <div className="py-4 text-center text-[11px] text-gray-400">
          {onlyBoth ? `동시 ${buy ? "매수" : "매도"} 종목 없음` : "데이터 없음"}
        </div>
      ) : (
        <ul ref={listRef}
            className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1
                       border border-gray-100 rounded p-1">
          {items.map(({ r, rank }) => (
            <li key={r.ticker} data-ticker={r.ticker}
                onClick={() => onSelect(selected === r.ticker ? null : r.ticker)}
                className={`flex items-center gap-1.5 px-1 py-1 rounded cursor-pointer transition-colors
                            ${selected === r.ticker
                              ? "bg-amber-200 ring-1 ring-amber-500"
                              : bothWay.has(r.ticker)
                                ? (buy ? "bg-rose-50/70 hover:bg-rose-100" : "bg-blue-50/70 hover:bg-blue-100")
                                : "hover:bg-gray-50"}`}>
              <span className="w-6 shrink-0 text-[10px] tabular-nums text-gray-400 text-right">{rank}</span>
              {r.logo && (
                <img src={r.logo} alt="" loading="lazy"
                     className="w-4 h-4 rounded-full shrink-0 bg-gray-100" />
              )}
              <span className="flex-1 min-w-0">
                <span className={`block truncate text-xs ${
                  bothWay.has(r.ticker)
                    ? (buy ? "font-bold text-rose-700" : "font-bold text-blue-700")
                    : "font-medium text-gray-800"}`}>{r.name}</span>
                <span className="block text-[10px] tabular-nums text-gray-500">
                  {r.close.toLocaleString()}원{" "}
                  <span className={signColor(r.pct)}>
                    {r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%
                  </span>
                </span>
              </span>
              <span className={`shrink-0 text-[11px] font-bold tabular-nums
                                ${buy ? "text-rose-600" : "text-blue-600"}`}>
                {fmtAmount(r.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlowColumn({ group, investor, selected, onSelect, bothBuy, bothSell, onlyBoth }: {
  group: InvestorFlowGroup; investor: string;
  selected: string | null; onSelect: (t: string | null) => void;
  bothBuy: Set<string>; bothSell: Set<string>; onlyBoth: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 border-b border-gray-200 pb-1">
        <span className="text-xs font-bold text-gray-700">{investor}</span>
      </div>
      <FlowList rows={group.buy.slice(0, ROWS)} side="buy" selected={selected} onSelect={onSelect}
                bothWay={bothBuy} onlyBoth={onlyBoth} />
      <FlowList rows={group.sell.slice(0, ROWS)} side="sell" selected={selected} onSelect={onSelect}
                bothWay={bothSell} onlyBoth={onlyBoth} />
    </div>
  );
}

// 선택 종목 요약 — **그 시장 안에서만** 외국인·기관이 어느 방향으로 얼마인지.
//  방향이 갈리는 종목(외국인 매수 ↔ 기관 매도)의 구도를 여기서 바로 읽는다.
//  시장별로 따로 두는 이유: 한 종목은 보통 한 시장에만 있어서, 코스피 종목을 고른 채
//  "코스닥 100위 밖" 을 읽을 이유가 없다. 선택 자체도 시장마다 독립이다.
interface SelectedCol { investor: string; group: InvestorFlowGroup }

function SelectedBar({ cols, selected, onClear }: {
  cols: SelectedCol[]; selected: string; onClear: () => void;
}) {
  const hits = cols.map(c => ({ investor: c.investor, f: findTicker(c.group, selected) }));
  const name = hits.find(h => h.f)?.f?.name ?? selected;
  return (
    <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap rounded border border-amber-300
                    bg-amber-50 px-2 py-1 mb-1.5">
      <span className="text-xs font-bold text-gray-900">{name}</span>
      <span className="text-[10px] text-gray-500 font-mono">{selected}</span>
      {hits.map(h => (
        <span key={h.investor} className="text-[11px] tabular-nums">
          <span className="text-gray-500">{h.investor}</span>{" "}
          {h.f ? (
            <span className={h.f.side === "buy" ? "text-rose-600 font-bold" : "text-blue-600 font-bold"}>
              {h.f.side === "buy" ? "순매수" : "순매도"} {fmtAmount(h.f.amount)}
              <span className="text-gray-400 font-normal"> ({h.f.rank}위)</span>
            </span>
          ) : (
            <span className="text-gray-400">{ROWS}위 밖</span>
          )}
        </span>
      ))}
      <button onClick={onClear}
              className="ml-auto px-1.5 py-0.5 rounded border border-amber-400 bg-white
                         text-[11px] text-amber-700 font-medium hover:bg-amber-100">
        해제
      </button>
    </div>
  );
}

export function InvestorFlowTab() {
  // 선택은 **시장별로 독립**이다. 코스피에서 고른 종목이 코스닥 선택을 지우면 안 된다 —
  //   두 시장을 나란히 놓고 각각 들여다보는 화면이라 서로를 건드리면 흐름이 끊긴다.
  //   같은 시장 안에서는 외국인·기관 네 목록이 함께 강조된다(그게 이 화면의 핵심).
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const pick = (sectionId: string, ticker: string | null) =>
    setSelected(prev => ({ ...prev, [sectionId]: ticker }));
  const [period, setPeriod] = useState<FlowRankPeriod>("DAY");
  const [trade, setTrade] = useState<FlowRankTrade>("KRX");
  const [onlyBoth, setOnlyBoth] = useState(false);   // 쌍끌이만 보기

  // 코스피·코스닥을 동시에 부른다 — 토글로 갈아끼우면 둘을 나란히 비교할 수 없다.
  const { data: res, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["investor-flow-ranking", period, trade],
    queryFn: async () => {
      const [kospi, kosdaq] = await Promise.all(
        MARKETS.map(m => fetchInvestorRankingsByMarket(m.key, period, trade, ROWS)),
      );
      return { kospi, kosdaq };
    },
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,   // 기간을 바꿀 때 목록이 사라졌다 나타나지 않게
  });

  // 시장으로 먼저 묶고 그 아래에 외국인·기관을 나란히 둔다.
  //   실제로 보는 순서가 "코스피에서 외국인과 기관이 어떻게 갈렸나" 라서,
  //   시장이 위에 오면 두 투자자를 바로 대조할 수 있다.
  const sections = res ? [
    { id: "kospi",  label: "코스피", cols: [
      { investor: "외국인", group: res.kospi.groups[0] },
      { investor: "기관",   group: res.kospi.groups[1] },
    ] },
    { id: "kosdaq", label: "코스닥", cols: [
      { investor: "외국인", group: res.kosdaq.groups[0] },
      { investor: "기관",   group: res.kosdaq.groups[1] },
    ] },
  ].filter(s => s.cols.every(c => !!c.group)) : [];
  const data = sections.flatMap(s => s.cols.map(c => c.group));

  // 쌍끌이 — 그 시장 안에서 외국인과 기관이 **같은 방향**으로 함께 잡은 종목.
  //   한쪽만 사는 건 흔하지만 둘이 겹치면 수급이 한쪽으로 몰렸다는 신호라 눈에 띄어야 한다.
  //   시장을 섞으면 안 된다 — 코스피 외국인과 코스닥 기관은 애초에 같은 종목을 볼 수 없다.
  const bothWays = new Map<string, { buy: Set<string>; sell: Set<string> }>();
  for (const s of sections) {
    const [fo, org] = s.cols.map(c => c.group);
    const inter = (a: InvestorFlowRow[], b: InvestorFlowRow[]) => {
      const bs = new Set(b.map(r => r.ticker));
      return new Set(a.filter(r => bs.has(r.ticker)).map(r => r.ticker));
    };
    bothWays.set(s.id, { buy: inter(fo.buy, org.buy), sell: inter(fo.sell, org.sell) });
  }

  const rg = res?.kospi.range;
  const range = rg?.from
    ? (rg.from === rg.to ? `${ymd(rg.to)} (전일) 기준` : `${ymd(rg.from)} ~ ${ymd(rg.to)} 기준`)
    : "";

  return (
    <div className="space-y-2 pt-2">
      <div className="bg-blue-50/40 border border-blue-100 rounded p-2.5 text-xs text-gray-700 leading-relaxed">
        <div className="font-bold text-gray-900 mb-0.5">👥 외국인 · 기관 매매 동향</div>
        투자자별 순매수·순매도 금액 순위입니다. 종목을 클릭하면 다른 투자자 목록에서도 같이 표시됩니다.
        <br />
        <span className="text-[11px] text-gray-500">
          네이버 · 방향별 상위 {ROWS}종목 ·{" "}
          <span className="text-amber-600">상위 {ROWS}종목만이라 시장 전체 합계와 다릅니다</span>
          (중간 순위 종목이 빠집니다) · 개인은 이 소스에 없습니다
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <button type="button" onClick={() => setOnlyBoth(v => !v)}
                  title="외국인과 기관이 같은 방향으로 함께 잡은 종목만 남깁니다"
                  className={`px-2 py-0.5 rounded border font-bold transition ${
                    onlyBoth ? "bg-gray-800 text-white border-gray-800"
                             : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            🔗 쌍끌이만
          </button>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-rose-50 border border-rose-200" />
            <b className="text-rose-700">동시 매수</b>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-blue-50 border border-blue-200" />
            <b className="text-blue-700">동시 매도</b>
          </span>
          <span className="text-gray-400">
            같은 시장·같은 방향만 · 순위는 거르기 전 원래 순위입니다
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {range && <span className="text-[11px] tabular-nums text-gray-500">{range}</span>}
        <span className="inline-flex ml-2 rounded-md border border-gray-300 overflow-hidden">
          {TRADES.map(x => (
            <button key={x.key} onClick={() => setTrade(x.key)}
                    title={x.key === "NXT" ? "넥스트레이드(대체거래소)" : "한국거래소 정규장"}
                    className={`px-2.5 py-1 text-xs font-bold transition border-l first:border-l-0 border-gray-300 ${
                      trade === x.key ? "bg-white text-gray-900 shadow-sm"
                                      : "bg-gray-100 text-gray-500 hover:bg-gray-50"}`}>
              {x.label}
            </button>
          ))}
        </span>
        <span className="ml-auto inline-flex rounded-md border border-gray-300 overflow-hidden">
          {PERIODS.map(x => (
            <button key={x.key} onClick={() => setPeriod(x.key)}
                    className={`px-3 py-1 text-xs font-bold transition border-l first:border-l-0 border-gray-300 ${
                      period === x.key ? "bg-white text-gray-900 shadow-sm"
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
      ) : !data || data.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">데이터가 없습니다.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-6">
          {sections.map(s => (
            <section key={s.id} className="min-w-0">
              <h3 className={`text-sm font-bold pb-1 mb-1.5 border-b-2 ${
                s.id === "kospi" ? "text-blue-800 border-blue-600" : "text-emerald-800 border-emerald-600"}`}>
                {s.label}
              </h3>
              {selected[s.id] && (
                <SelectedBar cols={s.cols} selected={selected[s.id] as string}
                             onClear={() => pick(s.id, null)} />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {s.cols.map(c => (
                  <FlowColumn key={c.investor} group={c.group} investor={c.investor}
                              selected={selected[s.id] ?? null}
                              onSelect={tk => pick(s.id, tk)}
                              bothBuy={bothWays.get(s.id)?.buy ?? EMPTY}
                              bothSell={bothWays.get(s.id)?.sell ?? EMPTY}
                              onlyBoth={onlyBoth} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
