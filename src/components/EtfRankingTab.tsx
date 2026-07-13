// ETF 랭킹 — 전체 ETF(색인 828종)를 등락률로 줄 세워 상위/하위를 보여준다.
//
// 조회는 17 프록시 콜이라 폴링하지 않는다. 캐시가 없을 때 1회 자동 조회하고,
// 그 뒤로는 "새로고침" 버튼을 누를 때만 다시 받는다. (etfRanking.ts 주석 참고)

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { signColor, formatVolume } from "../lib/format";
import { fetchKrPriceHistory } from "../lib/api";
import { Sparkline } from "./Sparkline";
import {
  fetchEtfRanking, loadCachedRanking, isLeverageEtf, RANK_SHOW, RANK_KEEP,
  type EtfRanking, type EtfRankRow,
} from "../lib/etfRanking";

interface Props {
  onOpenEtfComposition?: (code: string, name: string) => void;
}

type Side = "top" | "bottom";

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
//   (전체 ETF 시세 스캔은 17콜 배치지만, 종목별 차트는 개별 호출이라 호출수 병목을 피하려 lazy 로딩)
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
  const [expanded, setExpanded] = useState(false);
  const [hideLeverage, setHideLeverage] = useState(true);   // 레버리지 ETF 제외 (기본 ON)
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

  const allRows: EtfRankRow[] = ranking
    ? (side === "top" ? ranking.top : ranking.bottom)
    : [];
  const rows = hideLeverage ? allRows.filter(r => !isLeverageEtf(r.name)) : allRows;
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
                title="전체 ETF 시세를 다시 조회합니다 (프록시 약 17콜)"
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

      {ranking && shown.length === 0 && !loading && (
        <div className="py-16 text-center text-gray-500 text-sm">표시할 ETF 가 없습니다.</div>
      )}

      {shown.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {shown.map((r, i) => (
            <button key={r.code}
                    onClick={() => onOpenEtfComposition?.(r.code, r.name)}
                    className="relative overflow-hidden flex items-center gap-2 px-2.5 py-2 text-left rounded-lg
                               border border-gray-200 bg-white hover:bg-gray-50">
              <RankSparkline code={r.code} />
              <span className="relative z-10 w-7 shrink-0 text-[11px] tabular-nums text-gray-400 text-right">
                {i + 1}
              </span>
              <span className="relative z-10 flex-1 min-w-0">
                <span className="block truncate text-sm font-medium text-gray-800">{r.name}</span>
                <span className="block text-[11px] text-gray-500 tabular-nums">
                  {r.code} · 거래량 {formatVolume(r.volume)}
                </span>
              </span>
              <span className="relative z-10 shrink-0 text-right">
                <span className={`block text-sm font-bold tabular-nums ${signColor(r.pct)}`}>
                  {r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%
                </span>
                <span className="block text-[11px] text-gray-600 tabular-nums">
                  {r.price.toLocaleString()}
                </span>
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
      </p>
    </div>
  );
}
