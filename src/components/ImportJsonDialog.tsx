import { useState } from "react";
import { replaceAllHoldings, replaceAllPeaks } from "../lib/db";
import type { Stock } from "../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Detected =
  | { kind: "holdings"; stocks: Stock[] }
  | { kind: "peaks"; peaks: Record<string, number> }
  | { kind: "combined"; stocks: Stock[]; peaks: Record<string, number> }
  | { kind: "error"; error: string };

function detect(raw: string): Detected {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : "JSON 파싱 실패" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { kind: "error", error: "JSON 객체가 아님" };
  }
  const obj = parsed as Record<string, unknown>;

  // 패턴 1: { holdings: [...], (peaks?: {...}) } — desktop holdings.json
  if (Array.isArray(obj.holdings)) {
    const stocks = parseHoldings(obj.holdings);
    if (typeof stocks === "string") return { kind: "error", error: stocks };
    if (obj.peaks && typeof obj.peaks === "object" && !Array.isArray(obj.peaks)) {
      return { kind: "combined", stocks, peaks: obj.peaks as Record<string, number> };
    }
    return { kind: "holdings", stocks };
  }

  // 패턴 2: { "005930": 251500, "000660": 220000, ... } — desktop peaks.json
  // 모든 값이 숫자이고 키가 6자리 코드 형식이면 peaks 로 판정
  const entries = Object.entries(obj);
  if (entries.length > 0 && entries.every(([k, v]) =>
        /^\d{6}$/.test(k) && typeof v === "number" && v > 0)) {
    return { kind: "peaks", peaks: obj as Record<string, number> };
  }

  return { kind: "error", error: "알 수 없는 JSON 형식 — holdings.json 또는 peaks.json" };
}

function parseHoldings(arr: unknown[]): Stock[] | string {
  const stocks: Stock[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== "object") return `${i}번 항목이 객체가 아님`;
    const s = item as Record<string, unknown>;
    if (typeof s.ticker !== "string" || s.ticker.length === 0)
      return `${i}번 항목 ticker 누락`;
    stocks.push({
      ticker: s.ticker,
      name: typeof s.name === "string" ? s.name : s.ticker,
      shares: typeof s.shares === "number" ? s.shares : 0,
      avg_price: typeof s.avg_price === "number" ? s.avg_price : 0,
      invested: typeof s.invested === "number" ? s.invested : undefined,
      buy_date: typeof s.buy_date === "string" ? s.buy_date : undefined,
      market: typeof s.market === "string" ? s.market : undefined,
      account: typeof s.account === "string" ? s.account : "",
    });
  }
  return stocks;
}

export function ImportJsonDialog({ isOpen, onClose, onImported }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const result = raw.trim() ? detect(raw) : null;

  async function handleApply() {
    if (!result || result.kind === "error") return;
    setBusy(true);
    setError(null);
    try {
      if (result.kind === "holdings" || result.kind === "combined") {
        // eslint-disable-next-line no-console
        console.log(`[v3 import] holdings=${result.stocks.length}`);
        await replaceAllHoldings(result.stocks);
      }
      if (result.kind === "peaks" || result.kind === "combined") {
        // eslint-disable-next-line no-console
        console.log(`[v3 import] peaks=${Object.keys(result.peaks).length}`,
                     "sample:", Object.entries(result.peaks).slice(0, 3));
        await replaceAllPeaks(result.peaks);
      }
      onImported();
      onClose();
      setRaw("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      setRaw(text);
    } catch {
      setError("클립보드 읽기 실패 — 직접 붙여넣어주세요 (Cmd+V)");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/40 p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full
                       max-h-[90vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <header className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">📥 JSON 가져오기</h2>
          <button onClick={onClose}
                  className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </header>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-sm text-gray-600">
            데스크톱 <code className="px-1 bg-gray-100 rounded">holdings.json</code> 또는{" "}
            <code className="px-1 bg-gray-100 rounded">peaks.json</code> 내용을 붙여넣으세요.
            형식 자동 감지. 기존 데이터는 교체됩니다 (피크가는 피크가만, 보유는 보유만).
          </p>

          <div className="flex gap-2">
            <button
              onClick={handlePaste}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600
                         text-white rounded text-sm font-medium">
              📋 클립보드에서 붙여넣기
            </button>
            <button
              onClick={() => setRaw("")}
              className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300
                         text-gray-700 rounded text-sm">
              지우기
            </button>
          </div>

          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder='{\n  "holdings": [\n    { "ticker": "005930", "name": "삼성전자", "shares": 10, "avg_price": 200000 }\n  ]\n}'
            className="w-full h-64 p-3 border border-gray-300 rounded
                       font-mono text-xs resize-none
                       focus:outline-none focus:border-blue-400"
            spellCheck={false}
          />

          {result && result.kind === "error" && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm
                            text-red-700">
              <strong>✗ 검증 실패:</strong> {result.error}
            </div>
          )}
          {result && result.kind === "holdings" && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
              <strong className="text-green-800">✓ holdings.json:</strong>{" "}
              <span className="text-green-700">{result.stocks.length}개 종목</span>
              {result.stocks.length > 0 && (
                <div className="mt-1 text-xs text-green-600">
                  예: {result.stocks.slice(0, 3)
                    .map(s => `${s.ticker} ${s.name}`).join(" / ")}
                  {result.stocks.length > 3 && " ..."}
                </div>
              )}
            </div>
          )}
          {result && result.kind === "peaks" && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
              <strong className="text-green-800">✓ peaks.json:</strong>{" "}
              <span className="text-green-700">
                {Object.keys(result.peaks).length}개 피크가
              </span>
            </div>
          )}
          {result && result.kind === "combined" && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
              <strong className="text-green-800">✓ holdings + peaks 통합:</strong>{" "}
              <span className="text-green-700">
                {result.stocks.length}개 종목 + {Object.keys(result.peaks).length}개 피크가
              </span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm
                            text-red-700">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300
                             text-gray-700 rounded text-sm">
            취소
          </button>
          <button
            onClick={handleApply}
            disabled={!result || result.kind === "error" || busy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300
                       text-white rounded text-sm font-medium">
            {busy ? "저장 중..." : "적용"}
          </button>
        </footer>
      </div>
    </div>
  );
}
