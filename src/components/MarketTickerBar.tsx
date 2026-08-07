import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, X } from "lucide-react";
import { fetchTossOverview, fetchTickerKrExtras, fetchTickerUsStockExtras } from "../lib/api";
import { TOSS_SYMBOL_URL, handleTossLinkClick } from "../lib/toss";
import { signColor } from "../lib/format";
import {
  TICKER_BAR_H, useTickerBarOpen, setTickerBarOpen,
  getTickerScope, setTickerScope, type TickerScope,
} from "../lib/tickerBar";

// 화면 하단 고정 지수 티커바 — 토스 웹 하단 띠와 같은 자리.
//  묶음(국내/해외/환율·금리)은 사용자가 골라 고정(마지막 선택 유지) — 자동 전환 없이 그 값만 폴링 주기마다 갱신.
//  값 출처: 대부분 지수 탭과 같은 fetchTossOverview 1콜. 그걸로 안 되는 것만 묶음별 보조 쿼리
//  (국내: 야선·KODEX·밸류업·V-KOSPI / 해외: KORU / 환율: EWY) — 고른 묶음일 때만 호출된다.
//  폭이 모자라면(모바일) 항목이 왼쪽으로 흐른다 — 마우스 올리면 멈춤.
interface TickerItem { symbol: string; label: string }

const KR_ITEMS: TickerItem[] = [
  { symbol: "^KS11",   label: "코스피" },
  { symbol: "^KQ11",   label: "코스닥" },
  { symbol: "^KS200N", label: "코스피200 선물" },
  { symbol: "^KQ150N", label: "코스닥150 선물" },
  { symbol: "069500",  label: "KODEX 200" },
  { symbol: "229200",  label: "KODEX 코스닥150" },
  { symbol: "KVALUE",  label: "코리아 밸류업" },
  { symbol: "VKOSPI",  label: "V-KOSPI" },
];

const US_ITEMS: TickerItem[] = [
  { symbol: "^IXIC", label: "나스닥" },
  { symbol: "NQ=F",  label: "나스닥 100 선물" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "ES=F",  label: "S&P 500 선물" },
  { symbol: "RTY=F", label: "러셀 2000 선물" },
  { symbol: "^DJI",  label: "다우존스" },
  { symbol: "^SOX",  label: "필라델피아 반도체" },
  { symbol: "^VIX",  label: "VIX" },
  { symbol: "KORU",  label: "KORU(3x한국)" },
];

// 환율·달러·금리·투심 — 지수 탭 동명 그룹과 같은 구성
const FX_ITEMS: TickerItem[] = [
  { symbol: "KRW=X",    label: "달러환율" },
  { symbol: "DX-Y.NYB", label: "달러 인덱스" },
  { symbol: "^US2Y",    label: "미국 2Y" },
  { symbol: "^TNX",     label: "미국 10Y" },
  { symbol: "EWY",      label: "EWY" },
];

const SCOPES: [TickerScope, string, TickerItem[]][] = [
  ["kr", "국내",    KR_ITEMS],
  ["us", "해외",    US_ITEMS],
  ["fx", "환율·금리", FX_ITEMS],
];

