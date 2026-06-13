// 거래 타임라인 — 가로=종목(열), 세로=날짜순. 한 종목 열에 매수→매도를 순서대로 쌓고
//  아래 화살표로 연결. 각 박스 위에 날짜 책갈피. 매수=파랑 / 매도=빨강, 매도엔 익절/손절.
//  scope=all: 같은 종목을 그룹 무관 한 열로 / scope=byGroup: 그룹마다 종목 별개 열.
import { useMemo, Fragment } from "react";
import { ArrowDown } from "lucide-react";
import { computeRealizedByTrade, realizedChip, type RealizedInfo } from "../lib/tradeCalc";
import { formatSigned, signColor } from "../lib/format";
import { openTossStock } from "../lib/toss";
import type { Trade } from "../lib/db";
import type { Price } from "../types";

// "YYYY-MM-DD" / "YYYYMMDD" → UTC ms (날짜만)
function parseDateMs(d: string): number {
  const s = d.replace(/\D/g, "");
  if (s.length < 8) return NaN;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}
function fmtMD(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
}
// 툴팁 — "127,500×19 (2,422,500)" = 주당가×수량 (총액)
function priceLabel(qty: number, amount: number): string {
  const unit = qty > 0 ? Math.round(amount / qty) : 0;
  return `${unit.toLocaleString()}×${qty} (${amount.toLocaleString()})`;
}

interface Ev { kind: "buy" | "sell"; ms: number; qty: number; amount: number; realized?: RealizedInfo }
interface Col { key: string; name: string; account?: string; ticker: string; held: boolean; heldQty: number; heldAvg: number; events: Ev[] }

