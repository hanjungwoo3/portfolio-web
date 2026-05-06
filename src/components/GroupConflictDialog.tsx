// 그룹별 독립 보유 모드 OFF 전환 시 — 충돌 해결 모달
// 같은 종목이 그룹마다 다른 값으로 저장된 경우 사용자에게 통일 방법 묻기

import { useState } from "react";
import {
  type TickerConflict, resolveConflictUseGroup, resolveConflictMerge,
} from "../lib/db";

type Strategy = "groupA" | "groupB" | "merge" | "skip";

interface Props {
  conflicts: TickerConflict[];
  onResolved: () => void;     // 모두 해결 후 콜백 (재렌더 등)
  onClose: () => void;
}

export function GroupConflictDialog({ conflicts, onResolved, onClose }: Props) {
  // 종목별 처리 방식 + 어느 그룹 선택 (groupA/groupB 모드일 때)
  const [strategies, setStrategies] = useState<Map<string, { mode: Strategy; account?: string }>>(
    new Map()
  );
  const [busy, setBusy] = useState(false);

  if (conflicts.length === 0) return null;

  const setMode = (ticker: string, mode: Strategy, account?: string) => {
    const next = new Map(strategies);
    next.set(ticker, { mode, account });
    setStrategies(next);
  };

  // 일괄 적용
  const applyAll = (mode: Strategy) => {
    const next = new Map<string, { mode: Strategy; account?: string }>();
    for (const c of conflicts) {
      next.set(c.ticker, { mode });
    }
    setStrategies(next);
  };

  const allDecided = conflicts.every(c => {
    const s = strategies.get(c.ticker);
    if (!s) return false;
    // 보유 그룹은 account === "" (빈 문자열) 이므로 typeof 체크 — falsy 함정 회피
    if ((s.mode === "groupA" || s.mode === "groupB") && typeof s.account !== "string") return false;
    return true;
  });

  const handleResolve = async () => {
    if (!allDecided) return;
    setBusy(true);
    try {
      for (const c of conflicts) {
        const s = strategies.get(c.ticker)!;
        if (s.mode === "skip") continue;
        if (s.mode === "merge") {
          await resolveConflictMerge(c.ticker);
        } else if (typeof s.account === "string") {
          await resolveConflictUseGroup(c.ticker, s.account);
        }
      }
      onResolved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const fmtRow = (r: TickerConflict["rows"][0]) =>
    `${r.account || "(보유)"}: ${r.shares}주, 평단 ${Math.round(r.avg_price).toLocaleString()}원`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <header className="px-5 py-3 border-b">
          <h2 className="font-bold text-gray-800">⚠️ 그룹별 종목 값 충돌</h2>
          <p className="text-xs text-gray-500 mt-1">
            sync 모드로 전환됩니다. 같은 종목이 그룹마다 다른 값으로 저장된 경우 통일 방법을 선택해주세요.
          </p>
        </header>

        <div className="px-5 py-3 border-b bg-gray-50">
          <div className="text-xs text-gray-600 mb-2">일괄 적용:</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => applyAll("merge")}
                    className="px-2 py-1 text-xs bg-emerald-100 hover:bg-emerald-200 rounded">
              모두 합산 (수량+, 가중평균)
            </button>
            <button onClick={() => applyAll("skip")}
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded">
              모두 그대로 두기
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {conflicts.map(c => {
            const s = strategies.get(c.ticker);
            return (
              <div key={c.ticker} className="border border-gray-200 rounded p-3">
                <div className="font-bold text-sm text-gray-800 mb-2">
                  {c.name} <span className="text-xs text-gray-500">({c.ticker})</span>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5 mb-3">
                  {c.rows.map((r, i) => <div key={i}>• {fmtRow(r)}</div>)}
                </div>

                <div className="space-y-1">
                  {c.rows.map((r, i) => (
                    <label key={i} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio"
                             name={`s-${c.ticker}`}
                             checked={s?.mode === (i === 0 ? "groupA" : "groupB") && s?.account === r.account}
                             onChange={() => setMode(c.ticker, i === 0 ? "groupA" : "groupB", r.account)} />
                      <span><b>"{r.account || "보유"}"</b> 그룹 값으로 통일 ({r.shares}주, 평단 {Math.round(r.avg_price).toLocaleString()}원)</span>
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" name={`s-${c.ticker}`}
                           checked={s?.mode === "merge"}
                           onChange={() => setMode(c.ticker, "merge")} />
                    <span>합산 — 수량 더하기 + 평단 가중평균</span>
                  </label>
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="radio" name={`s-${c.ticker}`}
                           checked={s?.mode === "skip"}
                           onChange={() => setMode(c.ticker, "skip")}
                           className="mt-0.5" />
                    <span className="flex-1">
                      <span className="text-gray-500">그대로 두기</span>
                      <span className="block text-[10px] text-gray-400 mt-0.5">
                        지금은 그룹별 값 차이 유지. 다음에 어느 그룹에서 수정 → 그 시점에 그 값이 다른 그룹에도 자동 적용됩니다 (sync 재개).
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="px-5 py-3 border-t flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {strategies.size} / {conflicts.length} 결정됨
          </span>
          <button onClick={onClose}
                  disabled={busy}
                  className="ml-auto px-3 py-1.5 rounded text-sm bg-gray-100 hover:bg-gray-200">
            취소
          </button>
          <button onClick={handleResolve}
                  disabled={!allDecided || busy}
                  className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-700
                             text-white disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? "적용 중..." : "적용"}
          </button>
        </footer>
      </div>
    </div>
  );
}
