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
import { signColor, formatVolume } from "../lib/format";
import { fetchKrPriceHistory } from "../lib/api";
import { Sparkline } from "./Sparkline";
import {
  fetchEtfRanking, loadCachedRanking, isLeverageEtf, isFuturesEtf, RANK_SHOW, RANK_KEEP,
  type EtfRanking, type EtfRankRow,
} from "../lib/etfRanking";
import { EtfSectorFlow } from "./EtfSectorFlow";
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

// 랭킹 카드 배경 추이 그래프 — 뷰포트에 들어온 카드만 3개월 일봉을 지연 fetch.
//   (전체 ETF 시세 스캔은 6콜 배치지만, 종목별 차트는 개별 호출이라 호출수 병목을 피하려 lazy 로딩)
function RankSparkline({ code }: { code: string }) {
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
    queryKey: ["etf-rank-spark", code],
    queryFn: () => fetchKrPriceHistory(code, "3mo"),
    enabled: inView,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
  const arr = (data ?? []).map(p => p.close);
  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none">
      {arr.length > 1 && (
        <Sparkline data={arr} width={400} height={80}
                   className="absolute inset-0 w-full h-full opacity-40" />
      )}
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

  return (
    <div className="space-y-3">
      {/* 헤더 — 상승/하락 토글 + 새로고침 + 기준 정보 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-300 bg-white p-2.5">
        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(["top", "bottom"] as const).map(s => (
            <button key={s}
                    onClick={() => { setSide(s); setExpanded(false); }}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors
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
          {(["today", "w1", "m1", "m3"] as const).map(p => (
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
        // 세로 우선 배치 — 1위부터 아래로 채우고 다음 칸(오른쪽)으로 넘어간다.
        //   grid 는 가로로 채운 뒤 줄바꿈(row-major)이라 순위를 세로로 읽을 수 없다.
        //   grid-flow-col 은 행 수를 고정해야 해서 반응형(칸 수 가변)과 안 맞음 →
        //   CSS 다단(columns)은 칸 수만 주면 개수에 맞춰 알아서 세로로 분배(column-major).
        //   gap-2 는 다단에서 column-gap 만 먹으므로 세로 간격은 각 카드의 mb-2 로 준다.
        <div className="columns-1 sm:columns-2 lg:columns-4 xl:columns-6 gap-2">
          {shown.map((r, i) => (
            <button key={r.code}
                    onClick={() => onOpenEtfComposition?.(r.code, r.name)}
                    className="relative overflow-hidden flex items-center gap-2 px-2.5 py-2 text-left rounded-lg
                               border border-gray-200 bg-white hover:bg-gray-50
                               w-full mb-2 break-inside-avoid">
              <RankSparkline code={r.code} />
              <span className="relative z-10 w-7 shrink-0 text-[11px] tabular-nums text-gray-400 text-right">
                {i + 1}
              </span>
              <span className="relative z-10 flex-1 min-w-0">
                <span className="line-clamp-2 min-h-[2.5em] text-sm font-medium text-gray-800 leading-tight">
                  {r.name}
                </span>
                <span className="block text-[11px] text-gray-500 tabular-nums">
                  거래량 {formatVolume(r.volume)}
                </span>
              </span>
              <span className="relative z-10 shrink-0 text-right">
                {(() => {
                  // 기간 탭이면 그 기간 수익률을, 오늘이면 스냅샷 등락률을 크게 보여준다.
                  const v = pctOf(r);
                  return (
                    <span className={`block text-sm font-bold tabular-nums ${signColor(v ?? 0)}`}>
                      {v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                    </span>
                  );
                })()}
                <span className="block text-[11px] text-gray-600 tabular-nums">
                  {r.price.toLocaleString()}
                </span>
                {/* 기간을 보는 중엔 오늘 등락률도 작게 곁들인다 — 둘을 같이 봐야 판단이 된다 */}
                {period !== "today" && (
                  <span className={`block text-[11px] tabular-nums ${signColor(r.pct)}`}>
                    오늘 {r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%
                  </span>
                )}
              </span>
            </button>
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