export function TradeGantt({ trades, nameOf, scope, from, to, desc, prices, onOpenValuation }: {
  trades: Trade[];
  nameOf: (t: string) => string;
  scope: "all" | "byGroup";
  from?: string | null;   // 시작일(YYYY-MM-DD) — 이 범위 거래만 표시(실현손익은 전체로 계산)
  to?: string | null;     // 종료일(YYYY-MM-DD)
  desc?: boolean;         // true = 최신 날짜가 위 (날짜축 역순)
  prices?: Map<string, Price>;   // 현재가 — 보유중 종목 미실현 손익용
  onOpenValuation?: (ticker: string) => void;   // 📊 기업가치 모달 열기
}) {
  const cols = useMemo(() => {
    const byGroup = scope === "byGroup";
    const realized = computeRealizedByTrade(trades, byGroup);   // 전체 거래로 원가 계산
    const fromMs = from ? parseDateMs(from) : -Infinity;
    const toMs = to ? parseDateMs(to) : Infinity;
    const groups = new Map<string, Trade[]>();
    for (const t of trades) {
      const k = byGroup ? `${t.ticker}␟${t.account ?? ""}` : t.ticker;
      const arr = groups.get(k);
      if (arr) arr.push(t); else groups.set(k, [t]);
    }
    const out: Col[] = [];
    for (const [key, rows] of groups) {
      const sorted = [...rows].sort((a, b) =>
        a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
      const all: Ev[] = sorted.map(t => ({
        kind: t.type, ms: parseDateMs(t.date), qty: t.qty, amount: t.amount,
        realized: t.type === "sell" ? realized.get(t.id) : undefined,
      }));
      const events = all.filter(e => e.ms >= fromMs && e.ms <= toMs);   // 표시만 기간 범위
      if (events.length === 0) continue;                   // 이 기간에 거래 없는 종목은 숨김
      // 보유분(미실현용) — 전체 거래 이동평균으로 남은 수량·평단
      let hq = 0, hc = 0;
      for (const t of sorted) {
        if (t.type === "buy") { hq += t.qty; hc += t.amount; }
        else if (hq > 0) { const avg = hc / hq; const m = Math.min(t.qty, hq); hc -= avg * m; hq -= m; }
      }
      out.push({
        key, name: nameOf(rows[0].ticker), ticker: rows[0].ticker,
        account: byGroup ? (rows[0].account ?? "") : undefined,
        held: hq > 0, heldQty: hq, heldAvg: hq > 0 ? hc / hq : 0, events,
      });
    }
    // byGroup: 그룹→첫거래일→종목 / all: 첫거래일(오래된 먼저)→종목
    out.sort((a, b) =>
      (a.account ?? "").localeCompare(b.account ?? "")
      || (a.events[0]?.ms ?? 0) - (b.events[0]?.ms ?? 0)
      || a.name.localeCompare(b.name));
    return out;
  }, [trades, scope, nameOf, from, to]);

  if (cols.length === 0) {
    return <div className="text-center text-xs text-gray-400 py-10">이 기간에 표시할 거래가 없습니다.</div>;
  }

  // 라운드를 시작 날짜로 세로 정렬 — 행=라운드 시작일, 열=종목. 같은 시작일 라운드는 가로로 맞춰짐.
  //  + 종목별 실현손익 합 + 보유중 미실현(현재가 − 평단)×잔량.
  const colRoundsAll = cols.map(c => {
    const rs = buildRounds(c.events);
    const realizedSum = c.events.reduce((s, e) => s + (e.realized?.realized ?? 0), 0);
    const hasReal = c.events.some(e => e.realized);
    const px = prices?.get(c.ticker);
    const cur = px?.price;
    // 헤더 현재가 등락% — 직전 거래일 종가(prevClose) 대비. 없으면 base 대비.
    const refPx = px ? (px.prevClose || px.base) : 0;
    const dayPct = (cur && refPx > 0) ? ((cur - refPx) / refPx) * 100 : null;
    const unreal = (c.heldQty > 0 && cur && c.heldAvg > 0) ? Math.round((cur - c.heldAvg) * c.heldQty) : null;
    const unrealPct = (unreal != null && cur) ? ((cur - c.heldAvg) / c.heldAvg) * 100 : null;
    return {
      col: c, realizedSum, hasReal, unreal, unrealPct, cur, dayPct,
      rounds: rs.map((round, i) => ({ startMs: round[0].ms, events: round, held: c.held && i === rs.length - 1 })),
    };
  });
  // 기간 내 매수가 있는 종목만 표시 — 매도만 들어온 종목(매수는 기간 밖)은 제외.
  const hasBuy = (cr: typeof colRoundsAll[number]) => cr.col.events.some(e => e.kind === "buy");
  const buyMs = (cr: typeof colRoundsAll[number], pick: "last" | "first") => {
    const buys = cr.col.events.filter(e => e.kind === "buy").map(e => e.ms);
    return buys.length ? (pick === "last" ? Math.max(...buys) : Math.min(...buys)) : 0;
  };
  // 정렬 — 매수일 기준(행 방향 desc=최신순과 동일): ①최근 매수일 → ②첫 매수일 → 현재가 유무.
  const colRounds = colRoundsAll
    .filter(hasBuy)
    .sort((a, b) =>
      (desc ? buyMs(b, "last") - buyMs(a, "last") : buyMs(a, "last") - buyMs(b, "last"))
      || (desc ? buyMs(b, "first") - buyMs(a, "first") : buyMs(a, "first") - buyMs(b, "first"))
      || (a.cur != null ? 0 : 1) - (b.cur != null ? 0 : 1));
  // 전체 합계 — 실현(익절+손절) + 보유 평가(미실현)
  let gReal = 0, gUnreal = 0, anyReal = false, anyHeld = false;
  for (const ci of colRounds) {
    gReal += ci.realizedSum; if (ci.hasReal) anyReal = true;
    if (ci.unreal != null) { gUnreal += ci.unreal; anyHeld = true; }
  }
  const gTotal = gReal + gUnreal;
  const dateRows = [...new Set(colRounds.flatMap(cr => cr.rounds.map(r => r.startMs)))]
    .sort((a, b) => desc ? b - a : a - b);
  const gridCols = `56px repeat(${colRounds.length}, 168px)`;

  if (colRounds.length === 0) {
    return <div className="text-center text-xs text-gray-400 py-10">이 기간에 매수한 종목이 없습니다.</div>;
  }

  return (
    <div>
      {/* 종목명 헤더·날짜축 고정 — 그 아래만 스크롤. data-noswipe: 모바일 그룹 스와이프 제외 */}
      <div data-noswipe className="overflow-auto max-h-[72vh]">
        <div className="grid items-start min-w-min gap-x-2" style={{ gridTemplateColumns: gridCols }}>
          {/* 좌상단 코너(고정) — 날짜축 라벨 */}
          <div className="sticky top-0 left-0 z-30 bg-white flex items-end justify-end pr-1.5 pb-2">
            <span className="text-[11px] font-bold text-gray-400">매수일</span>
          </div>
          {/* 종목명 헤더(상단 고정) — 종목별 총손익(실현 익절·손절 + 보유 평가) */}
          {colRounds.map(({ col, realizedSum, hasReal, unreal }) => {
            const px = prices?.get(col.ticker);
            const cur = px?.price;
            const refPx = px ? (px.prevClose || px.base) : 0;
            const dayPct = (cur && refPx > 0) ? ((cur - refPx) / refPx) * 100 : null;
            // 카드 톤·책갈피 — 보유중=녹색(보유) / 청산=익절(빨강)·손절(파랑)
            const tone = col.held ? CARD_TONE.held
              : hasReal ? (realizedSum >= 0 ? CARD_TONE.profit : CARD_TONE.loss)
              : CARD_TONE.neutral;
            return (
              <div key={col.key} className="sticky top-0 z-20 bg-white px-0.5 pt-0.5 pb-2">
                {/* 종목명·현재가(%)·실현/평가. 카드색+왼쪽 책갈피로 상태표시 */}
                <div className={`relative rounded-lg border shadow-sm text-center px-2 py-1.5 leading-tight ${tone.box}`}>
                  {/* 왼쪽 세로 책갈피 */}
                  {tone.tag && (
                    <span className={`absolute right-full top-1/2 -translate-y-1/2 translate-x-[3px] w-[13px] rounded-l py-0.5 text-[8px] font-bold text-white text-center leading-tight shadow-sm ${tone.tab}`}>
                      {tone.tag}
                    </span>
                  )}
                  <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => openTossStock(col.ticker)}
                            className="truncate font-bold text-[13px] text-gray-800 hover:text-blue-600 hover:underline"
                            title={`${col.name} — 토스에서 보기`}>{col.name}</button>
                    {onOpenValuation && (
                      <button type="button" onClick={() => onOpenValuation(col.ticker)}
                              className="shrink-0 text-[11px] leading-none opacity-70 hover:opacity-100"
                              title="기업가치 보기">📊</button>
                    )}
                  </div>
                  {col.account && <div className="truncate text-[11px] text-gray-400">{col.account}</div>}
                  {cur != null && (
                    <div className="text-[12px] tabular-nums mt-0.5">
                      <span className="font-bold text-gray-800">{cur.toLocaleString()}</span>
                      {dayPct != null && (
                        <span className={`ml-1 font-semibold ${signColor(dayPct)}`}>
                          ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  )}
                  {/* 종목별 총손익 — 실현 / 평가 분리, 금액 우측정렬 */}
                  {(hasReal || unreal != null) && (
                    <div className="mt-1 pt-1 border-t border-black/10 text-[12px] tabular-nums">
                      {hasReal && (
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-gray-400 text-[10px]">실현</span>
                          <span className={`font-bold ${signColor(realizedSum)}`}>{formatSigned(realizedSum)}</span>
                        </div>
                      )}
                      {unreal != null && (
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-gray-400 text-[10px]">평가</span>
                          <span className={`font-bold ${signColor(unreal)}`}>{formatSigned(unreal)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* 날짜 행 — 같은 시작일 라운드끼리 가로 정렬 */}
          {dateRows.map(ms => (
            <Fragment key={ms}>
              <div className="sticky left-0 z-10 bg-white text-[14px] font-bold text-gray-600 tabular-nums text-right pr-1.5 pt-2 border-t border-dashed border-gray-300">
                {fmtMD(ms)}
              </div>
              {colRounds.map(({ col, rounds, unreal, unrealPct }) => (
                <div key={col.key} className="self-stretch flex flex-col items-center gap-1 pt-2 border-t border-l border-dashed border-gray-300">
                  {rounds.filter(r => r.startMs === ms).map((r, i) => (
                    <RoundGroup key={i} round={r.events} held={r.held}
                                heldUnreal={r.held && unreal != null
                                  ? { amount: unreal, pct: unrealPct ?? 0, qty: col.heldQty } : undefined} />
                  ))}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      {/* 범례 — 총손익만 */}
      <div className="flex items-center gap-3 mt-3 text-[12px] text-gray-400">
        {(anyReal || anyHeld) && (
          <span className="inline-flex items-baseline gap-1 tabular-nums">
            <span className="text-gray-500">총손익</span>
            <span className={`text-[13px] font-bold ${signColor(gTotal)}`}>{formatSigned(gTotal)}</span>
            {anyReal && anyHeld && (
              <span className="text-[10px] text-gray-400">(실현 {formatSigned(gReal)} · 평가 {formatSigned(gUnreal)})</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// 라운드 묶기 — 보유수량이 0으로 떨어질 때까지를 한 라운드로(완전 청산 단위).
//  안 닫히면(보유중) 마지막 라운드는 열린 채로.
function buildRounds(events: Ev[]): Ev[][] {
  const rounds: Ev[][] = [];
  let cur: Ev[] = [], qty = 0;
  for (const e of events) {
    cur.push(e);
    qty += e.kind === "buy" ? e.qty : -e.qty;
    if (qty <= 0) { rounds.push(cur); cur = []; qty = 0; }
  }
  if (cur.length) rounds.push(cur);
  return rounds;
}

// 라운드 테두리 — 문구·합산금액 없이 둘러싸기만. 안에 매수→매도 화살표 스택.
//  보유중이면 맨 아래에 현재가 기준 미실현 손익(heldUnreal) 표시.
function RoundGroup({ round, held, heldUnreal }: {
  round: Ev[]; held: boolean;
  heldUnreal?: { amount: number; pct: number; qty: number };
}) {
  return (
    <div className="w-full rounded-xl border border-gray-300 bg-gray-100 p-1.5 flex flex-col items-center">
      {round.map((e, i) => (
        <Fragment key={i}>
          {i > 0 && <ArrowDown size={16} className="text-gray-400 my-0.5" strokeWidth={2.5} />}
          <EventCard e={e} />
        </Fragment>
      ))}
      {held && (
        <>
          <ArrowDown size={16} className="text-gray-300 my-0.5" strokeWidth={2.5} />
          <div className="w-full rounded-md border border-dashed border-gray-400 bg-white px-1 py-0.5 text-center leading-tight tabular-nums">
            <div className="text-[11px] text-gray-500">
              보유중{heldUnreal ? ` ${heldUnreal.qty}주` : ""}
            </div>
            {heldUnreal && (
              <div className={`text-[12px] font-bold ${signColor(heldUnreal.amount)}`}>
                {formatSigned(heldUnreal.amount)}
                <span className="text-[10px] ml-0.5">({heldUnreal.pct >= 0 ? "+" : ""}{heldUnreal.pct.toFixed(1)}%)</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 종목 카드 톤 — 보유중=녹색(보유) / 청산 익절=빨강 / 손절=파랑 / 그 외=무채색
const CARD_TONE = {
  held:    { box: "border-emerald-200 bg-emerald-50", tab: "bg-emerald-500", tag: "보유" },
  profit:  { box: "border-rose-200 bg-rose-50",       tab: "bg-rose-500",    tag: "익절" },
  loss:    { box: "border-blue-200 bg-blue-50",       tab: "bg-blue-500",    tag: "손절" },
  neutral: { box: "border-gray-200 bg-white",         tab: "",               tag: "" },
};

// 색: 매수=회색 / 매도 익절=빨강 / 손절=파랑 / 본전·원가불명=회색
const TONE = {
  gray: { box: "border-gray-300 bg-gray-50", amt: "text-gray-700", unit: "text-gray-400", tab: "bg-gray-200 text-gray-700" },
  rose: { box: "border-rose-300 bg-rose-50", amt: "text-rose-700", unit: "text-rose-500", tab: "bg-rose-200 text-rose-800" },
  blue: { box: "border-blue-300 bg-blue-50", amt: "text-blue-700", unit: "text-blue-500", tab: "bg-blue-200 text-blue-800" },
};

function EventCard({ e }: { e: Ev }) {
  const isBuy = e.kind === "buy";
  const r = e.realized;
  const tone = isBuy ? "gray"
    : r && r.realized > 0 ? "rose"
    : r && r.realized < 0 ? "blue" : "gray";
  const C = TONE[tone];
  const chip = r ? realizedChip(r.realized) : null;
  return (
    <div className="flex flex-col items-start w-full"
         title={`${isBuy ? "매수" : "매도"} ${priceLabel(e.qty, e.amount)}`}>
      {/* 날짜 책갈피 */}
      <div className={`ml-2 px-1.5 rounded-t-md text-[11px] font-bold leading-tight ${C.tab}`}>{fmtMD(e.ms)}</div>
      {/* 박스 */}
      <div className={`relative -mt-px w-full rounded-md border px-1 py-1 text-center leading-tight shadow-sm tabular-nums ${C.box}`}>
        {/* 익절/손절 — 왼쪽 책갈피 */}
        {chip && (
          <span className={`absolute right-full top-1/2 -translate-y-1/2 translate-x-[3px] w-[13px] rounded-l py-0.5 text-[8px] font-bold text-white text-center leading-tight shadow-sm ${chip.bg}`}>
            {chip.label}
          </span>
        )}
        <div className={`text-[12px] font-bold ${C.amt}`}>{e.amount.toLocaleString()}</div>
        <div className={`text-[10px] ${C.unit}`}>{Math.round(e.amount / e.qty).toLocaleString()}×{e.qty}</div>
        {r && (
          <div className={`mt-0.5 border-t border-black/10 pt-0.5 font-bold leading-tight ${signColor(r.realized)}`}>
            <div className="text-[14px] whitespace-nowrap">{formatSigned(r.realized)}</div>
            <div className="text-[11px]">({r.pct >= 0 ? "+" : ""}{r.pct.toFixed(1)}%)</div>
          </div>
        )}
      </div>
    </div>
  );
}
