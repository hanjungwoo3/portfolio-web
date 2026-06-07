// 단일 종목이 포함된 ETF 리스트 다이얼로그.
// portfolio-etf-index 의 역색인 사용 (lib/etfIndex).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getEtfsContainingStock, type EtfHolding } from "../lib/etfIndex";
import { fetchTossPrices } from "../lib/api";
import { signColor, dayChangePct } from "../lib/format";
import { useEscClose } from "../lib/useEscClose";

interface Props {
  ticker: string;
  name: string;
  onClose: () => void;
  onOpenEtfComposition?: (etfCode: string, etfName: string) => void;   // ETF → 정방향(EtfCompositionDialog) 열기
  onRequestAdd?: (query: string) => void;                              // ETF 자체를 포트폴리오에 추가
}

export function EtfReverseDialog({ ticker, name, onClose, onOpenEtfComposition, onRequestAdd }: Props) {
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

  // 각 ETF 의 현재가/% (일반 검색과 동일하게 표시)
  const etfCodes = list?.map(h => h.etfCode) ?? [];
  const { data: priceList } = useQuery({
    queryKey: ["etf-reverse-dialog-prices", etfCodes],
    queryFn: () => fetchTossPrices(etfCodes),
    enabled: etfCodes.length > 0,
    staleTime: 30_000,
  });
  const priceMap = new Map((priceList ?? []).map(p => [p.ticker, p]));

  const downRef = { current: false };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
         onMouseDown={() => { downRef.current = true; }}
         onMouseUp={e => {
           // 백드롭 클릭 시 닫기 (다이얼로그 내부에서 down→up 이면 닫지 않음)
           if (downRef.current && e.target === e.currentTarget) onClose();
           downRef.current = false;
         }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg
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
                  <div key={h.etfCode}
                       className="group w-full flex items-baseline gap-2 px-2 py-1.5 rounded
                                  border border-gray-200 hover:border-amber-300
                                  hover:bg-amber-50/30 transition">
                    <span className="text-xs text-gray-500 font-mono tabular-nums shrink-0">
                      {h.etfCode}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{h.etfName}</span>
                    {(() => {
                      const p = priceMap.get(h.etfCode);
                      if (!p) return null;
                      const pct = dayChangePct(p);
                      return (
                        <span className="shrink-0 tabular-nums text-xs self-center">
                          <span className="font-bold text-gray-800">{p.price.toLocaleString()}원</span>
                          {pct !== undefined && (
                            <span className={`ml-1 ${signColor(pct)}`}>
                              {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                            </span>
                          )}
                        </span>
                      );
                    })()}
                    {/* + 포트폴리오 추가 — 기본 흐림 */}
                    {onRequestAdd && (
                      <button onClick={() => onRequestAdd(h.etfCode)}
                              title={`${h.etfName} 포트폴리오에 추가`}
                              className="shrink-0 px-1.5 py-0 rounded text-[11px] font-bold leading-none self-center
                                         text-emerald-700 bg-emerald-50 border border-emerald-200
                                         opacity-30 group-hover:opacity-80 hover:!opacity-100
                                         hover:bg-emerald-100 transition">
                        ＋
                      </button>
                    )}
                    {/* 🍱 구성종목 보기 */}
                    {onOpenEtfComposition && (
                      <button onClick={() => onOpenEtfComposition(h.etfCode, h.etfName)}
                              title={`${h.etfName} 구성종목 보기`}
                              className="shrink-0 px-1.5 py-0 rounded text-[11px] font-bold leading-none self-center
                                         text-amber-700 bg-amber-50 border border-amber-200
                                         opacity-30 group-hover:opacity-80 hover:!opacity-100
                                         hover:bg-amber-100 transition">
                        🍱
                      </button>
                    )}
                    <span className="shrink-0 tabular-nums text-sm self-center">
                      <span className="text-[10px] text-gray-400 mr-0.5">비중</span>
                      <span className="font-bold text-rose-600">{h.ratio.toFixed(2)}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
