// 거래 타임라인 — 가로=종목(열), 세로=날짜순. 한 종목 열에 매수→매도를 순서대로 쌓고
//  아래 화살표로 연결. 각 박스 위에 날짜 책갈피. 매수=파랑 / 매도=빨강, 매도엔 익절/손절.
//  scope=all: 같은 종목을 그룹 무관 한 열로 / scope=byGroup: 그룹마다 종목 별개 열.
import { useMemo, Fragment } from "react";
import { ArrowDown } from "lucide-react";
import { computeRealizedByTrade, realizedChip, type RealizedInfo } from "../lib/tradeCalc";
import { formatSigned, signColor } from "../lib/format";
import type { Trade } from "../lib/db";

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
interface Col { key: string; name: string; account?: string; held: boolean; events: Ev[] }

export function TradeGantt({ trades, nameOf, scope, cutoff }: {
  trades: Trade[];
  nameOf: (t: string) => string;
  scope: "all" | "byGroup";
  cutoff?: string | null;   // YYYYMMDD — 이 날짜 이후 거래만 표시(실현손익은 전체로 계산)
}) {
  const cols = useMemo(() => {
    const byGroup = scope === "byGroup";
    const realized = computeRealizedByTrade(trades, byGroup);   // 전체 거래로 원가 계산
    const cutoffMs = cutoff ? parseDateMs(cutoff) : -Infinity;
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
      let net = 0;
      const all: Ev[] = sorted.map(t => {
        if (t.type === "buy") net += t.qty; else net -= t.qty;
        return {
          kind: t.type, ms: parseDateMs(t.date), qty: t.qty, amount: t.amount,
          realized: t.type === "sell" ? realized.get(t.id) : undefined,
        };
      });
      const events = all.filter(e => e.ms >= cutoffMs);   // 표시만 기간 필터
      if (events.length === 0) continue;                   // 이 기간에 거래 없는 종목은 숨김
      out.push({
        key, name: nameOf(rows[0].ticker),
        account: byGroup ? (rows[0].account ?? "") : undefined,
        held: net > 0, events,
      });
    }
    // byGroup: 그룹→첫거래일→종목 / all: 첫거래일(오래된 먼저)→종목
    out.sort((a, b) =>
      (a.account ?? "").localeCompare(b.account ?? "")
      || (a.events[0]?.ms ?? 0) - (b.events[0]?.ms ?? 0)
      || a.name.localeCompare(b.name));
    return out;
  }, [trades, scope, nameOf, cutoff]);

  if (cols.length === 0) {
    return <div className="text-center text-xs text-gray-400 py-10">이 기간에 표시할 거래가 없습니다.</div>;
  }

  // 라운드를 시작 날짜로 세로 정렬 — 행=라운드 시작일, 열=종목. 같은 시작일 라운드는 가로로 맞춰짐.
  const colRounds = cols.map(c => {
    const rs = buildRounds(c.events);
    return {
      col: c,
      rounds: rs.map((round, i) => ({ startMs: round[0].ms, events: round, held: c.held && i === rs.length - 1 })),
    };
  });
  const dateRows = [...new Set(colRounds.flatMap(cr => cr.rounds.map(r => r.startMs)))].sort((a, b) => a - b);
  const gridCols = `56px repeat(${cols.length}, 168px)`;

  return (
    <div>
      {/* 종목명 헤더·날짜축 고정 — 그 아래만 스크롤 */}
      <div className="overflow-auto max-h-[72vh]">
        <div className="grid items-start min-w-min gap-x-2" style={{ gridTemplateColumns: gridCols }}>
          {/* 좌상단 코너(고정) */}
          <div className="sticky top-0 left-0 z-30 bg-white" />
          {/* 종목명 헤더(상단 고정) — 종목별 총 실현손익(총익절−총손절) */}
          {colRounds.map(({ col }) => {
            const net = col.events.reduce((s, e) => s + (e.realized?.realized ?? 0), 0);
            const hasReal = col.events.some(e => e.realized);
            return (
              <div key={col.key} className="sticky top-0 z-20 bg-white text-center px-1 pt-0.5 pb-2 leading-tight border-l border-dashed border-gray-300">
                <div className="truncate font-bold text-[13px] text-gray-700" title={col.name}>{col.name}</div>
                {col.account && <div className="truncate text-[11px] text-gray-400">{col.account}</div>}
                {hasReal && (
                  <div className={`text-[12px] font-bold tabular-nums ${signColor(net)}`}>{formatSigned(net)}</div>
                )}
              </div>
            );
          })}
          {/* 날짜 행 — 같은 시작일 라운드끼리 가로 정렬 */}
          {dateRows.map(ms => (
            <Fragment key={ms}>
              <div className="sticky left-0 z-10 bg-white text-[14px] font-bold text-gray-600 tabular-nums text-right pr-1.5 pt-2 border-t border-dashed border-gray-300">
                {fmtMD(ms)}
              </div>
              {colRounds.map(({ col, rounds }) => (
                <div key={col.key} className="self-stretch flex flex-col items-center gap-1 pt-2 border-t border-l border-dashed border-gray-300">
                  {rounds.filter(r => r.startMs === ms).map((r, i) => (
                    <RoundGroup key={i} round={r.events} held={r.held} />
                  ))}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      {/* 범례 */}
      <div className="flex items-center gap-3 mt-3 text-[12px] text-gray-400">
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm border border-gray-300 bg-gray-50 inline-block" />매수</span>
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm border border-rose-300 bg-rose-50 inline-block" />익절</span>
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm border border-blue-300 bg-blue-50 inline-block" />손절</span>
        <span>행 = 라운드 시작일</span>
        <span className="ml-auto">이동평균 원가 기준</span>
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
function RoundGroup({ round, held }: { round: Ev[]; held: boolean }) {
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
          <div className="rounded-md border border-dashed border-gray-300 bg-white px-2 py-0.5 text-[12px] text-gray-400">보유중</div>
        </>
      )}
    </div>
  );
}

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
          <span className={`absolute right-full top-1/2 -translate-y-1/2 rounded-l-md px-1 py-0.5 text-[11px] font-bold text-white shadow-sm ${chip.bg}`}>
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
