import { useState } from "react";
import type { Stock, Price } from "../types";
import { formatSigned, signColor, holdingYesterdayBaseSum } from "../lib/format";
import { getDeposit, getTotalDeposits, setDeposit } from "../lib/deposits";

interface Props {
  holdings: Stock[];
  prices: Map<string, Price>;
  // 현재 활성 그룹(account) key — 예수금 저장/조회용
  account?: string;
  // 합산(내주식) 탭이면 모든 그룹 예수금 합을 읽기 전용으로 표시
  aggregated?: boolean;
  // 예수금 변경 후 부모 리로드 트리거
  onDepositChange?: () => void;
}

// 합계는 매도 수수료 미적용 (raw 가격 × 주수). 데스크톱 v2 와 동일.
// 카드 개별 "전체수익" 은 FEE 적용 (매도 시 실수령액 추정) — 의도적 비대칭.
// 장마감 종목도 종가 vs 어제 종가 차이로 합계에 정상 반영 (다음 장 시작 전까지 유효).
// 예수금(현금) 은 평가손익 없음 — 총자산에만 합산, pnl/오늘 계산엔 미반영.

export function TotalRow({ holdings, prices, account, aggregated, onDepositChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  let totalInvested = 0;
  let totalCurrent = 0;
  let totalYesterday = 0;
  let activeCount = 0;

  // 오늘 매수분은 어제 보유가 없으니 yesterday 기준=매수단가 (합산은 보유분별 분리). holdingYesterdayBaseSum 참조.
  for (const s of holdings) {
    if (s.shares <= 0) continue;
    const p = prices.get(s.ticker);
    if (!p) continue;
    const cur = p.price || s.avg_price;
    totalInvested += s.shares * s.avg_price;
    totalCurrent += cur * s.shares;
    totalYesterday += holdingYesterdayBaseSum(s, p);
    activeCount++;
  }

  const deposit = aggregated ? getTotalDeposits() : getDeposit(account ?? "");
  const editable = !aggregated && account !== undefined;

  // 종목도 없고 예수금도 0 이면 합계 카드 숨김 (편집 중이면 유지)
  if (activeCount === 0 && deposit <= 0 && !editing) return null;

  const pnl = totalCurrent - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
  const dayDiff = totalCurrent - totalYesterday;
  const dayPct = totalYesterday > 0 ? (dayDiff / totalYesterday) * 100 : 0;
  const grandTotal = totalCurrent + deposit;
  const showTotal = deposit > 0;   // 예수금 있을 때만 총자산 헤드라인 표시

  const totalColor = signColor(pnl) || "text-rose-700";

  const startEdit = () => {
    if (!editable) return;
    setDraft(deposit > 0 ? String(deposit) : "");
    setEditing(true);
  };
  const commit = () => {
    const v = Number(draft.replace(/[, ]/g, ""));
    setDeposit(account ?? "", Number.isFinite(v) ? v : 0);
    setEditing(false);
    onDepositChange?.();
  };

  return (
    <div className="w-fit bg-white border border-gray-300
                     rounded-lg shadow-md px-5 py-3
                     grid grid-cols-[auto_auto_auto_auto]
                     gap-x-3 gap-y-1 items-baseline
                     text-sm leading-tight whitespace-nowrap">
      {/* Row 1: 원금  |  전체 */}
      <div className="text-gray-500 text-xs">원금</div>
      <div className="text-right text-gray-800">
        {totalInvested.toLocaleString()}원
      </div>
      <div className="text-gray-500 text-xs pl-2">전체</div>
      <div className={`text-right font-bold ${signColor(pnl)}`}>
        {formatSigned(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
      </div>

      {/* Row 2: 평가액(또는 현재) | 오늘 — 예수금 없으면 이 줄이 헤드라인(xl) */}
      <div className="text-gray-500 text-xs">{showTotal ? "평가액" : "현재"}</div>
      <div className={`text-right font-bold ${showTotal ? "" : "text-xl"} ${totalColor}`}>
        {totalCurrent.toLocaleString()}원
      </div>
      <div className="text-gray-500 text-xs pl-2">오늘</div>
      <div className={`text-right font-bold ${signColor(dayDiff)}`}>
        {formatSigned(dayDiff)} ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
      </div>

      {/* Row 3: 예수금 (편집 가능) */}
      <div className="text-gray-500 text-xs">예수금</div>
      <div className="text-right col-span-3">
        {editing ? (
          <span className="inline-flex items-center gap-1"
                onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={commit}
              placeholder="0"
              className="w-28 border rounded px-1.5 py-0.5 text-right text-sm
                         focus:outline-none focus:border-blue-500" />
            <span className="text-xs text-gray-500">원</span>
          </span>
        ) : editable ? (
          <button onClick={e => { e.stopPropagation(); startEdit(); }}
                  title="클릭해서 예수금 입력"
                  className="text-gray-800 hover:text-blue-600 hover:underline">
            {deposit > 0 ? `${deposit.toLocaleString()}원` : "+ 입력"}
          </button>
        ) : (
          <span className="text-gray-800">{deposit.toLocaleString()}원</span>
        )}
      </div>

      {/* Row 4: 총자산 (평가액 + 예수금) — 예수금 있을 때만 헤드라인(xl) */}
      {showTotal && (
        <>
          <div className="text-gray-600 text-xs font-medium">총자산</div>
          <div className={`text-right font-bold text-xl col-span-3 ${totalColor}`}>
            {grandTotal.toLocaleString()}원
          </div>
        </>
      )}
    </div>
  );
}
