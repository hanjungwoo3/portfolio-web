// 섹터 ETF 팝업 — 지수 탭의 '섹터별 흐름' 에서 섹터를 누르면 뜬다.
//   그 섹터의 대표 ETF(거래대금 상위)를 등락률 순으로 보여주고, 종목을 누르면 구성종목 창으로 넘긴다.
//   데이터는 이미 받아둔 랭킹 스냅샷에서 나온다 — 추가 조회가 없다.

import { useEffect, useRef } from "react";
import { signColor } from "../lib/format";
import { tradeValue, type EtfSectorStat } from "../lib/etfSectors";

// 거래대금(추정) 표시 — 원 → 억/조.
function fmtValue(won: number): string {
  if (!(won > 0)) return "—";
  const jo = won / 1e12;
  if (jo >= 1) return `${jo.toFixed(2)}조`;
  return `${Math.round(won / 1e8).toLocaleString()}억`;
}

interface Props {
  sector: EtfSectorStat;
  onClose: () => void;
  onOpenEtfComposition?: (code: string, name: string) => void;
}

export function EtfSectorDialog({ sector, onClose, onOpenEtfComposition }: Props) {
  // 표시는 등락률 순 — 목록에 담긴 순서(거래대금 순)와 다르게 정렬한다.
  const rows = [...sector.rows].sort((a, b) => b.pct - a.pct);
  // 배경 클릭 판정 — 목록에서 드래그하다 배경에서 손을 떼도 닫히면 안 된다(앱의 다른 모달과 동일).
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) downOnBackdropRef.current = true; }}
         onMouseUp={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
           downOnBackdropRef.current = false;
         }}>
      <div className="w-full sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col
                      rounded-t-xl sm:rounded-xl bg-white shadow-xl"
           onMouseDown={e => e.stopPropagation()}>
        <header className="px-4 py-3 border-b bg-gray-50 flex items-baseline gap-2">
          <h2 className="text-base font-bold text-gray-800">{sector.label}</h2>
          <span className="text-[11px] text-gray-500">
            {sector.count}종 · 중앙값{" "}
            <span className={`font-bold tabular-nums ${signColor(sector.median)}`}>
              {sector.median > 0 ? "+" : ""}{sector.median.toFixed(2)}%
            </span>
          </span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </header>

        {/* 종목이 많은 섹터(미국·채권 등은 100종 넘음)는 여기서 스크롤된다 */}
        <div className="overflow-y-auto overscroll-contain">
          {rows.map((r, i) => (
            <button key={r.code}
                    onClick={() => onOpenEtfComposition?.(r.code, r.name)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gray-100
                               hover:bg-gray-50 transition-colors">
              <span className="w-5 shrink-0 text-[11px] tabular-nums text-gray-400 text-right">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm text-gray-800">{r.name}</span>
                <span className="block text-[11px] text-gray-400 tabular-nums">
                  거래대금 {fmtValue(tradeValue(r))}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block text-sm font-bold tabular-nums ${signColor(r.pct)}`}>
                  {r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%
                </span>
                <span className="block text-[11px] text-gray-600 tabular-nums">
                  {r.price.toLocaleString()}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="px-3 py-2 text-[10px] text-gray-400 border-t leading-relaxed">
          {sector.rows.length}종 전체 · 등락률 높은 순 (랭킹 조회 시점 기준).
          종목을 누르면 구성종목이 열립니다.
        </p>
      </div>
    </div>
  );
}
