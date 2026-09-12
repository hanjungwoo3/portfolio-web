// 도구 행 — 봉 주기 · 이동평균 · 그리기 도구.
//   메뉴를 여닫을 때 차트가 밀리지 않도록 드롭다운은 absolute 로 띄운다(사양서 §3-6).

import { useEffect, useRef, useState } from "react";
import type { Interval, DrawingKind } from "../../lib/stockChart/types";
import { INTERVAL_LABEL, INTRADAY_INTERVALS, LONG_INTERVALS } from "../../lib/stockChart/types";

const ACTIVE = "#2F66D0";

function Dropdown({ label, active, children }: {
  label: string; active?: boolean; children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
              className={`min-h-[36px] px-2.5 rounded border text-xs font-bold transition ${
                active ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
              style={active ? { background: ACTIVE } : undefined}>
        {label} ▾
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-[140px] rounded border border-gray-200 bg-white shadow-lg p-1">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const itemCls = (on: boolean) =>
  `w-full text-left px-2 py-1.5 rounded text-xs min-h-[36px] ${
    on ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-600 hover:bg-gray-50"}`;

export interface ToolbarProps {
  interval: Interval;
  supported: Interval[];
  onInterval: (iv: Interval) => void;
  maPeriods: number[];
  onToggleMa: (p: number) => void;
  tool: DrawingKind | null;
  onTool: (t: DrawingKind | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasDrawings: boolean;
}

export const MA_CHOICES = [5, 10, 20, 30, 60, 80, 120, 240];
const TOOLS: { kind: DrawingKind; label: string }[] = [
  { kind: "trend", label: "추세선" },
  { kind: "horizontal", label: "수평선" },
  { kind: "price", label: "가격선" },
  { kind: "fibonacci", label: "피보나치" },
];

export function ChartToolbar(p: ToolbarProps) {
  const intraOn = INTRADAY_INTERVALS.includes(p.interval);
  const btn = "min-h-[36px] px-2.5 rounded border text-xs font-bold bg-white text-gray-600 "
            + "border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed";

  const intervalItem = (iv: Interval, close: () => void) => {
    const ok = p.supported.includes(iv);
    return (
      <button key={iv} type="button" disabled={!ok} className={itemCls(p.interval === iv)}
              title={ok ? undefined : "데이터 미지원 — 시세 공급자가 이 주기를 제공하지 않습니다"}
              onClick={() => { if (ok) { p.onInterval(iv); close(); } }}>
        {INTERVAL_LABEL[iv]}
        {!ok && <span className="ml-1 text-[10px] text-gray-400">데이터 미지원</span>}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Dropdown label={intraOn ? INTERVAL_LABEL[p.interval] : "분봉"} active={intraOn}>
        {close => <>{INTRADAY_INTERVALS.map(iv => intervalItem(iv, close))}</>}
      </Dropdown>
      <Dropdown label={!intraOn ? INTERVAL_LABEL[p.interval] : "일봉"} active={!intraOn}>
        {close => <>{LONG_INTERVALS.map(iv => intervalItem(iv, close))}</>}
      </Dropdown>

      <Dropdown label="지표">
        {() => (
          <>
            <div className="px-2 py-1 text-[10px] text-gray-400">이동평균 (SMA)</div>
            {MA_CHOICES.map(n => (
              <button key={n} type="button" className={itemCls(p.maPeriods.includes(n))}
                      onClick={() => p.onToggleMa(n)}>
                MA {n}
              </button>
            ))}
            <div className="px-2 py-1 mt-1 border-t border-gray-100 text-[10px] text-gray-400 leading-snug">
              볼린저·RSI·MACD 등은 아직 없습니다.<br />동작하지 않는 메뉴는 띄우지 않았습니다.
            </div>
          </>
        )}
      </Dropdown>

      <span className="w-px h-6 bg-gray-200 mx-0.5" />

      {TOOLS.map(t => (
        <button key={t.kind} type="button"
                onClick={() => p.onTool(p.tool === t.kind ? null : t.kind)}
                className={`min-h-[36px] px-2.5 rounded border text-xs font-bold transition ${
                  p.tool === t.kind ? "text-white border-transparent"
                                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
                style={p.tool === t.kind ? { background: ACTIVE } : undefined}>
          {t.label}
        </button>
      ))}

      <button type="button" className={btn} onClick={p.onUndo} disabled={!p.canUndo}
              title="실행취소 (Ctrl/Cmd+Z)">↶ 실행취소</button>
      <button type="button" className={btn} onClick={p.onRedo} disabled={!p.canRedo}
              title="다시 실행 (Ctrl/Cmd+Shift+Z)">↷ 다시 실행</button>
      <button type="button" className={btn} onClick={p.onClearAll} disabled={!p.hasDrawings}>
        전체 지우기
      </button>
    </div>
  );
}
