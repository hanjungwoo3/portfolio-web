// 투자자별 순매수/순매도 종목 랭킹 — 독립 탭(가치표 다음). 토스 1콜.
//  컬럼 = 투자자(외국인·기관·개인), 각 컬럼 안에 순매수/순매도를 같이 놓는다.
//  ⚠️ 수급은 제로섬이라 외국인이 산 종목은 개인 쪽에서 '매도'에 있다.
//     그래서 한쪽 방향만 보여주면 컬럼 간 비교가 안 된다 → 양방향 동시 나열.
//  ⚠️ 기준 시각이 투자자별로 다르다(외국인·기관은 장중, 개인은 하루 밀림) →
//     컬럼마다 기준시각을 반드시 같이 노출해야 오늘 값으로 오해하지 않는다.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchInvestorRankings, type InvestorFlowGroup, type InvestorFlowRow } from "../lib/api";
import { signColor } from "../lib/format";

// 한 방향에 보여줄 종목 수. 엔드포인트는 size 만큼 무제한으로 주지만(size=3000 이면 2.2MB)
// 1분 폴링에 얹을 무게가 아니라 100 으로 받고 100 을 그대로 쓴다(=버리는 데이터 없음).
const ROWS = 100;

// 순매수 금액 — 억원 단위, 1조 이상은 "n조 n,nnn억"
function fmtAmount(won: number): string {
  const eokTotal = Math.round(Math.abs(won) / 1e8);
  const jo = Math.floor(eokTotal / 10000);
  const eok = eokTotal % 10000;
  if (jo > 0) return `${jo}조 ${eok.toLocaleString()}억`;
  return `${eokTotal.toLocaleString()}억`;
}

// ISO(UTC) → "오늘 15:15 기준" / "어제 20:20 기준" / "09-01 20:20 기준"
function fmtBasedAt(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const kst = new Date(t.getTime() + 9 * 3600_000);
  const ymd = kst.toISOString().slice(0, 10);
  const hm = kst.toISOString().slice(11, 16);
  const nowKst = new Date(Date.now() + 9 * 3600_000);
  const today = nowKst.toISOString().slice(0, 10);
  const yest = new Date(nowKst.getTime() - 86400_000).toISOString().slice(0, 10);
  if (ymd === today) return `오늘 ${hm} 기준`;
  if (ymd === yest) return `어제 ${hm} 기준`;
  return `${ymd.slice(5)} ${hm} 기준`;
}

// 선택 종목이 이 투자자에서 어느 방향에 몇 위로 있는지 (없으면 null)
interface Found { side: "buy" | "sell"; amount: number; rank: number; name: string }
function findTicker(g: InvestorFlowGroup, ticker: string): Found | null {
  const bi = g.buy.findIndex(r => r.ticker === ticker);
  if (bi >= 0) return { side: "buy", amount: g.buy[bi].amount, rank: bi + 1, name: g.buy[bi].name };
  const si = g.sell.findIndex(r => r.ticker === ticker);
  if (si >= 0) return { side: "sell", amount: g.sell[si].amount, rank: si + 1, name: g.sell[si].name };
  return null;
}

