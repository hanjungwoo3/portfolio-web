import { useState } from "react";
import { replaceAllHoldings } from "../lib/db";
import type { Stock } from "../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

interface ParseResult {
  ok: boolean;
  count?: number;
  error?: string;
  preview?: string[];
}

function validateJson(raw: string): ParseResult & { stocks?: Stock[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSON 파싱 실패" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "JSON 객체가 아님" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.holdings)) {
    return { ok: false, error: "'holdings' 배열이 없음" };
  }
  const stocks: Stock[] = [];
  for (let i = 0; i < obj.holdings.length; i++) {
    const item = obj.holdings[i];
    if (!item || typeof item !== "object") {
      return { ok: false, error: `${i}번 항목이 객체가 아님` };
    }
    const s = item as Record<string, unknown>;
    if (typeof s.ticker !== "string" || s.ticker.length === 0) {
      return { ok: false, error: `${i}번 항목 ticker 누락` };
    }
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
  return {
    ok: true,
    count: stocks.length,
    stocks,
    preview: stocks.slice(0, 3).map(s => `${s.ticker} ${s.name}`),
  };
}

export function ImportJsonDialog({ isOpen, onClose, onImported }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const result = raw.trim() ? validateJson(raw) : null;

  async function handleApply() {
    if (!result?.ok || !("stocks" in result) || !result.stocks) return;
    setBusy(true);
    setError(null);
    try {
      await replaceAllHoldings(result.stocks);
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
            데스크톱 v2 / 모바일의 <code className="px-1 bg-gray-100 rounded">holdings.json</code>{" "}
            전체 내용을 붙여넣으세요. 기존 데이터는 모두 교체됩니다.
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

          {result && (
            result.ok ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                <strong className="text-green-800">✓ 검증 통과:</strong>{" "}
                <span className="text-green-700">{result.count}개 종목</span>
                {result.preview && result.preview.length > 0 && (
                  <div className="mt-1 text-xs text-green-600">
                    예: {result.preview.join(" / ")}
                    {(result.count ?? 0) > 3 && " ..."}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm
                              text-red-700">
                <strong>✗ 검증 실패:</strong> {result.error}
              </div>
            )
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
            disabled={!result?.ok || busy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300
                       text-white rounded text-sm font-medium">
            {busy ? "저장 중..." : "적용"}
          </button>
        </footer>
      </div>
    </div>
  );
}
