// ETF 랭킹 — 전체 ETF(색인 828종)를 등락률로 줄 세워 상위/하위를 보여준다.
//
// 조회는 6 프록시 콜이라 폴링하지 않는다. 캐시가 없을 때 1회 자동 조회하고,
// 그 뒤로는 "새로고침" 버튼을 누를 때만 다시 받는다. (etfRanking.ts 주석 참고)
//
// 맨 위 '섹터별 흐름' 은 같은 조회 결과를 이름으로 묶은 것이라 추가 호출이 없다(etfSectors.ts).
//   섹터를 누르면 아래 목록이 그 섹터의 대표 ETF(거래대금 순)로 바뀐다 —
//   상·하위 100 에 안 걸리는 종목도 보려면 이 경로여야 한다.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { signColor } from "../lib/format";
import { fetchKrPriceHistory } from "../lib/api";
import type { Price } from "../types";
import { StockCard } from "./EtfCompositionDialog";
import { EtfStatsBox } from "./EtfStatsBox";
import {
  fetchEtfRanking, loadCachedRanking, isLeverageEtf, isFuturesEtf, RANK_SHOW, RANK_KEEP,
  type EtfRanking, type EtfRankRow,
} from "../lib/etfRanking";
import { EtfSectorFlow } from "./EtfSectorFlow";
import { UsRankingPanel } from "./UsRankingPanel";
import { useEtfReturns, PERIOD_LABEL, type ReturnPeriod } from "../lib/etfReturns";

interface Props {
  onOpenEtfComposition?: (code: string, name: string) => void;
}

type Side = "top" | "bottom";
// 기간 — "today" 는 실시간 시세(스냅샷)로, 나머지는 크롤러가 심어 둔 값으로 줄 세운다.
type Period = "today" | ReturnPeriod;

