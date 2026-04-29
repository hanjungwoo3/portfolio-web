import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch } from "../lib/api";
import {
  US_PAIRS, SECTOR_EMOJI, SECTOR_ORDER,
} from "../lib/usMarketData";
import { signColor, isSymbolSleeping } from "../lib/format";
import { getPersonalProxyUrl, setPersonalProxyUrl } from "../lib/proxyConfig";
import { exportAll, replaceAllHoldings, replaceAllPeaks } from "../lib/db";
import { detectPortfolioJson } from "../lib/portfolioImport";

// 모바일 전용 단순 뷰 (v2 데스크톱 미국증시 표 형식 그대로 이식)
// 자동 갱신 X — 새로고침 버튼만. 자기 주식/그룹/검색 등 모든 추가 기능 없음.

function fmtPrice(symbol: string, price: number): string {
  if (symbol === "^TNX" || symbol === "^VIX") return price.toFixed(2);
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

interface QuoteRow {
  kind: "spot" | "future";
  symbol: string;
  name: string;
  desc?: string;
  price?: number;
  pct?: number;
  diff?: number;
  sleeping: boolean;
}

export function MobileSimpleView() {
  const [proxyUrl, setProxyUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    setProxyUrl(getPersonalProxyUrl() ?? "");
  }, []);

  // Yahoo: 본물 + 선물 평탄화 (선행지수만 — ETF 제외)
  const yahooSymbols = US_PAIRS.flatMap(p =>
    p.future
      ? [{ symbol: p.symbol, name: p.name }, { symbol: p.future, name: `${p.name} 선물` }]
      : [{ symbol: p.symbol, name: p.name }]
  );

  const { data: usMap, isFetching, dataUpdatedAt: usAt } = useQuery({
    queryKey: ["m-yahoo"],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const updatedAt = usAt > 0
    ? new Date(usAt).toLocaleTimeString("ko-KR", {
        hour: "2-digit", minute: "2-digit",
      })
    : "";

  const handleRefresh = () => location.reload();

  // ─── Tier 0 (대시보드 4개) ───
  const tier0 = US_PAIRS.filter(p => p.tier === "T0");

  // ─── 섹터별 행 묶음 (현물 + 선물만, ETF 제외) ───
  function buildRowsForSector(sector: string): QuoteRow[] {
    const rows: QuoteRow[] = [];
    const sectorPairs = US_PAIRS.filter(p => p.tier !== "T0" && p.sector === sector);

    // 1) 현물
    for (const p of sectorPairs) {
      const q = usMap?.get(p.symbol);
      rows.push({
        kind: "spot", symbol: p.symbol, name: p.name, desc: p.desc,
        price: q?.price, pct: q?.pct, diff: q?.diff,
        sleeping: isSymbolSleeping(p.symbol),
      });
    }
    // 2) 선물 (현물들 다음에 모아서, 옅은 노랑 배경)
    for (const p of sectorPairs) {
      if (!p.future) continue;
      const fq = usMap?.get(p.future);
      rows.push({
        kind: "future", symbol: p.future, name: `${p.name} 선물`,
        desc: `${p.name} 선물 — 정규장 외 흐름 체크`,
        price: fq?.price, pct: fq?.pct, diff: fq?.diff,
        sleeping: isSymbolSleeping(p.future),
      });
    }
    return rows;
  }

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

      {/* ─── Tier 0 핵심 대시보드 (2 columns 카드) ─── */}
      <div className="px-3 py-2 grid grid-cols-2 gap-2">
        {tier0.map(p => {
          const q = usMap?.get(p.symbol);
          const sleeping = isSymbolSleeping(p.symbol);
          // 표와 동일한 +/- 행 배경 + 색상
          const bg =
            q && q.diff > 0 ? "bg-rose-50 border-rose-200"
            : q && q.diff < 0 ? "bg-blue-50/70 border-blue-200"
            : "bg-white border-gray-200";
          const sign = q ? signColor(q.diff) : "text-gray-400";
          return (
            <div key={p.symbol}
                 className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2
                              ${bg} ${sleeping ? "opacity-60" : ""}`}>
              <div className="flex items-baseline gap-1.5">
                {sleeping && (
                  <span className="text-[11px] text-gray-400">zZ</span>
                )}
                <span className="text-base font-bold text-gray-900">
                  {p.name}
                </span>
              </div>
              <div className="text-[11px] text-gray-500 truncate">
                {p.desc}
              </div>
              <div className="flex items-baseline mt-0.5">
                <span className="flex-1 text-left text-sm tabular-nums text-gray-700">
                  {q ? fmtPrice(p.symbol, q.price) : "—"}
                </span>
                <span className={`flex-1 text-right text-base font-bold tabular-nums ${sign}`}>
                  {q ? `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 섹터 표 ─── */}
      <div className="px-3 pb-2">
        <table className="w-full bg-white rounded-lg border border-gray-200
                           overflow-hidden text-sm">
          <thead className="bg-gray-100 text-gray-600 text-xs">
            <tr>
              <th className="px-2 py-2 text-left w-16">섹터</th>
              <th className="px-2 py-2 text-left">종목</th>
              <th className="px-2 py-2 text-right">현재가</th>
              <th className="px-2 py-2 text-right w-24">등락%</th>
            </tr>
          </thead>
          <tbody>
            {SECTOR_ORDER.map(sector => {
              const rows = buildRowsForSector(sector);
              if (rows.length === 0) return null;
              return rows.map((r, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === rows.length - 1;
                const sign = r.diff !== undefined ? signColor(r.diff) : "text-gray-400";
                // 등락에 따라 행 전체 배경 — 양수 옅은 빨강 / 음수 옅은 파랑
                const rowBg =
                  r.diff !== undefined && r.diff > 0 ? "bg-rose-50"
                  : r.diff !== undefined && r.diff < 0 ? "bg-blue-50/70"
                  : "";
                // 섹터 끝에 구분선 / 행 사이엔 옅은 선
                const borderCls = isLast
                  ? "border-b border-gray-300"
                  : "border-b border-gray-100";
                return (
                  <tr key={`${sector}-${r.symbol}`}
                      className={`${borderCls} ${rowBg}
                                   ${r.sleeping ? "opacity-60" : ""}`}>
                    {isFirst ? (
                      <td className="px-2 py-2 font-bold text-gray-800 align-middle
                                      bg-slate-200 border-r border-gray-300"
                          rowSpan={rows.length}>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-2xl">{SECTOR_EMOJI[sector] ?? "•"}</span>
                          <span className="text-xs font-bold">{sector}</span>
                        </div>
                      </td>
                    ) : null}
                    <td className="px-2 py-2">
                      <div className="flex items-baseline gap-1">
                        {r.sleeping && (
                          <span className="text-[11px] text-gray-400">zZ</span>
                        )}
                        <span className={`text-base font-bold
                                          ${r.kind === "future" ? "text-amber-700"
                                            : "text-gray-900"}`}>
                          {r.name}
                        </span>
                      </div>
                      {r.desc && (
                        <div className="text-[11px] text-gray-500 truncate
                                          max-w-[180px] mt-0.5">
                          {r.desc}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-900 font-medium">
                      {r.price !== undefined ? fmtPrice(r.symbol, r.price) : "—"}
                    </td>
                    <td className={`px-2 py-2 text-right tabular-nums text-base font-bold ${sign}`}>
                      {r.pct !== undefined
                        ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>

        <div className="text-[10px] text-gray-400 text-center mt-3 mb-2">
          자동 갱신 없음 — 🔄 눌러 수동 갱신
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal proxyUrl={proxyUrl} setProxyUrl={setProxyUrl}
                       savedMsg={savedMsg} setSavedMsg={setSavedMsg}
                       onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

interface SettingsModalProps {
  proxyUrl: string;
  setProxyUrl: (v: string) => void;
  savedMsg: string;
  setSavedMsg: (v: string) => void;
  onClose: () => void;
}

function SettingsModal({
  proxyUrl, setProxyUrl, savedMsg, setSavedMsg, onClose,
}: SettingsModalProps) {
  const downOnBackdropRef = useRef(false);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState("");

  // 모달 열릴 때 현재 데이터 export 해서 textarea 채움
  useEffect(() => {
    void (async () => {
      const data = await exportAll();
      setRaw(JSON.stringify(data, null, 2));
      setDataMsg(`현재: 종목 ${data.holdings.length}건 / 피크 ${Object.keys(data.peaks).length}건`);
    })();
  }, []);

  const saveProxy = () => {
    const v = proxyUrl.trim().replace(/\/+$/, "");
    setPersonalProxyUrl(v || null);
    setProxyUrl(v);
    setSavedMsg(v ? "✅ 전용 프록시 적용 — 새로고침 후 적용" : "✅ 공개 4-way 사용");
    setTimeout(() => setSavedMsg(""), 2500);
  };

  const result = detectPortfolioJson(raw);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setDataMsg("✅ 클립보드 복사됨");
    } catch {
      setDataMsg("❌ 복사 실패 — textarea 직접 선택해서 복사");
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRaw(text);
      setDataMsg("📥 클립보드에서 가져옴 — [적용] 누르면 덮어쓰기");
    } catch {
      setDataMsg("❌ 클립보드 읽기 실패 — textarea 에 직접 붙여넣어 주세요");
    }
  };

  const handleApply = async () => {
    if (!result || result.kind === "error") return;
    setBusy(true);
    try {
      if (result.kind === "holdings" || result.kind === "combined") {
        await replaceAllHoldings(result.stocks);
      }
      if (result.kind === "peaks" || result.kind === "combined") {
        await replaceAllPeaks(result.peaks);
      }
      setDataMsg("💾 적용 완료");
    } catch (e) {
      setDataMsg(`❌ 저장 실패: ${e instanceof Error ? e.message : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center
                     justify-center bg-black/40 p-3"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm
                       max-h-[90vh] flex flex-col">
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center">
          <h2 className="text-base font-bold">⚙️ 설정</h2>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        <div className="px-4 py-3 space-y-4 overflow-y-auto flex-1">

          {/* 1) 전용 프록시 URL */}
          <div className="border border-gray-200 rounded p-3 bg-blue-50/30 space-y-1">
            <label className="text-xs font-bold text-gray-700 block">
              🔧 내 전용 프록시 URL (선택)
            </label>
            <p className="text-[11px] text-gray-500">
              비워두면 공개 4-way 사용. 본인 worker URL 입력 시 본인만 사용.
            </p>
            <a href="https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md"
               target="_blank" rel="noopener noreferrer"
               className="text-[11px] text-blue-600 underline block">
              📖 배포 가이드 보기
            </a>
            <input type="text" value={proxyUrl}
                   onChange={e => setProxyUrl(e.target.value)}
                   placeholder="https://your-proxy.workers.dev"
                   className="w-full border rounded px-2 py-1.5 text-xs font-mono
                              focus:outline-none focus:border-blue-500" />
            <button onClick={saveProxy}
                    className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                               text-white text-sm rounded font-medium">
              저장
            </button>
            {savedMsg && (
              <p className="text-[11px] text-emerald-700">{savedMsg}</p>
            )}
          </div>

          {/* 2) 포트폴리오 데이터 import/export */}
          <div className="border border-gray-200 rounded p-3 space-y-2">
            <label className="text-xs font-bold text-gray-700 block">
              💼 포트폴리오 데이터 (JSON)
            </label>
            <p className="text-[11px] text-gray-500">{dataMsg || "holdings + peaks 통합 JSON"}</p>
            <textarea
              value={raw}
              onChange={e => setRaw(e.target.value)}
              placeholder='{"holdings": [...], "peaks": {...}}'
              spellCheck={false}
              className="w-full h-40 p-2 border border-gray-300 rounded
                         font-mono text-[11px] resize-none
                         focus:outline-none focus:border-blue-400" />

            {/* 미리보기 */}
            {result && result.kind === "error" && (
              <div className="p-2 bg-red-50 border border-red-200 rounded
                              text-[11px] text-red-700">
                ✗ {result.error}
              </div>
            )}
            {result && result.kind === "holdings" && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded
                              text-[11px] text-blue-800">
                ✓ 종목 {result.stocks.length}건
              </div>
            )}
            {result && result.kind === "peaks" && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded
                              text-[11px] text-blue-800">
                ✓ 피크 {Object.keys(result.peaks).length}건
              </div>
            )}
            {result && result.kind === "combined" && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded
                              text-[11px] text-blue-800">
                ✓ 종목 {result.stocks.length}건 + 피크 {Object.keys(result.peaks).length}건
              </div>
            )}

            <div className="flex gap-1.5">
              <button onClick={() => void handleCopy()}
                      className="flex-1 px-2 py-1.5 bg-gray-100 hover:bg-gray-200
                                 text-gray-700 text-xs rounded">
                📋 복사
              </button>
              <button onClick={() => void handlePaste()}
                      className="flex-1 px-2 py-1.5 bg-gray-100 hover:bg-gray-200
                                 text-gray-700 text-xs rounded">
                📥 붙여넣기
              </button>
              <button onClick={() => void handleApply()}
                      disabled={!result || result.kind === "error" || busy}
                      className="flex-1 px-2 py-1.5 bg-rose-600 hover:bg-rose-700
                                 disabled:bg-gray-300
                                 text-white text-xs rounded font-bold">
                {busy ? "..." : "💾 적용"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