// 한 방향 목록 — 선택 종목은 배경 강조 + 스크롤 밖이면 끌어온다.
interface FlowListProps {
  rows: InvestorFlowRow[];
  side: "buy" | "sell";
  selected: string | null;
  onSelect: (t: string | null) => void;
}
function FlowList({ rows, side, selected, onSelect }: FlowListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const total = rows.reduce((a, r) => a + Math.abs(r.amount), 0);

  // 다른 컬럼에서 고른 종목이 이 목록에선 스크롤 밖일 수 있다 → 보이는 곳까지.
  //  block:"nearest" — 이미 보이면 안 움직여서 화면이 덜 흔들린다.
  useEffect(() => {
    if (!selected) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-ticker="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const buy = side === "buy";
  return (
    <div>
      <div className="flex items-baseline gap-1.5 mt-1.5 mb-0.5">
        <span className={`text-[11px] font-bold ${buy ? "text-rose-600" : "text-blue-600"}`}>
          {buy ? "순매수" : "순매도"}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-gray-500">{fmtAmount(total)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-4 text-center text-[11px] text-gray-400">데이터 없음</div>
      ) : (
        <ul ref={listRef}
            className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1
                       border border-gray-100 rounded p-1">
          {rows.map((r, i) => (
            <li key={r.ticker} data-ticker={r.ticker}
                onClick={() => onSelect(selected === r.ticker ? null : r.ticker)}
                className={`flex items-center gap-1.5 px-1 py-1 rounded cursor-pointer transition-colors
                            ${selected === r.ticker
                              ? "bg-amber-200 ring-1 ring-amber-500"
                              : "hover:bg-gray-50"}`}>
              <span className="w-6 shrink-0 text-[10px] tabular-nums text-gray-400 text-right">{i + 1}</span>
              {r.logo && (
                <img src={r.logo} alt="" loading="lazy"
                     className="w-4 h-4 rounded-full shrink-0 bg-gray-100" />
              )}
              <span className="flex-1 min-w-0">
                <span className="block truncate text-xs font-medium text-gray-800">{r.name}</span>
                <span className="block text-[10px] tabular-nums text-gray-500">
                  {r.close.toLocaleString()}원{" "}
                  <span className={signColor(r.pct)}>
                    {r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%
                  </span>
                </span>
              </span>
              <span className={`shrink-0 text-[11px] font-bold tabular-nums
                                ${buy ? "text-rose-600" : "text-blue-600"}`}>
                {fmtAmount(r.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlowColumn({ group, selected, onSelect }: {
  group: InvestorFlowGroup; selected: string | null; onSelect: (t: string | null) => void;
}) {
  const label = fmtBasedAt(group.basedAt);
  const stale = !label.startsWith("오늘");
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 border-b border-gray-300 pb-1">
        <span className="text-sm font-bold text-gray-900">{group.type}</span>
        <span className={`text-[10px] ${stale ? "text-amber-600 font-medium" : "text-gray-400"}`}>
          {label}
        </span>
      </div>
      <FlowList rows={group.buy.slice(0, ROWS)} side="buy" selected={selected} onSelect={onSelect} />
      <FlowList rows={group.sell.slice(0, ROWS)} side="sell" selected={selected} onSelect={onSelect} />
    </div>
  );
}

// 선택 종목 요약 — 세 투자자가 각각 어느 방향으로 얼마인지 한 줄로.
//  방향이 갈리는 종목(외국인 매수 ↔ 개인 매도)의 구도를 여기서 바로 읽는다.
function SelectedBar({ data, selected, onClear }: {
  data: InvestorFlowGroup[]; selected: string; onClear: () => void;
}) {
  const found = data.map(g => ({ g, f: findTicker(g, selected) }));
  const name = found.find(x => x.f)?.f?.name ?? selected;
  return (
    <div className="flex items-center gap-2 flex-wrap rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5">
      <span className="text-xs font-bold text-gray-900">{name}</span>
      <span className="text-[10px] text-gray-500 font-mono">{selected}</span>
      {found.map(({ g, f }) => (
        <span key={g.key} className="text-[11px] tabular-nums">
          <span className="text-gray-500">{g.type}</span>{" "}
          {f ? (
            <span className={f.side === "buy" ? "text-rose-600 font-bold" : "text-blue-600 font-bold"}>
              {f.side === "buy" ? "순매수" : "순매도"} {fmtAmount(f.amount)}
              <span className="text-gray-400 font-normal"> ({f.rank}위)</span>
            </span>
          ) : (
            <span className="text-gray-400">상위 {ROWS}위 밖</span>
          )}
        </span>
      ))}
      <button onClick={onClear}
              className="ml-auto px-2 py-0.5 rounded border border-amber-400 bg-white
                         text-[11px] text-amber-700 font-medium hover:bg-amber-100">
        선택 해제
      </button>
    </div>
  );
}

export function InvestorFlowTab() {
  // 컬럼 간 연동 — 한 종목을 고르면 세 투자자의 매수·매도 목록 전체에서 동시에 강조된다.
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["investor-flow-ranking"],
    queryFn: () => fetchInvestorRankings(ROWS),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  return (
    <div className="space-y-2 pt-2">
      <div className="bg-blue-50/40 border border-blue-100 rounded p-2.5 text-xs text-gray-700 leading-relaxed">
        <div className="font-bold text-gray-900 mb-0.5">👥 외국인 · 기관 · 개인 매매 동향</div>
        투자자별 순매수·순매도 금액 순위입니다. 종목을 클릭하면 다른 투자자 목록에서도 같이 표시됩니다.
        <br />
        <span className="text-[11px] text-gray-500">
          토스 · 1분 자동 갱신 · 방향별 상위 {ROWS}종목 ·{" "}
          <span className="text-amber-600">기준 시각은 투자자마다 다릅니다</span>(개인은 보통 하루 늦게 반영)
        </span>
      </div>

      {data && data.length > 0 && selected && (
        <SelectedBar data={data} selected={selected} onClear={() => setSelected(null)} />
      )}

      {isLoading ? (
        <div className="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
      ) : !data || data.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">데이터를 가져오지 못했습니다.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-5 sm:grid-cols-3">
          {data.map(g => (
            <FlowColumn key={g.key} group={g} selected={selected} onSelect={setSelected} />
          ))}
        </div>
      )}
    </div>
  );
}
