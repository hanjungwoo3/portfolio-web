import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchValueupIndex, fetchValueupConstituents } from "../lib/api";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { Sparkline } from "./Sparkline";

// 코리아 밸류업 지수 (네이버 KVALUE) — 지수탭 한국 시장 행에 다른 지수와 같은 크기의 카드로 렌더.
//   Yahoo 미제공·TradingView symbolset 미지원이라 네이버 소스 별도 사용(지수=m.stock, 구성종목=finance PC).
//   구성종목 100종목 전체는 카드 '구성' 버튼 → 모달.
const BASE_REFRESH_MS = 15_000;
const INDEX_URL = "https://m.stock.naver.com/domestic/index/KVALUE";

// 한국식 색: 상승 빨강 / 하락 파랑 / 보합 회색.
function pctColor(pct: number): string {
  return pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-900";
}
function fmtPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
// 억원 → 조/억 축약.
function fmtEok(eok: number): string {
  if (!Number.isFinite(eok) || eok <= 0) return "-";
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

// 구성종목 모달 — 네이버 금융 편입종목 100종목(10페이지 스크래핑).
//   10페이지 프록시 호출이라 모달 열려 있을 때만 60초 간격 갱신(프록시 부하 완화).
function ConstituentsDialog({ onClose }: { onClose: () => void }) {
  const { data: stocks } = useQuery({
    queryKey: ["valueup-constituents"],
    queryFn: fetchValueupConstituents,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
         onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-xl shadow-xl max-h-full flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <div className="text-base font-bold text-gray-900">📊 코리아 밸류업 · 구성종목</div>
            <div className="text-[11px] text-gray-400">시가총액 순 {stocks?.length ?? 100}종목 · 네이버 금융</div>
          </div>
          <button onClick={onClose} className="px-2 py-1 text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>
        <div className="overflow-y-auto p-2">
          {stocks == null && <div className="py-8 text-center text-sm text-gray-400">구성종목 불러오는 중…</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {(stocks ?? []).map((s, i) => (
              <a key={s.code}
                 href={`https://m.stock.naver.com/domestic/stock/${s.code}`}
                 target="_blank" rel="noreferrer"
                 className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 hover:border-gray-300">
                <span className="w-4 text-right text-[10px] text-gray-400 tabular-nums shrink-0">{i + 1}</span>
                {s.logoUrl
                  ? <img src={s.logoUrl} alt="" className="w-6 h-6 rounded-full object-contain shrink-0"
                         onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                  : <span className="w-6 h-6 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-gray-800">{s.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">시총 {fmtEok(s.marketCap)}</span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-xs tabular-nums text-gray-700">{s.price.toLocaleString()}</span>
                  <span className={`block text-xs font-bold tabular-nums ${pctColor(s.changePct)}`}>{fmtPct(s.changePct)}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 지수 카드 셀 — UsMarketTab/MobileSimpleView 의 지수 카드와 동일 크기·마크업.
export function ValueupMiniCard() {
  const refreshMs = useAdaptiveRefreshMs(BASE_REFRESH_MS);
  const [open, setOpen] = useState(false);
  const { data: idx } = useQuery({
    queryKey: ["valueup-index"],
    queryFn: fetchValueupIndex,
    refetchInterval: refreshMs,
    staleTime: 5_000,
  });

  const pct = idx?.changePct ?? 0;
  const up = pct > 0, dn = pct < 0;
  const bg = up ? "bg-rose-50 border-rose-200" : dn ? "bg-blue-50/70 border-blue-200" : "bg-white border-gray-200";
  const sign = pctColor(pct);

  return (
    <div className="relative h-full">
      <div className={`relative overflow-hidden h-full flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 ${bg}`}>
        {idx && idx.sparkline.length > 1 && (
          <Sparkline data={idx.sparkline} width={400} height={80}
                     className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />
        )}
        <div className="relative z-10 flex items-baseline gap-1.5">
          <a href={INDEX_URL} target="_blank" rel="noopener noreferrer"
             title="코리아 밸류업 지수 자세히 보기"
             className="text-base font-bold text-gray-900 hover:underline min-w-0 truncate">
            코리아 밸류업
          </a>
          <button onClick={() => setOpen(true)} title="구성종목 보기"
                  className="ml-auto shrink-0 px-1 py-0.5 rounded text-[10px] text-gray-500
                             bg-white/60 hover:bg-white border border-gray-200">
            구성
          </button>
        </div>
        <div className="relative z-10 text-[11px] text-gray-500 truncate">KRX 코리아 밸류업 지수</div>
        <div className="relative z-10 flex items-end mt-auto">
          <span className={`flex-1 text-left tabular-nums ${sign}`}>
            <span className="text-sm">
              {idx ? idx.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </span>
          </span>
          <span className={`flex-1 text-right text-xl font-bold tabular-nums ${sign}`}>
            {idx && Math.abs(pct) >= 0.005 ? fmtPct(pct) : ""}
          </span>
        </div>
      </div>
      {open && <ConstituentsDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