function fmtStamp(ms: number): string {
  // 조회 시각 — KST 기준 HH:MM (사용자 OS 시간대 무관)
  const d = new Date(ms + 9 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

interface State {
  ranking: EtfRanking | null;
  loading: boolean;
  err: string | null;
}

// 랭킹 카드 — ETF 검색·구성 팝업과 **같은 리치 카드**(EtfCompositionDialog 의 StockCard).
//   화면마다 다른 카드를 쓰면 같은 ETF 가 탭마다 다르게 보인다.
//
// 배경 추세(3개월 일봉)는 뷰포트에 들어온 카드만 지연 조회한다 — 전체 시세는 6콜 배치지만
//   종목별 차트는 개별 호출이라, 50장을 한꺼번에 부르면 호출수 병목에 그대로 걸린다.
function RankCard({ row, rank, period, periodPct, onOpenEtfComposition, tradeDate }: {
  row: EtfRankRow;
  rank: number;
  period: Period;
  periodPct?: number;      // 줄 세운 기준 값 — 기간 탭일 때만(오늘이면 큰 숫자가 곧 기준이다)
  tradeDate: string;
  onOpenEtfComposition?: (code: string, name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { rootMargin: "150px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { data } = useQuery({
    queryKey: ["etf-rank-spark", row.code],
    queryFn: () => fetchKrPriceHistory(row.code, "3mo"),
    enabled: inView,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
  // 랭킹 스냅샷은 Price 전체가 아니라 필요한 값만 담고 있다 — 카드가 쓰는 모양으로 맞춰 준다.
  const price: Price = {
    ticker: row.code, price: row.price, base: row.base, prevClose: row.base,
    open: 0, volume: row.volume, trade_date: tradeDate,
  };
  return (
    <div ref={ref}>
      <StockCard i={0} item={{ stockCode: row.code, name: `${row.name} (${row.code})`, ratio: 0 }} hideRatio
                 price={price} chart={(data ?? []).map(p => p.close)}
                 highlightDay={period === "today"}
                 boxMinH="min-h-[92px]"
                 actionLeft={onOpenEtfComposition ? (
                   <button onClick={e => { e.preventDefault(); e.stopPropagation(); onOpenEtfComposition(row.code, row.name); }}
                           title={`${row.name} 구성종목 보기`}
                           className="px-1.5 py-0.5 rounded-t-md text-[10px] font-bold leading-none
                                      bg-amber-50 text-amber-700 border-t border-l border-r border-amber-300
                                      hover:bg-amber-100">
                     🍱
                   </button>
                 ) : undefined}
                 rightTag={
                   <div className="border border-gray-300 rounded px-1 py-0 leading-tight tabular-nums
                                   text-[11px] font-bold bg-white whitespace-nowrap text-gray-600">
                     {rank}위
                   </div>
                 }
                 centerTag={period !== "today" && periodPct !== undefined ? (
                   // 큰 숫자는 '오늘' 이다. 기간 탭으로 줄 세웠을 땐 그 기준값을 따로 적어 줘야
                   //   왜 이 순서인지 읽힌다(1년 정렬인데 오늘 −0.3% 인 카드가 1위일 수 있다).
                   <div className={`border border-gray-300 rounded px-1.5 py-0 leading-tight tabular-nums
                                    text-[11px] font-bold bg-white whitespace-nowrap ${signColor(periodPct)}`}>
                     {PERIOD_LABEL[period]} {periodPct > 0 ? "+" : ""}{periodPct.toFixed(2)}%
                   </div>
                 ) : undefined}
                 boxRight={
                   <EtfStatsBox code={row.code} volume={row.volume}
                                highlight={period === "today" ? undefined : period} />
                 } />
    </div>
  );
}

export function EtfRankingTab({ onOpenEtfComposition }: Props) {
  // 캐시가 있으면 그대로 쓰고, 없으면 loading=true 로 시작해 마운트 직후 자동 1회 조회.
  // (이펙트 본문에서 setState 를 동기 호출하지 않기 위해 초기값에서 결정한다)
  const [state, setState] = useState<State>(() => {
    const cached = loadCachedRanking();
    return { ranking: cached, loading: cached === null, err: null };
  });
  const [side, setSide] = useState<Side>("top");
  const [period, setPeriod] = useState<Period>("today");
  // 시장 전환 — 한국은 크롤러가 심어 둔 기간 수익률, 미국은 TradingView 스캐너 1콜.
  const [market, setMarket] = useState<"kr" | "us">("kr");
  // 기간 파일은 기간 탭을 누를 때만 받는다 — '오늘' 만 볼 사용자는 아예 안 받는다.
  const returnData = useEtfReturns(period !== "today");
  const [expanded, setExpanded] = useState(false);
  const [hideLeverage, setHideLeverage] = useState(true);   // 레버리지 ETF 제외 (기본 ON)
  const [hideFutures, setHideFutures] = useState(true);     // 선물 ETF 제외 (기본 ON)
  const [sector, setSector] = useState<string | null>(null);  // 고른 섹터 — null 이면 전체 랭킹
  const [sectorOpen, setSectorOpen] = useState(true);
  const { ranking, loading, err } = state;

  const run = (alive: () => boolean) =>
    fetchEtfRanking()
      .then(r => { if (alive()) setState({ ranking: r, loading: false, err: null }); })
      .catch((e: unknown) => {
        if (!alive()) return;
        const msg = e instanceof Error ? e.message : "조회 실패";
        setState(s => ({ ...s, loading: false, err: msg }));
      });

  const refresh = () => {
    setState(s => ({ ...s, loading: true, err: null }));
    void run(() => true);
  };

  // 자동 조회는 캐시가 없을 때(=초기 loading) 단 1회. 이후엔 새로고침 버튼으로만.
  useEffect(() => {
    if (!state.loading) return;
    let alive = true;
    void run(() => alive);
    return () => { alive = false; };
    // 마운트 시 1회 — state.loading 을 deps 에 넣으면 새로고침마다 재실행된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectors = ranking?.sectors ?? [];
  const picked = sectors.find(s => s.key === sector) ?? null;
  // 화면에 쓸 등락률 — 오늘은 스냅샷의 pct, 기간은 크롤러 값. 없으면 undefined(정렬에서 뒤로).
  const pctOf = (r: EtfRankRow): number | undefined =>
    period === "today" ? r.pct : returnData?.returns[r.code]?.[period];
  // 섹터를 고르면 그 섹터의 대표 ETF(거래대금 상위)를 보여준다.
  //   전체 랭킹은 상·하위 100 만 남기므로, 가운데 있는 종목은 이 경로로만 볼 수 있다.
  //   ★ 기간 정렬은 상·하위 100 으로 하면 안 된다 — 그건 '오늘' 기준으로 잘린 목록이라
  //     1개월 상위가 그 안에 없을 수 있다. 그래서 섹터에 담긴 전수를 다시 모아 쓴다.
  const universe: EtfRankRow[] = picked
    ? picked.rows
    : period === "today"
      ? (ranking ? (side === "top" ? ranking.top : ranking.bottom) : [])
      : sectors.flatMap(sc => sc.rows);
  const allRows: EtfRankRow[] =
    picked || period !== "today"
      ? [...universe]
          .filter(r => pctOf(r) !== undefined)
          .sort((a, b) => {
            const x = pctOf(a)!, y = pctOf(b)!;
            return side === "top" ? y - x : x - y;
          })
      : universe;
  const rows = allRows.filter(r =>
    (!hideLeverage || !isLeverageEtf(r.name)) && (!hideFutures || !isFuturesEtf(r.name)));
  const shown = expanded ? rows.slice(0, RANK_KEEP) : rows.slice(0, RANK_SHOW);

  const marketToggle = (
    <div className="flex rounded-md border border-gray-300 overflow-hidden w-max">
      {([["kr", "🇰🇷 한국"], ["us", "🇺🇸 미국"]] as const).map(([m, label]) => (
        <button key={m} onClick={() => setMarket(m)}
                className={`px-3 py-1.5 text-sm font-bold transition-colors
                            ${market === m ? "bg-gray-800 text-white"
                                           : "bg-white text-gray-600 hover:bg-gray-100"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  // 미국은 데이터 출처·필터가 완전히 달라 별도 패널로 통째 교체한다.
  if (market === "us") {
    return (
      <div className="space-y-3">
        {marketToggle}
        <UsRankingPanel />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {marketToggle}
      {/* 헤더 — 상승/하락 토글 + 새로고침 + 기준 정보 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-300 bg-white p-2.5">
        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(["top", "bottom"] as const).map(s => (
            <button key={s}
                    onClick={() => { setSide(s); setExpanded(false); }}
                    className={`px-2.5 py-1.5 text-sm font-medium transition-colors
                                ${side === s
                                  ? (s === "top" ? "bg-rose-600 text-white" : "bg-blue-600 text-white")
                                  : "bg-white text-gray-600 hover:bg-gray-100"}`}>
              {s === "top" ? "📈 상승" : "📉 하락"}
            </button>
          ))}
        </div>

        <button onClick={refresh} disabled={loading}
                title="전체 ETF 시세를 다시 조회합니다 (프록시 약 6콜)"
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300
                           bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50">
          {loading ? "조회 중…" : "🔄 새로고침"}
        </button>

        <button onClick={() => { setHideLeverage(v => !v); setExpanded(false); }}
                title="이름에 '레버리지' 가 든 ETF 를 목록에서 제외합니다"
                className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors
                            ${hideLeverage
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}>
          {hideLeverage ? "✓ 레버리지 제외" : "레버리지 제외"}
        </button>

        <button onClick={() => { setHideFutures(v => !v); setExpanded(false); }}
                title="이름에 '선물' 이 든 ETF 를 목록에서 제외합니다"
                className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors
                            ${hideFutures
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}>
          {hideFutures ? "✓ 선물 제외" : "선물 제외"}
        </button>

        {/* 기간 — 오늘만 실시간, 나머지는 크롤 시점 기준 */}
        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(["today", "w1", "m1", "m3", "m6", "y1"] as const).map(p => (
            <button key={p}
                    onClick={() => { setPeriod(p); setExpanded(false); }}
                    title={p === "today"
                      ? "오늘 등락률 (실시간 조회)"
                      : `${PERIOD_LABEL[p]} 수익률 (매일 06:00 갱신)`}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors
                                ${period === p
                                  ? "bg-gray-800 text-white"
                                  : "bg-white text-gray-600 hover:bg-gray-100"}`}>
              {p === "today" ? "오늘" : PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="ml-auto text-[11px] text-gray-500 leading-tight text-right">
          {ranking ? (
            <>
              <div>
                기준 {fmtStamp(ranking.fetchedAt)}
                {ranking.tradeDate && <span className="ml-1">({ranking.tradeDate})</span>}
              </div>
              <div>{ranking.scanned.toLocaleString()} / {ranking.total.toLocaleString()}종</div>
            </>
          ) : loading ? (
            <div>전체 ETF 시세 조회 중…</div>
          ) : null}
        </div>
      </div>

      {err && (
        <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
          ⚠️ 조회 실패 — {err}
          <button onClick={refresh} className="ml-2 underline font-bold">다시 시도</button>
        </div>
      )}

      {!ranking && loading && (
        <div className="py-16 text-center text-gray-500 text-sm">
          전체 ETF 시세를 받고 있습니다… (수 초 걸립니다)
        </div>
      )}

      {/* 섹터별 흐름(그룹)은 **위**, 종목 목록은 **아래**.
          좌우로 갈랐더니 양쪽 다 좁아져 섹터 카드 이름도 종목 이름도 잘렸다 → 되돌린다. */}
      {/* 섹터별 흐름 — 같은 조회 결과를 이름으로 묶은 것(추가 호출 없음) */}
      {sectors.length > 0 && (
        <div className="rounded-xl border border-gray-300 bg-white p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setSectorOpen(o => !o)}
                    className="text-sm font-bold text-gray-700 hover:text-gray-900">
              🧭 섹터별 흐름 <span className="text-gray-400">{sectorOpen ? "▾" : "▸"}</span>
            </button>
            <span className="text-[11px] text-gray-500">
              중앙값 등락률 순 · 레버리지·인버스·선물 제외
              <span className="text-amber-600"> · 주황 숫자는 표본 3종 미만</span>
            </span>
            {picked && (
              <button onClick={() => setSector(null)}
                      className="ml-auto px-2 py-0.5 text-[11px] rounded border border-gray-300
                                 bg-white text-gray-600 hover:bg-gray-100">
                ✕ {picked.label} 해제
              </button>
            )}
          </div>
          {sectorOpen && (
            <EtfSectorFlow sectors={sectors} selectedKey={sector}
                           onPick={s => { setSector(s.key === sector ? null : s.key); setExpanded(false); }} />
          )}
        </div>
      )}

      {picked && (
        <div className="px-1 text-[11px] text-gray-500">
          <b className="text-gray-700">{picked.label}</b> {picked.count}종 · 거래대금 상위 {picked.rows.length}종을
          {side === "top" ? " 등락률 높은 순" : " 낮은 순"}으로 보여줍니다.
          {period !== "today" && (
            <> {PERIOD_LABEL[period]} 수익률은 매일 06:00 에 갱신된 값이라 오늘 움직임은 빠져 있습니다
              {returnData?.version ? ` (${returnData.version} 기준)` : ""}.</>
          )}
        </div>
      )}

      {ranking && shown.length === 0 && !loading && (
        <div className="py-16 text-center text-gray-500 text-sm">표시할 ETF 가 없습니다.</div>
      )}

      {shown.length > 0 && (
        // 가로 우선 배치 — 1위부터 오른쪽으로 채우고 다음 줄로 넘어간다(섹터 카드와 같은 규칙).
        //   리치 카드라 예전(6단)보다 단을 줄였다 — 6단에서는 이름도 지표도 다 잘렸다.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-2 gap-y-5 pt-3 items-stretch">
          {shown.map((r, i) => (
            <RankCard key={r.code} row={r} rank={i + 1} period={period} periodPct={pctOf(r)}
                      tradeDate={ranking?.tradeDate ?? ""}
                      onOpenEtfComposition={onOpenEtfComposition} />
          ))}
        </div>
      )}

      {rows.length > RANK_SHOW && (
        <button onClick={() => setExpanded(v => !v)}
                className="w-full py-2 text-sm font-medium text-gray-600 rounded-lg
                           border border-gray-300 bg-white hover:bg-gray-50">
          {expanded ? "접기" : `더보기 (${Math.min(rows.length, RANK_KEEP)}위까지)`}
        </button>
      )}

      <p className="text-[11px] text-gray-500 leading-relaxed">
        전체 ETF {ranking?.total.toLocaleString() ?? "—"}종의 시세를 한 번에 받아 등락률로 정렬합니다.
        호출 비용이 커서 자동 갱신하지 않으니, 최신 값이 필요하면 새로고침을 눌러주세요.
        섹터는 <b>ETF 이름</b>으로 나눕니다 — 이름과 실제 구성이 다르면 틀릴 수 있습니다.
        각 섹터의 대표는 <b>거래대금 1위</b>(현재가×거래량)로 고릅니다.
      </p>
    </div>
  );
}