// 7,709.96 / 7,733.5 / 15.15 — 토스 표기처럼 소수점 최대 2자리
function fmtNum(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}
function fmtDiff(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${fmtNum(Math.abs(n))}`;
}

// 클릭 시 열 외부 페이지 — 명시 매핑(토스 지수) > 국내 6자리(토스 종목) > Yahoo
function quoteUrl(symbol: string): string {
  if (TOSS_SYMBOL_URL[symbol]) return TOSS_SYMBOL_URL[symbol];
  if (symbol === "^KS200N") return "https://yasun.gg/kospi200";
  if (symbol === "^KQ150N") return "https://yasun.gg/kosdaq150";
  if (symbol === "KVALUE") return "https://m.stock.naver.com/domestic/index/KVALUE/total";
  if (/^[\dA-Za-z]{6}$/.test(symbol)) return `https://tossinvest.com/stocks/A${symbol}`;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

interface MarketTickerBarProps {
  /** 폴링 주기(ms). 0 = 수동 모드(자동 갱신 없음) */
  refreshMs: number;
}

export function MarketTickerBar({ refreshMs }: MarketTickerBarProps) {
  const open = useTickerBarOpen();
  const [scope, setScope] = useState<TickerScope>(getTickerScope);
  const interval = refreshMs > 0 ? refreshMs : false;

  // 공통 — 지수/환율/금리/원자재 1콜 (지수 탭과 공유 캐시)
  const { data: base } = useQuery({
    queryKey: ["ticker-bar-overview"],
    queryFn: () => fetchTossOverview(),
    refetchInterval: interval,
    enabled: open,          // 닫아두면 호출도 멈춤 (프록시 호출수 절약)
    staleTime: 3000,
  });
  // 국내 보조 — 야선·KODEX·밸류업·V-KOSPI (국내 묶음 볼 때만)
  const { data: krExtra } = useQuery({
    queryKey: ["ticker-bar-kr-extras"],
    queryFn: () => fetchTickerKrExtras(),
    refetchInterval: interval,
    enabled: open && scope === "kr",
    staleTime: 3000,
  });
  // 미국 종목 보조 — 해외=KORU, 환율=EWY (토스 US 1콜). 보고 있는 묶음 것만.
  const usStockSyms = scope === "us" ? ["KORU"] : scope === "fx" ? ["EWY"] : [];
  const { data: stockExtra } = useQuery({
    queryKey: ["ticker-bar-us-stock-extras", usStockSyms.join(",")],
    queryFn: () => fetchTickerUsStockExtras(usStockSyms),
    refetchInterval: interval,
    enabled: open && usStockSyms.length > 0,
    staleTime: 3000,
  });

  // 폭이 모자라면 왼쪽으로 흐르게 — 이동 거리(한 벌 폭 + 간격)와 속도(40px/s)를 실측해 정한다.
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [flow, setFlow] = useState(0);   // 애니메이션 길이(초). 0 = 안 흐름(가운데 정렬)
  useLayoutEffect(() => {
    const wrap = wrapRef.current, r = rowRef.current;
    if (!wrap || !r) { setFlow(0); return; }
    const GAP = 16;   // gap-4
    const measure = () => {
      const rowW = r.scrollWidth;
      const fits = rowW + 24 <= wrap.clientWidth;   // px-3 좌우 여백 포함
      if (fits) { setFlow(0); wrap.style.removeProperty("--ticker-shift"); return; }
      wrap.style.setProperty("--ticker-shift", `${rowW + GAP}px`);
      // 값이 갱신될 때마다 폭이 1~2px 흔들린다 — 그때마다 duration 을 바꾸면 흐름이 튄다.
      //   1초 이상 차이날 때만 반영(이동 거리는 CSS 변수라 애니메이션 끊김 없이 반영됨).
      const secs = Math.max(10, Math.round((rowW + GAP) / 40));   // 40px/s
      setFlow(prev => (Math.abs(prev - secs) >= 1 ? secs : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap); ro.observe(r);
    return () => ro.disconnect();
  }, [open, scope, base, krExtra, stockExtra]);

  if (!open) {
    return (
      <button onClick={() => setTickerBarOpen(true)}
              title="지수 띠 열기"
              style={{ height: TICKER_BAR_H }}
              className="fixed bottom-0 right-3 z-30 px-2 flex items-center gap-1
                         bg-white/95 backdrop-blur border border-b-0 border-gray-200
                         rounded-t text-[11px] text-gray-500 hover:text-gray-800 shadow-sm">
            지수 <ChevronUp size={13} />
      </button>
    );
  }

  const items = SCOPES.find(([v]) => v === scope)?.[2] ?? US_ITEMS;
  const pickScope = (v: TickerScope) => { setScope(v); setTickerScope(v); };

  const row = () => items.map(({ symbol, label }) => {
    const q = base?.get(symbol) ?? krExtra?.get(symbol) ?? stockExtra?.get(symbol);
    const url = quoteUrl(symbol);
    return (
      <a key={symbol} href={url} target="_blank" rel="noopener noreferrer"
         onClick={e => handleTossLinkClick(e, url)}
         title={`${label} — 시세 페이지 열기`}
         className="flex items-center gap-1.5 text-[11px] hover:bg-gray-50 rounded px-1 py-0.5">
        <span className="text-gray-500">{label}</span>
        {q ? (
          <>
            <span className="font-semibold text-gray-900 tabular-nums">{fmtNum(q.price)}</span>
            <span className={`tabular-nums ${signColor(q.diff)}`}>
              {fmtDiff(q.diff)} ({Math.abs(q.pct).toFixed(2)}%)
            </span>
          </>
        ) : (
          <span className="text-gray-300 tabular-nums">—</span>
        )}
      </a>
    );
  });

  return (
    <>
    {/* 흐름상 여백 — 마지막 카드가 고정 티커바에 가리지 않게 */}
    <div style={{ height: TICKER_BAR_H }} aria-hidden />
    <div style={{ height: TICKER_BAR_H }}
         className="fixed bottom-0 left-0 right-0 z-30 flex items-center
                    bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
      {/* 묶음 선택 — 고른 쪽만 계속 표시(자동 전환 없음) */}
      <div className="shrink-0 flex items-center gap-0.5 pl-2 pr-1">
        {SCOPES.map(([v, label]) => (
          <button key={v} onClick={() => pickScope(v)}
                  title={`${label} 보기`}
                  className={`px-1.5 py-0.5 rounded text-[11px] transition
                              ${scope === v
                                ? "bg-gray-900 text-white font-bold"
                                : "text-gray-500 hover:bg-gray-100"}`}>
            {label}
          </button>
        ))}
      </div>

      <div ref={wrapRef}
           className={`flex-1 min-w-0 ${flow > 0 ? "overflow-hidden" : "overflow-x-auto ticker-scroll"}`}>
        <div className={`flex items-center gap-4 px-3 whitespace-nowrap w-max
                         ${flow > 0 ? "ticker-marquee" : "mx-auto"}`}
             style={flow > 0 ? { animationDuration: `${flow}s` } : undefined}>
          <div ref={rowRef} className="flex items-center gap-4">{row()}</div>
          {/* 흐를 때만 같은 줄을 한 벌 더 — 끊김 없이 이어지게 */}
          {flow > 0 && <div className="flex items-center gap-4" aria-hidden>{row()}</div>}
        </div>
      </div>

      <button onClick={() => setTickerBarOpen(false)}
              title="지수 띠 닫기"
              className="shrink-0 px-2 text-gray-400 hover:text-gray-700">
        <X size={13} />
      </button>
    </div>
    </>
  );
}
