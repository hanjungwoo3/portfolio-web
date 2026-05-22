import { useEffect, useRef, useState } from "react";
import { Lightbulb } from "lucide-react";
import type { Memo, MemoColor, MemoPriceBasis } from "../types";
import { getMemo, upsertMemo, deleteMemo } from "../lib/db";
import {
  MEMO_COLORS, memoColorLabel, memoSwatchClass, memoSwatchRingClass,
} from "../lib/memoColor";
import { useEscClose } from "../lib/useEscClose";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string | null;
  stockName?: string;
  curPrice?: number;
  avgPrice?: number;    // 보유 종목 매수가 (없으면 매수가 기준 비활성)
  onChanged: () => void;
}

const MAX_TEXT = 2000;
const MAX_TAG = 12;

// 천단위 콤마 포맷 (입력 중에는 마지막 . 보존)
function formatNumberInput(v: string): string {
  const cleaned = v.replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const [intPart, decPart] = cleaned.split(".");
  const intNum = Number(intPart);
  if (!Number.isFinite(intNum)) return cleaned;
  const intStr = intNum.toLocaleString();
  return decPart !== undefined ? `${intStr}.${decPart}` : intStr;
}

function parsePrice(v: string): number | undefined {
  const cleaned = v.replace(/[^\d.]/g, "");
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

// % 입력 — 부호 허용 (-5.5 / +10 / 10)
function parsePercent(v: string): number | undefined {
  const cleaned = v.replace(/[^\d.+-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "+" || cleaned === ".") return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

function priceToPercent(price: number, basis: number): number {
  return ((price - basis) / basis) * 100;
}

function percentToPrice(pct: number, basis: number): number {
  return basis * (1 + pct / 100);
}

// 소수점 자릿수 조정 — 천 미만은 2자리, 그 외 정수
function formatPriceDerived(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "";
  const rounded = p >= 1000 ? Math.round(p) : Math.round(p * 100) / 100;
  return rounded.toLocaleString();
}

function formatPercentDerived(pct: number): string {
  if (!Number.isFinite(pct)) return "";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}`;
}

export function MemoDialog({
  isOpen, onClose, ticker, stockName, curPrice, avgPrice, onChanged,
}: Props) {
  useEscClose(isOpen, onClose);
  const [text, setText] = useState("");
  const [targetPriceStr, setTargetPriceStr] = useState("");
  const [targetPctStr, setTargetPctStr] = useState("");
  const [stopPriceStr, setStopPriceStr] = useState("");
  const [stopPctStr, setStopPctStr] = useState("");
  const [entryPriceStr, setEntryPriceStr] = useState("");
  const [entryPctStr, setEntryPctStr] = useState("");
  const [tag, setTag] = useState("");
  const [color, setColor] = useState<MemoColor | undefined>(undefined);
  const [basis, setBasis] = useState<MemoPriceBasis>("current");
  const [existing, setExisting] = useState<Memo | null>(null);
  const downOnBackdropRef = useRef(false);

  // 매수가 기준 사용 가능 여부 (보유 종목만)
  const hasAvg = typeof avgPrice === "number" && avgPrice > 0;
  // 실제 % 환산에 사용하는 기준 가격
  const basisPrice =
    basis === "avg" && hasAvg ? (avgPrice as number)
    : basis === "current" && curPrice ? curPrice
    : undefined;
  const basisLabel = basis === "avg" ? "매수가" : "현재가";

  // 다이얼로그 열릴 때 — 기존 메모 로드
  useEffect(() => {
    if (!isOpen || !ticker) return;
    void (async () => {
      const m = await getMemo(ticker);
      setExisting(m ?? null);
      setText(m?.text ?? "");
      setTag(m?.tag ?? "");
      setColor(m?.color);
      // 기준 — 저장값 우선, 없으면 보유면 "avg", 미보유면 "current"
      const initialBasis: MemoPriceBasis =
        m?.priceBasis ?? (hasAvg ? "avg" : "current");
      setBasis(initialBasis);
      // 가격 → 문자열
      setTargetPriceStr(m?.targetPrice ? m.targetPrice.toLocaleString() : "");
      setStopPriceStr(m?.stopPrice ? m.stopPrice.toLocaleString() : "");
      setEntryPriceStr(m?.entryPrice ? m.entryPrice.toLocaleString() : "");
      // % 는 기준 가격이 있을 때만 derived 계산
      const initialBasisPrice =
        initialBasis === "avg" && hasAvg ? (avgPrice as number)
        : initialBasis === "current" && curPrice ? curPrice
        : undefined;
      setTargetPctStr(
        m?.targetPrice && initialBasisPrice
          ? formatPercentDerived(priceToPercent(m.targetPrice, initialBasisPrice))
          : ""
      );
      setStopPctStr(
        m?.stopPrice && initialBasisPrice
          ? formatPercentDerived(priceToPercent(m.stopPrice, initialBasisPrice))
          : ""
      );
      setEntryPctStr(
        m?.entryPrice && initialBasisPrice
          ? formatPercentDerived(priceToPercent(m.entryPrice, initialBasisPrice))
          : ""
      );
    })();
    // 폼 시딩은 다이얼로그 열림/종목 변경 시에만 — 가격 틱(curPrice/avgPrice)으로 재실행되면
    // 입력 중인 메모가 초기화되므로 의존성에서 제외 (열린 시점 가격으로 % 시드).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ticker]);

  // 기준이 바뀌면 — 가격은 그대로, % 만 새 기준으로 재계산
  useEffect(() => {
    if (!basisPrice) return;
    const tp = parsePrice(targetPriceStr);
    setTargetPctStr(tp ? formatPercentDerived(priceToPercent(tp, basisPrice)) : "");
    const sp = parsePrice(stopPriceStr);
    setStopPctStr(sp ? formatPercentDerived(priceToPercent(sp, basisPrice)) : "");
    const ep = parsePrice(entryPriceStr);
    setEntryPctStr(ep ? formatPercentDerived(priceToPercent(ep, basisPrice)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  if (!isOpen || !ticker) return null;

  const targetNum = parsePrice(targetPriceStr);
  const stopNum = parsePrice(stopPriceStr);
  const entryNum = parsePrice(entryPriceStr);

  // 도달 거리 미리보기 — 항상 현재가 대비 (실제 도달 판정용)
  const targetDeltaFromCur = curPrice && targetNum
    ? ((targetNum - curPrice) / curPrice) * 100
    : null;
  const stopDeltaFromCur = curPrice && stopNum
    ? ((stopNum - curPrice) / curPrice) * 100
    : null;
  const entryDeltaFromCur = curPrice && entryNum
    ? ((entryNum - curPrice) / curPrice) * 100
    : null;

  // 가격 입력 → % 자동 채움
  const onPriceChange = (
    next: string,
    setPrice: (s: string) => void,
    setPct: (s: string) => void,
  ) => {
    const formatted = formatNumberInput(next);
    setPrice(formatted);
    const num = parsePrice(formatted);
    if (num && basisPrice) {
      setPct(formatPercentDerived(priceToPercent(num, basisPrice)));
    } else if (!num) {
      setPct("");
    }
  };

  // % 입력 → 가격 자동 채움
  const onPercentChange = (
    next: string,
    setPrice: (s: string) => void,
    setPct: (s: string) => void,
  ) => {
    setPct(next);
    const pct = parsePercent(next);
    if (pct != null && basisPrice) {
      const price = percentToPrice(pct, basisPrice);
      setPrice(formatPriceDerived(price));
    } else if (next.trim() === "") {
      setPrice("");
    }
  };

  const apply = async () => {
    await upsertMemo({
      ticker,
      text: text.trim() || undefined,
      targetPrice: targetNum,
      stopPrice: stopNum,
      entryPrice: entryNum,
      priceBasis: basis,
      tag: tag.trim() || undefined,
      color,
    });
    onChanged();
    onClose();
  };

  const remove = async () => {
    await deleteMemo(ticker);
    onChanged();
    onClose();
  };

  const inputCls = "w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center
                     justify-center bg-black/40 sm:p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white shadow-xl w-full max-w-md
                       rounded-t-xl sm:rounded-lg
                       max-h-[90vh] overflow-y-auto">
        <header className="px-5 py-3 border-b bg-gray-50 flex items-center">
          <h2 className="text-lg font-bold flex items-center gap-1.5">
            <Lightbulb size={18} strokeWidth={2} fill="currentColor" className="text-amber-400" />
            메모
          </h2>
          {stockName && (
            <span className="ml-3 text-sm text-gray-600 truncate">
              {stockName} ({ticker})
            </span>
          )}
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>

        <div className="px-5 py-3 space-y-3">
          {/* 색상 라벨 */}
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1.5">
              색상 라벨 {color && <span className="font-normal text-gray-500">— {memoColorLabel(color)}</span>}
            </label>
            <div className="flex items-center gap-1.5">
              <button type="button"
                      onClick={() => setColor(undefined)}
                      title="색상 없음"
                      className={`w-7 h-7 rounded-full border bg-white
                                  ${!color ? "ring-2 ring-slate-400" : "border-gray-300 hover:border-gray-400"}`}>
                <span className="text-gray-400 text-xs">×</span>
              </button>
              {MEMO_COLORS.map(c => (
                <button key={c} type="button"
                        onClick={() => setColor(c)}
                        title={memoColorLabel(c)}
                        className={`w-7 h-7 rounded-full ${memoSwatchClass(c)}
                                    ${color === c ? `ring-2 ${memoSwatchRingClass(c)} ring-offset-1` : "hover:opacity-80"}`} />
              ))}
            </div>
          </div>

          {/* 태그 */}
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">
              태그 <span className="font-normal text-gray-400">(선택, 최대 {MAX_TAG}자)</span>
            </label>
            <input type="text" value={tag} maxLength={MAX_TAG}
                   onChange={e => setTag(e.target.value)}
                   placeholder="예: 장기보유, 관심"
                   className={inputCls} />
          </div>

          {/* % 기준 토글 */}
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1.5">
              % 기준 가격
              {basisPrice && (
                <span className="font-normal text-gray-500 ml-1">
                  — {basisLabel} {Math.round(basisPrice).toLocaleString()}원
                </span>
              )}
            </label>
            <div className="inline-flex rounded border border-gray-300 overflow-hidden text-xs">
              <button type="button"
                      onClick={() => setBasis("current")}
                      className={`px-3 py-1 ${basis === "current"
                          ? "bg-blue-600 text-white font-medium"
                          : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                현재가
              </button>
              <button type="button"
                      disabled={!hasAvg}
                      onClick={() => hasAvg && setBasis("avg")}
                      title={hasAvg ? "매수가 기준" : "보유 종목만 매수가 기준 사용 가능"}
                      className={`px-3 py-1 border-l border-gray-300
                                  ${basis === "avg"
                                    ? "bg-blue-600 text-white font-medium"
                                    : hasAvg
                                      ? "bg-white text-gray-600 hover:bg-gray-50"
                                      : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
                매수가
              </button>
            </div>
          </div>

          {/* 목표가 / 손절가 — 가격 + % 동시 입력 */}
          <div className="space-y-2">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                목표가
              </label>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center">
                <input type="text" inputMode="numeric" value={targetPriceStr}
                       onChange={e => onPriceChange(e.target.value, setTargetPriceStr, setTargetPctStr)}
                       placeholder="예: 80,000"
                       className={inputCls} />
                <span className="text-xs text-gray-400 px-0.5">또는</span>
                <div className="relative">
                  <input type="text" inputMode="decimal" value={targetPctStr}
                         onChange={e => onPercentChange(e.target.value, setTargetPriceStr, setTargetPctStr)}
                         placeholder="예: +5"
                         disabled={!basisPrice}
                         className={`${inputCls} pr-6 ${!basisPrice ? "bg-gray-50 text-gray-400" : ""}`} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                </div>
              </div>
              {targetDeltaFromCur != null && Number.isFinite(targetDeltaFromCur) && curPrice && (
                <div className={`text-[11px] mt-1 ${targetDeltaFromCur >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  현재가 대비 {targetDeltaFromCur >= 0 ? "▲" : "▼"} {Math.abs(targetDeltaFromCur).toFixed(1)}% 시 도달
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                손절가
              </label>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center">
                <input type="text" inputMode="numeric" value={stopPriceStr}
                       onChange={e => onPriceChange(e.target.value, setStopPriceStr, setStopPctStr)}
                       placeholder="예: 70,000"
                       className={inputCls} />
                <span className="text-xs text-gray-400 px-0.5">또는</span>
                <div className="relative">
                  <input type="text" inputMode="decimal" value={stopPctStr}
                         onChange={e => onPercentChange(e.target.value, setStopPriceStr, setStopPctStr)}
                         placeholder="예: -5"
                         disabled={!basisPrice}
                         className={`${inputCls} pr-6 ${!basisPrice ? "bg-gray-50 text-gray-400" : ""}`} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                </div>
              </div>
              {stopDeltaFromCur != null && Number.isFinite(stopDeltaFromCur) && curPrice && (
                <div className={`text-[11px] mt-1 ${stopDeltaFromCur >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  현재가 대비 {stopDeltaFromCur >= 0 ? "▲" : "▼"} {Math.abs(stopDeltaFromCur).toFixed(1)}% 시 도달
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                기대가 <span className="font-normal text-gray-400">— 이 가격이 되면 매수하고 싶음</span>
              </label>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center">
                <input type="text" inputMode="numeric" value={entryPriceStr}
                       onChange={e => onPriceChange(e.target.value, setEntryPriceStr, setEntryPctStr)}
                       placeholder="예: 65,000"
                       className={inputCls} />
                <span className="text-xs text-gray-400 px-0.5">또는</span>
                <div className="relative">
                  <input type="text" inputMode="decimal" value={entryPctStr}
                         onChange={e => onPercentChange(e.target.value, setEntryPriceStr, setEntryPctStr)}
                         placeholder="예: -10"
                         disabled={!basisPrice}
                         className={`${inputCls} pr-6 ${!basisPrice ? "bg-gray-50 text-gray-400" : ""}`} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                </div>
              </div>
              {entryDeltaFromCur != null && Number.isFinite(entryDeltaFromCur) && curPrice && (
                <div className={`text-[11px] mt-1 ${entryDeltaFromCur >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  현재가 대비 {entryDeltaFromCur >= 0 ? "▲" : "▼"} {Math.abs(entryDeltaFromCur).toFixed(1)}% 시 도달
                </div>
              )}
            </div>
            {curPrice && (
              <div className="text-[11px] text-gray-500">
                현재가 {Math.round(curPrice).toLocaleString()}원
                {hasAvg && (
                  <> · 매수가 {Math.round(avgPrice as number).toLocaleString()}원</>
                )}
              </div>
            )}
          </div>

          {/* 메모 */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
              <span>메모</span>
              <span className="font-normal text-gray-400">
                {text.length} / {MAX_TEXT}
              </span>
            </label>
            <textarea value={text} maxLength={MAX_TEXT}
                      onChange={e => setText(e.target.value)}
                      placeholder="이 종목에 대한 생각, 매매 계획, 뉴스 등 자유롭게 메모하세요."
                      rows={6}
                      className={`${inputCls} resize-y min-h-[120px]`} />
          </div>
        </div>

        <footer className="px-5 py-3 border-t bg-gray-50 flex items-center gap-2">
          {existing && (
            <button onClick={() => void remove()}
                    className="px-3 py-1.5 text-sm rounded
                               text-rose-600 hover:bg-rose-50">
              삭제
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose}
                    className="px-3 py-1.5 text-sm rounded
                               bg-gray-100 hover:bg-gray-200 text-gray-700">
              취소
            </button>
            <button onClick={() => void apply()}
                    className="px-4 py-1.5 text-sm rounded font-medium
                               bg-blue-600 hover:bg-blue-700 text-white">
              저장
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
