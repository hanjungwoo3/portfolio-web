// 미국 종목·ETF 기간 수익률 랭킹 — ETF랭킹 탭의 '미국' 화면.
//
// 한국 화면과 구조는 같지만 데이터 성격이 다르다:
//   한국 = 전 종목 시세 6콜 + 크롤러가 심어 둔 기간 수익률(하루 1회 갱신).
//   미국 = TradingView scanner 가 기간 수익률을 컬럼으로 주므로 **조회 1콜**, 기간도 실시간.
//
// 기본값을 '1년 · 레버리지 제외' 로 두는 이유: 그냥 두면 상위가 전부 2배 상품이다(실측 —
//   1년 상위 10 중 7개가 MU/AMD/INTC 2x). 기초자산이 아니라 일간 복리 결과라 같이 못 읽는다.

import { useCallback, useEffect, useState } from "react";
import { signColor } from "../lib/format";
import {
  fetchUsRanking, US_PERIOD_LABEL, type UsPeriod, type UsRanking, type UsRankRow, type UsKind,
} from "../lib/usRanking";

const KIND_LABEL: Record<UsKind, string> = { fund: "ETF", stock: "주식", dr: "ADR", other: "기타" };
const KIND_CLS: Record<UsKind, string> = {
  fund:  "bg-amber-100 text-amber-700 border-amber-300",
  stock: "bg-sky-100 text-sky-700 border-sky-300",
  dr:    "bg-violet-100 text-violet-700 border-violet-300",
  other: "bg-gray-100 text-gray-600 border-gray-300",
};

type KindFilter = "all" | "fund" | "stock";

function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

export function UsRankingPanel() {
  const [period, setPeriod] = useState<UsPeriod>("y1");
  const [side, setSide] = useState<"top" | "bottom">("top");
  const [hideLev, setHideLev] = useState(true);
  const [kind, setKind] = useState<KindFilter>("all");
  const [data, setData] = useState<UsRanking | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback((p: UsPeriod, s: "top" | "bottom") => {
    setLoading(true); setErr("");
    // 레버리지를 뺄 걸 감안해 넉넉히 받는다 — 60개만 받으면 걸러낸 뒤 20개도 안 남는다.
    fetchUsRanking(p, s, 120)
      .then(setData)
      .catch(e => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(period, side); }, [load, period, side]);

  const rows: UsRankRow[] = (data?.rows ?? [])
    .filter(r => !hideLev || !r.leveraged)
    .filter(r => kind === "all" || (kind === "fund" ? r.kind === "fund" : r.kind !== "fund"))
    .slice(0, 50);

  const btn = (on: boolean) =>
    `px-2.5 py-1.5 text-sm font-medium transition-colors ${
      on ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-300 bg-white p-2.5">
        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(["top", "bottom"] as const).map(s => (
            <button key={s} onClick={() => setSide(s)}
                    className={`px-2.5 py-1.5 text-sm font-medium transition-colors ${
                      side === s
                        ? (s === "top" ? "bg-rose-600 text-white" : "bg-blue-600 text-white")
                        : "bg-white text-gray-600 hover:bg-gray-100"}`}>
              {s === "top" ? "📈 상승" : "📉 하락"}
            </button>
          ))}
        </div>

        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(["today", "w1", "m1", "m3", "m6", "y1"] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={btn(period === p)}>
              {US_PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        <button onClick={() => setHideLev(v => !v)}
                title="2x·3x·Bull/Bear·Ultra 등 레버리지·인버스 상품을 제외합니다"
                className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                  hideLev ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}>
          {hideLev ? "✓ 레버리지 제외" : "레버리지 제외"}
        </button>

        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {([["all", "전체"], ["fund", "ETF만"], ["stock", "주식만"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)} className={btn(kind === k)}>{label}</button>
          ))}
        </div>

        <button onClick={() => load(period, side)} disabled={loading}
                title="TradingView 스캐너로 다시 조회합니다 (프록시 1콜)"
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300
                           bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50">
          {loading ? "조회 중…" : "🔄 새로고침"}
        </button>

        <div className="ml-auto text-[11px] text-gray-500 leading-tight text-right">
          {data ? <>
            <div>거래대금 $3M↑ · {data.total.toLocaleString()}종 중</div>
            <div className="text-gray-400">TradingView · 실시간</div>
          </> : loading ? <div>조회 중…</div> : null}
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          ⚠️ {err}
        </div>
      )}

      {rows.length === 0 && !loading && !err && (
        <div className="py-16 text-center text-gray-500 text-sm">표시할 종목이 없습니다.</div>
      )}

      {rows.length > 0 && (
        // 가로 우선 배치 — 한국 목록·섹터 카드와 같은 규칙(1위부터 오른쪽으로).
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-stretch">
          {rows.map((r, i) => (
            <a key={r.ticker}
               href={`https://finance.yahoo.com/quote/${encodeURIComponent(r.ticker)}`}
               target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200
                          bg-white hover:bg-gray-50 w-full h-full">
              <span className="w-7 shrink-0 text-[11px] tabular-nums text-gray-400 text-right">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1">
                  <span className="font-bold text-sm text-gray-800">{r.ticker}</span>
                  <span className={`px-1 py-0.5 rounded border text-[9px] font-bold leading-none ${KIND_CLS[r.kind]}`}>
                    {KIND_LABEL[r.kind]}
                  </span>
                  {r.leveraged && (
                    <span className="px-1 py-0.5 rounded border border-rose-300 bg-rose-50
                                     text-[9px] font-bold leading-none text-rose-600">레버</span>
                  )}
                </span>
                <span className="block line-clamp-1 text-[11px] text-gray-500">{r.name}</span>
                <span className="block text-[10px] text-gray-400 tabular-nums">
                  거래대금 {money(r.valueTraded)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block text-sm font-bold tabular-nums ${signColor(r.pct)}`}>
                  {r.pct > 0 ? "+" : ""}{r.pct.toFixed(1)}%
                </span>
                <span className="block text-[11px] text-gray-600 tabular-nums">
                  ${r.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500 leading-relaxed">
        TradingView 스캐너로 미국 상장 전 종목(주식·ETF·ADR)을 기간 수익률로 줄 세웁니다.
        당일 <b>거래대금 $3M 이상</b>만 봅니다 — 안 거르면 거래가 거의 없는 껍데기 종목이 상위를 덮습니다.
        <br/>
        <b>레버리지 제외</b>를 끄면 2x·3x·Bull/Bear 상품이 상위를 차지합니다. 기초자산의 N배가 아니라
        <b> 일간 수익률을 매일 복리</b>로 곱한 결과라, 오래 들수록 기초자산과 크게 벌어집니다.
      </p>
    </div>
  );
}
