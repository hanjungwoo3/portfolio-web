import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, type UsIndex } from "../lib/api";
import { US_PAIRS, type Pair } from "../lib/usMarketData";
import { signColor } from "../lib/format";
import { getPersonalProxyUrl, setPersonalProxyUrl } from "../lib/proxyConfig";

// 모바일 전용 단순 뷰.
// 목적: 아침에 일어나서 미국 증시 빠르게 확인 → 한국 증시 예측.
// 자동 갱신 X — 새로고침 버튼만. ETF/그룹/검색 등 모든 추가 기능 없음.

const SECTOR_EMOJI: Record<string, string> = {
  dashboard: "🌐",
  반도체: "🔧", 방산: "🛡", 중공업: "🏗", 리츠: "🏠", 에너지: "⚡",
  자동차: "🚗", 건설: "🏗", 금융: "💰", 플랫폼: "📱", 바이오: "🧬",
  로봇: "🤖", 한국지수: "🌏",
};

const SECTOR_LABEL: Record<string, string> = {
  dashboard: "핵심 대시보드",
};

function fmtPrice(symbol: string, price: number): string {
  if (symbol === "^TNX" || symbol === "^VIX") return price.toFixed(2);
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

interface RowProps {
  name: string;
  symbol: string;
  quote?: UsIndex;
  prefix?: string;          // "(선물)" 등 라벨
  muted?: boolean;          // 선물 행은 약간 흐릿
}

function Row({ name, symbol, quote, prefix, muted }: RowProps) {
  if (!quote) {
    return (
      <div className={`flex items-baseline gap-2 py-1 ${muted ? "opacity-70" : ""}`}>
        {prefix && <span className="text-[10px] text-gray-500">{prefix}</span>}
        <span className="text-sm text-gray-500">{name}</span>
        <span className="text-xs text-gray-400">—</span>
      </div>
    );
  }
  const sign = signColor(quote.diff);
  return (
    <div className={`flex items-baseline gap-2 py-1 flex-wrap
                      ${muted ? "opacity-70" : ""}`}>
      {prefix && (
        <span className="text-[10px] text-gray-500 shrink-0">{prefix}</span>
      )}
      <span className="text-sm text-gray-700 shrink-0">{name}</span>
      <span className="font-bold text-gray-900 text-sm tabular-nums">
        {fmtPrice(symbol, quote.price)}
      </span>
      <span className={`text-xs tabular-nums ${sign}`}>
        ({quote.pct >= 0 ? "+" : ""}{quote.pct.toFixed(2)}%)
      </span>
    </div>
  );
}

export function MobileSimpleView() {
  const [proxyUrl, setProxyUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    setProxyUrl(getPersonalProxyUrl() ?? "");
  }, []);

  // Yahoo batch 조회 — 본물 + 선물 한번에
  const symbols = US_PAIRS.flatMap(p =>
    p.future
      ? [{ symbol: p.symbol, name: p.name }, { symbol: p.future, name: `${p.name} 선물` }]
      : [{ symbol: p.symbol, name: p.name }]
  );

  const { data: usMap, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["mobile-yahoo-batch"],
    queryFn: () => fetchYahooBatch(symbols),
    refetchInterval: false,           // 자동 갱신 X
    refetchOnWindowFocus: false,
  });

  const updatedAt = dataUpdatedAt > 0
    ? new Date(dataUpdatedAt).toLocaleTimeString("ko-KR", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      })
    : "";

  // 새로고침 버튼 = 브라우저 페이지 reload (React Query cache + Service Worker 모두 초기화)
  const handleRefresh = () => location.reload();

  // 섹터별 그룹화 (코드 정의 순서 유지)
  const sectorGroups: { sector: string; pairs: Pair[] }[] = [];
  for (const p of US_PAIRS) {
    const last = sectorGroups[sectorGroups.length - 1];
    if (last && last.sector === p.sector) {
      last.pairs.push(p);
    } else {
      sectorGroups.push({ sector: p.sector, pairs: [p] });
    }
  }

  const saveProxy = () => {
    const v = proxyUrl.trim().replace(/\/+$/, "");
    setPersonalProxyUrl(v || null);
    setProxyUrl(v);
    setSavedMsg(v ? "✅ 전용 프록시 적용" : "✅ 공개 4-way 사용");
    setTimeout(() => setSavedMsg(""), 2000);
    void refetch();
  };

  const downOnBackdropRef = useRef(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200
                          px-3 py-2 flex items-center gap-2">
        <h1 className="text-base font-bold text-gray-800">📈 미국 증시</h1>
        {updatedAt && (
          <span className="text-[11px] text-gray-500">{updatedAt}</span>
        )}
        <button onClick={handleRefresh}
                disabled={isFetching}
                title="새로고침 (페이지 reload)"
                className="ml-auto p-1.5 rounded hover:bg-gray-100
                            disabled:opacity-50 transition">
          <span className={`inline-block ${isFetching ? "animate-spin" : ""}`}>🔄</span>
        </button>
        <button onClick={() => setSettingsOpen(true)}
                title="설정"
                className="p-1.5 rounded hover:bg-gray-100 transition">
          ⚙️
        </button>
      </header>

      <main className="px-3 py-2 space-y-3">
        {sectorGroups.map(({ sector, pairs }) => {
          const futuresPairs = pairs.filter(p => p.future);
          return (
            <section key={sector}
                     className="bg-white rounded-lg border border-gray-200 px-3 py-2">
              <div className="text-xs font-bold text-gray-600 mb-1.5 flex items-center gap-1">
                <span>{SECTOR_EMOJI[sector] ?? "•"}</span>
                <span>{SECTOR_LABEL[sector] ?? sector}</span>
              </div>
              {/* 1) 현물 종목들 먼저 */}
              <div className="space-y-0.5">
                {pairs.map(p => (
                  <Row key={p.symbol}
                       name={p.name}
                       symbol={p.symbol}
                       quote={usMap?.get(p.symbol)} />
                ))}
              </div>
              {/* 2) 선물들 섹터 맨 아래 별도 행 */}
              {futuresPairs.length > 0 && (
                <div className="space-y-0.5 mt-1.5 pt-1.5 border-t border-gray-100">
                  {futuresPairs.map(p => (
                    <Row key={p.future}
                         prefix="(선물)"
                         name={`${p.name} 선물`}
                         symbol={p.future!}
                         quote={usMap?.get(p.future!)}
                         muted />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {!usMap && isFetching && (
          <div className="text-center text-sm text-gray-400 py-8">
            로딩 중...
          </div>
        )}

        <div className="text-[10px] text-gray-400 text-center py-3">
          자동 갱신 없음 — 🔄 새로고침 버튼 눌러 수동 갱신
        </div>
      </main>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center
                         justify-center bg-black/40 p-3"
             onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
             onClick={e => {
               if (e.target === e.currentTarget && downOnBackdropRef.current) {
                 setSettingsOpen(false);
               }
             }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <header className="px-4 py-3 border-b bg-gray-50 flex items-center">
              <h2 className="text-base font-bold">⚙️ 설정</h2>
              <button onClick={() => setSettingsOpen(false)}
                      className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </header>
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  🔧 내 전용 프록시 URL (선택)
                </label>
                <p className="text-[11px] text-gray-500 mb-1.5">
                  비워두면 공개 4-way 사용. 본인 worker URL 입력 시 본인만 사용.
                </p>
                <a href="https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md"
                   target="_blank" rel="noopener noreferrer"
                   className="text-[11px] text-blue-600 underline block mb-2">
                  📖 배포 가이드 보기
                </a>
                <input type="text" value={proxyUrl}
                       onChange={e => setProxyUrl(e.target.value)}
                       placeholder="https://your-proxy.workers.dev"
                       className="w-full border rounded px-2 py-1.5 text-xs font-mono
                                  focus:outline-none focus:border-blue-500" />
                <button onClick={saveProxy}
                        className="mt-2 w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                                   text-white text-sm rounded font-medium">
                  저장
                </button>
                {savedMsg && (
                  <p className="text-[11px] text-emerald-700 mt-1">{savedMsg}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
