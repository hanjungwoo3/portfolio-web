// 선 목록 — 차트와 **같은 상태**를 본다. 전체 지우기를 누르면 둘이 함께 비워진다
//   (참고 사이트에서 선은 사라졌는데 편집 목록이 남아 있던 문제 — 사양서 §2).

import { useEffect, useState } from "react";
import type { Drawing } from "../../lib/stockChart/types";
import { FIB_LEVELS } from "../../lib/stockChart/types";
import { parsePriceInput } from "../../lib/stockChart/geometry";
import { fullLabel, fmtKrw } from "../../lib/stockChart/lwAdapter";

const KIND_LABEL: Record<Drawing["type"], string> = {
  trend: "추세선", horizontal: "수평선", price: "가격선", fibonacci: "피보나치",
};

function PriceInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(Math.round(value)));
  const [bad, setBad] = useState(false);
  // 밖에서 값이 바뀌면(드래그·실행취소) 입력창도 따라간다.
  useEffect(() => { setText(String(Math.round(value))); setBad(false); }, [value]);

  const commit = () => {
    const v = parsePriceInput(text);
    if (v == null) { setBad(true); setText(String(Math.round(value))); return; }
    setBad(false);
    if (v !== value) onCommit(v);
  };
  return (
    <input
      value={text}
      inputMode="decimal"
      onChange={e => { setText(e.target.value); setBad(false); }}
      onBlur={commit}
      onKeyDown={e => {
        // 입력 중에는 Delete/Backspace 가 선을 지우면 안 된다 — 여기서 멈춘다.
        e.stopPropagation();
        if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setText(String(Math.round(value))); setBad(false); }
      }}
      className={`w-24 px-1.5 py-1 text-[11px] tabular-nums text-right rounded border
                  ${bad ? "border-rose-400 bg-rose-50" : "border-gray-300"}`}
      aria-label="가격"
    />
  );
}

export interface DrawingListProps {
  drawings: Drawing[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPrice: (id: string, price: number) => void;
  onDelete: (id: string) => void;
}

export function DrawingList({ drawings, selectedId, onSelect, onPrice, onDelete }: DrawingListProps) {
  if (drawings.length === 0) {
    return (
      <div className="text-[11px] text-gray-400 px-1 py-2">
        아직 그린 선이 없습니다. 위에서 도구를 고르고 차트를 클릭하세요.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 max-h-[168px] overflow-y-auto">
      {drawings.map(d => {
        const on = d.id === selectedId;
        return (
          <li key={d.id}
              onClick={() => onSelect(on ? null : d.id)}
              className={`flex items-center gap-2 px-1.5 py-1 cursor-pointer ${on ? "bg-blue-50" : "hover:bg-gray-50"}`}>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.style.color }} />
            <span className="text-[11px] font-bold text-gray-600 w-12 shrink-0">{KIND_LABEL[d.type]}</span>

            {(d.type === "horizontal" || d.type === "price") ? (
              <div onClick={e => e.stopPropagation()}>
                <PriceInput value={d.price} onCommit={v => onPrice(d.id, v)} />
              </div>
            ) : (
              <span className="text-[10px] text-gray-500 tabular-nums truncate">
                {fullLabel(d.a.time)} {fmtKrw(d.a.price)}
                {" → "}
                {fullLabel(d.b.time)} {fmtKrw(d.b.price)}
                {d.type === "fibonacci" && (
                  <span className="ml-1 text-gray-400">
                    ({(d.levels.length > 0 ? d.levels : FIB_LEVELS).length}단계)
                  </span>
                )}
              </span>
            )}

            <button type="button" aria-label="삭제"
                    onClick={e => { e.stopPropagation(); onDelete(d.id); }}
                    className="ml-auto shrink-0 min-w-[28px] min-h-[28px] text-gray-400 hover:text-rose-600 text-sm">
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}
