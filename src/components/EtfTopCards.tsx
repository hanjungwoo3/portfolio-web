// 지수 탭 '한국 시장' 아래 — ETF 상승·하락 각 TOP 10 (레버리지·선물 제외). 한 줄 5개 × 2줄.
//
// ETF 랭킹 탭의 같은 필터를 그대로 쓰되, 지수 탭에서는 **맨 위 9개만** 본다.
//   레버리지·선물을 빼는 이유: 그것들은 기초자산의 2배·파생이라 등락률 상위를 늘 독점한다.
//   빼고 나야 "오늘 실제로 어디가 올랐나" 가 보인다.
//
// ⚠️ 이 조회는 전 종목 시세라 **6콜**이다(1,130종 ÷ 200). 지수 탭이 열릴 때마다 자동으로
//   나가면 공용 프록시 한도를 갉아먹는다 → 섹터 흐름과 같은 규칙으로 전용 전송(확장·앱·개인
//   프록시)일 때만 자동 조회하고, 공용에서는 캐시를 보여주고 새로고침 버튼으로 받는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrPriceHistory } from "../lib/api";
import { Sparkline } from "./Sparkline";
import { fetchEtfRanking, loadCachedRanking, isLeverageEtf, isFuturesEtf } from "../lib/etfRanking";
import type { EtfRanking, EtfRankRow } from "../lib/etfRanking";
import { hasDedicatedTransport } from "../lib/proxyConfig";
import { signColor, formatVolume } from "../lib/format";

// 배경 스파크라인 — 랭킹 탭의 그것과 같은 쿼리키라 캐시를 공유한다(같은 ETF 를 두 화면에서
//   봐도 한 번만 받는다). 화면에 들어온 카드만 받는다.
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

const TOP_N = 10;   // 한 줄 5개 × 2줄
const AUTO_MIN_GAP_MS = 5 * 60 * 1000;
let lastAutoAt = 0;
let inflight: Promise<EtfRanking> | null = null;

// 랭킹은 상승(top)·하락(bottom)을 따로 들고 있다. 양쪽 다 같은 필터를 건다.
function pick(list: EtfRankRow[] | undefined): EtfRankRow[] {
  return (list ?? [])
    .filter((x: EtfRankRow) => !isLeverageEtf(x.name) && !isFuturesEtf(x.name))
    .slice(0, TOP_N);
}

function Grid({ rows, label, onOpenEtf }: {
  rows: EtfRankRow[]; label: string;
  onOpenEtf?: (code: string, name: string) => void;
}) {
  if (rows.length === 0) return null;
  const up = label === "상승";
  return (
    <div className="mb-1.5">
      <div className={`mb-1 text-[11px] font-bold ${up ? "text-rose-600" : "text-blue-600"}`}>
        {up ? "▲" : "▼"} {label} TOP{rows.length}
      </div>
      {/* 랭킹 탭과 같은 행 형태(배경 스파크라인 + 순위·이름·거래량 / 등락률·현재가).
          ★ 여기는 grid 다 — 왼→오른쪽으로 1,2,3,4,5 가 차고 다음 줄에 6~10 이 온다. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 items-stretch">
        {rows.map((r, i) => (
          <button key={r.code}
                  onClick={() => onOpenEtf?.(r.code, r.name)}
                  className="relative overflow-hidden flex items-center gap-2 px-2.5 py-2 text-left rounded-lg
                             border border-gray-200 bg-white hover:bg-gray-50 w-full h-full">
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
    </div>
  );
}

export function EtfTopCards({ onOpenEtf }: {
  /** 카드 클릭 — ETF 구성종목 팝업(랭킹 탭과 같은 동작) */
  onOpenEtf?: (code: string, name: string) => void;
}) {
  const [rank, setRank] = useState<EtfRanking | null>(() => loadCachedRanking());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchEtfRanking()
      .then(setRank)
      .catch(() => { /* 실패하면 이전 캐시를 그대로 둔다 */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!hasDedicatedTransport()) return;          // 공용은 캐시 + 수동
    if (Date.now() - lastAutoAt < AUTO_MIN_GAP_MS) return;
    lastAutoAt = Date.now();
    inflight ??= fetchEtfRanking().finally(() => { inflight = null; });
    let alive = true;
    inflight.then(r => { if (alive) setRank(r); }).catch(() => { /* 캐시 유지 */ });
    return () => { alive = false; };
  }, []);

  const ups = pick(rank?.top);
  const downs = pick(rank?.bottom);
  const stamp = rank?.fetchedAt
    ? new Date(rank.fetchedAt + 9 * 3600_000).toISOString().slice(11, 16)   // KST HH:MM
    : null;

  return (
    <>
      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 mb-1 flex-wrap">
        <span>
          레버리지·선물 제외 · 상승·하락 각 {TOP_N}
          {rank?.scanned ? ` · ${rank.scanned.toLocaleString()}종 중` : ""}
        </span>
        {stamp && <span className="text-gray-400">기준 {stamp}</span>}
        <button onClick={refresh} disabled={loading}
                title="전 종목 시세를 다시 조회합니다 (프록시 약 6콜)"
                className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                           hover:bg-gray-100 disabled:opacity-50">
          {loading ? "조회 중…" : "🔄 새로고침"}
        </button>
      </div>

      {ups.length === 0 && downs.length === 0 ? (
        <div className="py-4 text-center text-[11px] text-gray-400">
          {loading ? "불러오는 중…" : "아직 받은 랭킹이 없습니다 — 새로고침을 눌러 주세요"}
        </div>
      ) : (
        <>
          <Grid rows={ups} label="상승" onOpenEtf={onOpenEtf} />
          <Grid rows={downs} label="하락" onOpenEtf={onOpenEtf} />
        </>
      )}
    </>
  );
}
