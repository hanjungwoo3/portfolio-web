// 단일 종목이 포함된 ETF 리스트 다이얼로그.
// portfolio-etf-index 의 역색인 사용 (lib/etfIndex).

import { useEffect, useState } from "react";
import { getEtfsContainingStock, type EtfHolding } from "../lib/etfIndex";
import { useEscClose } from "../lib/useEscClose";

interface Props {
  ticker: string;
  name: string;
  onClose: () => void;
  onOpenEtfComposition?: (etfCode: string, etfName: string) => void;   // ETF → 정방향(EtfCompositionDialog) 열기
}

export function EtfReverseDialog({ ticker, name, onClose, onOpenEtfComposition }: Props) {
  const [list, setList] = useState<EtfHolding[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEscClose(true, onClose);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getEtfsContainingStock(ticker);
        if (alive) setList(r);
      } catch (e) {
        if (alive) setErr(String(e));
      }
    })();
    return () => { alive = false; };
  }, [ticker]);

  const downRef = { current: false };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
         onMouseDown={() => { downRef.current = true; }}
         onMouseUp={e => {
           // 백드롭 클릭 시 닫기 (다이얼로그 내부에서 down→up 이면 닫지 않음)
           if (downRef.current && e.target === e.currentTarget) onClose();
           downRef.current = false;
         }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md
                      max-h-[85vh] flex flex-col"
           onMouseDown={e => e.stopPropagation()}>
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
          <span className="text-base">🍱</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500 leading-tight">이 종목이 포함된 ETF</div>
            <div className="font-bold truncate">{name} <span className="text-gray-500 font-normal">({ticker})</span></div>
          </div>
          <button onClick={onClose} title="닫기"
                  className="text-gray-500 hover:text-gray-900 text-xl px-1 leading-none">×</button>
        </header>

        <div className="overflow-y-auto p-3 flex-1">
          {err ? (
            <div className="text-rose-600 text-sm py-6 text-center">데이터 로드 실패: {err}</div>
          ) : list === null ? (
            <div className="text-gray-400 text-sm py-8 text-center">불러오는 중…</div>
          ) : list.length === 0 ? (
            <div className="text-gray-500 text-sm py-8 text-center">
              이 종목을 포함한 ETF가 데이터에 없습니다.<br/>
              <span className="text-[11px] text-gray-400">
                (집계: 매일 06:00 KST · 일부 신규/소형 ETF 제외 가능)
              </span>
            </div>
          ) : (
            <>
              <div className="text-[11px] text-gray-500 mb-2 px-1">
                총 <b className="text-gray-800">{list.length}</b>개 ETF · 비중 내림차순
              </div>
              <div className="space-y-1">
                {list.map(h => (
                  <button key={h.etfCode}
                          onClick={() => onOpenEtfComposition?.(h.etfCode, h.etfName)}
                          className="w-full flex items-baseline gap-2 px-2 py-1.5 rounded
                                     border border-gray-200 hover:border-amber-300
                                     hover:bg-amber-50/40 text-left transition">
                    <span className="text-xs text-gray-500 font-mono tabular-nums shrink-0">
                      {h.etfCode}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{h.etfName}</span>
                    <span className="font-bold tabular-nums text-rose-600 text-sm shrink-0">
                      {h.ratio.toFixed(2)}%
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
