// 지수 탭 '한국 시장' 아래 — ETF 상승·하락 각 TOP 9 (레버리지·선물 제외).
// 배치: **왼쪽 상승(+) / 오른쪽 하락(−)**. 위아래로 쌓으면 아래쪽(하락)이 접혀 안 보인다 —
//   오른 것과 빠진 것은 같은 눈높이에서 나란히 봐야 "오늘 돈이 어디서 어디로 갔나" 가 읽힌다.
//   좁은 화면(lg 미만)에서만 위아래로 떨어진다.
//
// ETF 랭킹 탭의 같은 필터를 그대로 쓰되, 지수 탭에서는 **맨 위 9개만** 본다.
//   레버리지·선물을 빼는 이유: 그것들은 기초자산의 2배·파생이라 등락률 상위를 늘 독점한다.
//   빼고 나야 "오늘 실제로 어디가 올랐나" 가 보인다.
//
// ⚠️ 이 조회는 전 종목 시세라 **6콜**이다(1,130종 ÷ 200). 지수 탭이 열릴 때마다 자동으로
//   나가면 공용 프록시 한도를 갉아먹는다 → 섹터 흐름과 같은 규칙으로 전용 전송(확장·앱·개인
//   프록시)일 때만 자동 조회하고, 공용에서는 캐시를 보여주고 새로고침 버튼으로 받는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchKrPriceHistory, fetchEtfCompositions, fetchTossCodeInfo, fetchUsHoldingPrices } from "../lib/api";
import { usSessionLabel } from "../lib/usSectorFlow";
import { dayChangePct } from "../lib/format";
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


// ── 구성종목의 '지금 미국 시장' 가중 등락률 ────────────────────────────────────
// 국내 상장 해외 ETF 의 등락률은 **직전 미국 정규장**이다. 그래서 목록의 −3.52% 는 어젯밤 값이고,
// 구성종목은 지금 프리장에서 반대로 가고 있을 수 있다. 그 차이를 행에 같이 적는다.
//
// ⚠️ 비용: ETF 당 구성 1콜(20장이면 20콜). 그래서
//   ① 화면에 들어왔을 때만 받고
//   ② 구성은 하루 단위로만 바뀌므로 staleTime 을 6시간으로 길게 잡고
//      (구성종목 팝업과 **같은 쿼리키**라 캐시를 공유한다 — 팝업을 먼저 열었으면 0콜)
//   ③ 해외 시세는 20장 전체의 종목을 모아 **1배치**로 받는다.
const COMP_STALE = 6 * 60 * 60_000;

function isForeignStockCode(c: string): boolean {
  return !/^[\dA-Za-z]{6}$/.test((c ?? "").replace(/^A/, "")) && /^[A-Z]{2,4}\d/.test(c ?? "");
}

/** ETF코드 → { pct: 비중가중 등락률, cover: 모인 비중 } (해외 구성이 없으면 없음) */
function useUsBasketPct(codes: string[], enabled: boolean): Map<string, { pct: number; cover: number }> {
  const comps = useQueries({
    queries: codes.map(c => ({
      queryKey: ["etf-compositions", c],          // ★ 팝업과 같은 키 — 캐시 공유
      queryFn: () => fetchEtfCompositions(c),
      enabled,
      staleTime: COMP_STALE,
      gcTime: COMP_STALE,
      retry: 1,
    })),
  });
  const itemsByEtf = new Map<string, { stockCode: string; ratio: number }[]>();
  comps.forEach((q, i) => {
    const fs = (q.data?.items ?? []).filter(it => isForeignStockCode(it.stockCode ?? ""));
    if (fs.length) itemsByEtf.set(codes[i], fs);
  });

  const foreignCodes = [...new Set([...itemsByEtf.values()].flat().map(it => it.stockCode))].sort();
  const fKey = foreignCodes.join(",");
  const { data: quotes } = useQuery({
    queryKey: ["etf-top-foreign-quotes", fKey],
    queryFn: async () => {
      const list = fKey.split(",").filter(Boolean);
      const infos = await Promise.all(list.map(c => fetchTossCodeInfo(c).catch(() => null)));
      const symByCode = new Map<string, string>();
      infos.forEach((info, i) => { if (info?.symbol) symByCode.set(list[i], info.symbol); });
      const syms = [...new Set(symByCode.values())];
      const prices = syms.length ? await fetchUsHoldingPrices(syms) : [];
      const bySym = new Map(prices.map(p => [p.ticker, p]));
      const pctByCode = new Map<string, number>();
      for (const [code, sym] of symByCode) {
        const pct = dayChangePct(bySym.get(sym));
        if (pct != null && Number.isFinite(pct)) pctByCode.set(code, pct);
      }
      return pctByCode;
    },
    enabled: enabled && foreignCodes.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const out = new Map<string, { pct: number; cover: number }>();
  if (!quotes) return out;
  for (const [etf, its] of itemsByEtf) {
    let w = 0, acc = 0;
    for (const it of its) {
      const pct = quotes.get(it.stockCode);
      if (pct == null) continue;
      w += it.ratio; acc += it.ratio * pct;
    }
    if (w > 0) out.set(etf, { pct: acc / w, cover: w });
  }
  return out;
}

const TOP_N = 9;    // 반쪽마다 한 줄 3개 × 3줄 — 딱 떨어져야 마지막 줄이 비지 않는다
const AUTO_MIN_GAP_MS = 5 * 60 * 1000;
let lastAutoAt = 0;
let inflight: Promise<EtfRanking> | null = null;

// 랭킹은 상승(top)·하락(bottom)을 따로 들고 있다. 양쪽 다 같은 필터를 건다.
function pick(list: EtfRankRow[] | undefined): EtfRankRow[] {
  return (list ?? [])
    .filter((x: EtfRankRow) => !isLeverageEtf(x.name) && !isFuturesEtf(x.name))
    .slice(0, TOP_N);
}

function Grid({ rows, label, onOpenEtf, basket }: {
  rows: EtfRankRow[]; label: string;
  onOpenEtf?: (code: string, name: string) => void;
  basket?: Map<string, { pct: number; cover: number }>;
}) {
  if (rows.length === 0) return null;
  const up = label === "상승";
  return (
    <div className="min-w-0">
      <div className={`mb-1 text-[11px] font-bold ${up ? "text-rose-600" : "text-blue-600"}`}>
        {up ? "▲" : "▼"} {label} TOP{rows.length}
      </div>
      {/* 랭킹 탭과 같은 행 형태(배경 스파크라인 + 순위·이름·거래량 / 등락률·현재가).
          ★ 세로 정렬 — 1,2,3 이 **한 열을 내려가며** 차고 4,5,6 이 다음 열로 넘어간다.
          (grid-flow-col + grid-rows-N. auto-cols-fr 가 없으면 열 폭이 내용대로 들쭉날쭉해진다)
          반쪽 폭에 3열 — 대신 폰트를 한 단계씩 줄여 이름이 두 줄 안에 들어오게 했다. */}
      <div className="grid grid-flow-col grid-rows-5 sm:grid-rows-3 auto-cols-fr gap-1.5 items-stretch">
        {rows.map((r, i) => (
          <button key={r.code}
                  onClick={() => onOpenEtf?.(r.code, r.name)}
                  className="relative overflow-hidden flex items-center gap-1 px-1.5 py-1.5 text-left rounded-lg
                             border border-gray-200 bg-white hover:bg-gray-50 w-full h-full">
            <RankSparkline code={r.code} />
            <span className="relative z-10 w-4 shrink-0 text-[9px] tabular-nums text-gray-400 text-right">
              {i + 1}
            </span>
            <span className="relative z-10 flex-1 min-w-0">
              <span className="line-clamp-2 min-h-[2.4em] text-[11px] font-medium text-gray-800 leading-tight">
                {r.name}
              </span>
              <span className="block text-[9px] text-gray-500 tabular-nums">
                거래량 {formatVolume(r.volume)}
              </span>
              {/* 해외 구성 ETF — 이 줄의 등락률은 직전 미국 정규장이고, 아래는 지금 미국 시장이다. */}
              {(() => {
                const b = basket?.get(r.code);
                if (!b) return null;
                return (
                  <span className="block text-[9px] tabular-nums whitespace-nowrap"
                        title={`구성종목 비중 ${b.cover.toFixed(0)}% 가중 · 지금 미국 ${usSessionLabel()}`}>
                    <span className="text-gray-400">구성 {usSessionLabel()} </span>
                    <span className={`font-bold ${signColor(b.pct)}`}>
                      {b.pct >= 0 ? "+" : ""}{b.pct.toFixed(2)}%
                    </span>
                  </span>
                );
              })()}
            </span>
            <span className="relative z-10 shrink-0 text-right">
              <span className={`block text-xs font-bold tabular-nums ${signColor(r.pct)}`}>
                {r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%
              </span>
              <span className="block text-[9px] text-gray-600 tabular-nums">
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
  // 구성 조회는 ETF 당 1콜이라 **화면에 들어왔을 때만** 켠다 (지수 탭 아래쪽이라 안 보고 지나칠 수 있다).
  const basket = useUsBasketPct([...ups, ...downs].map(r => r.code), inView);
  const stamp = rank?.fetchedAt
    ? new Date(rank.fetchedAt + 9 * 3600_000).toISOString().slice(11, 16)   // KST HH:MM
    : null;

  return (
    <>
      <div ref={rootRef} className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 mb-1 flex-wrap">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-0">
          <div className="min-w-0 lg:pr-3">
            <Grid rows={ups} label="상승" onOpenEtf={onOpenEtf} basket={basket} />
          </div>
          {/* 한·미 섹터 판과 같은 규칙 — 두 번째 패널에만 세로 구분선 */}
          <div className="min-w-0 lg:pl-3 lg:border-l lg:border-gray-200">
            <Grid rows={downs} label="하락" onOpenEtf={onOpenEtf} basket={basket} />
          </div>
        </div>
      )}
    </>
  );
}
