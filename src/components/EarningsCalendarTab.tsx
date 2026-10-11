// 실적 일정 탭 — 이번 주부터 3주, 주별 × 요일별 달력. 날짜·시각은 전부 한국 시간.
//   데이터·한국 시간 변환 규칙은 lib/earnings. 내 관심종목은 노란 배경 + ★ 로 맨 위.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEarningsCalendar, krImpactOf, type EarningsEvent } from "../lib/earnings";
import { US_PAIRS } from "../lib/usMarketData";
import type { ConsensusItem } from "./ConsensusTab";

const WEEKS = 3;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
// Tailwind 는 조합한 클래스 이름(md:grid-cols-${n})을 못 찾는다 — 쓰일 값을 그대로 적어 둔다
const MD_COLS: Record<number, string> = { 5: "md:grid-cols-5", 6: "md:grid-cols-6", 7: "md:grid-cols-7" };
const KRW_PER_USD = 1400;   // 미국·한국을 한 칸에서 시총순으로 섞을 때만 쓰는 대략값

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dowOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

function timeLabel(e: EarningsEvent): string {
  if (e.kstTime) {
    const h = Number(e.kstTime.slice(0, 2));
    const part = h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "밤";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${part} ${h12}:${e.kstTime.slice(3)}`;
  }
  return e.session === "pre" ? "장 전" : e.session === "post" ? "장 후" : "";
}

export function EarningsCalendarTab({ items, onOpenValuation }: {
  items: ConsensusItem[];
  onOpenValuation?: (ticker: string, name?: string) => void;
}) {
  const [country, setCountry] = useState<"all" | "US" | "KR">("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [impactOnly, setImpactOnly] = useState(false);   // 🇰🇷 한국 증시 영향 큰 것만
  const today = kstToday();
  // 이번 주 월요일(한국). 토·일엔 지난 주가 다 끝났으니 다음 주 월요일부터
  const dow = dowOf(today);
  const monday = dow === 0 || dow === 6 ? addDays(today, dow === 0 ? 1 : 2) : addDays(today, -(dow - 1));
  const end = addDays(monday, WEEKS * 7 - 1);

  const watch = useMemo(() => [...new Set(items.map(i => i.ticker))].sort(), [items]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of US_PAIRS) m.set(p.symbol.replace(/\.(KS|KQ)$/, ""), p.name);
    for (const i of items) if (i.name) m.set(i.ticker, i.name);
    return m;
  }, [items]);
  const mine = useMemo(() => new Set(watch), [watch]);

  const q = useQuery({
    queryKey: ["earnings-calendar", monday, watch.join(",")],
    queryFn: () => fetchEarningsCalendar(monday, end, names, watch),
    staleTime: 6 * 3600_000, gcTime: 6 * 3600_000, refetchOnWindowFocus: false, retry: 2,
  });

  const byDay = useMemo(() => {
    const m = new Map<string, EarningsEvent[]>();
    for (const e of q.data ?? []) {
      if (country !== "all" && e.country !== country) continue;
      if (mineOnly && !mine.has(e.code)) continue;
      if (impactOnly && !krImpactOf(e) && !mine.has(e.code)) continue;
      const arr = m.get(e.kstDate) ?? [];
      arr.push(e);
      m.set(e.kstDate, arr);
    }
    const usd = (e: EarningsEvent) => e.country === "KR" ? e.marketCap / KRW_PER_USD : e.marketCap;
    for (const arr of m.values()) arr.sort((a, b) => Number(mine.has(b.code)) - Number(mine.has(a.code))
      || Number(!!krImpactOf(b)) - Number(!!krImpactOf(a)) || usd(b) - usd(a));   // 내 종목 → 한국 영향 → 시총
    return m;
  }, [q.data, country, mineOnly, impactOnly, mine]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-sm font-bold text-gray-800">📅 실적 발표 일정</span>
        <span className="inline-flex rounded border border-gray-300 overflow-hidden text-[12px] font-bold">
          {([["all", "전체"], ["US", "🇺🇸 미국"], ["KR", "🇰🇷 한국"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setCountry(k)}
                    className={`px-2 py-0.5 ${country === k ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>{l}</button>
          ))}
        </span>
        <button onClick={() => setMineOnly(v => !v)}
                className={`px-2 py-0.5 rounded border text-[12px] font-bold
                            ${mineOnly ? "bg-amber-500 text-white border-amber-500" : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"}`}>
          ★ 내 종목만
        </button>
        <button onClick={() => setImpactOnly(v => !v)}
                title="한국 섹터로 번지는 실적만 — 순환매 미국 대장주(반도체·전공정·전력기기 등) + 빅테크 AI 투자·애플·테슬라·방산 + 한국 시총 20조↑ (내 종목은 항상)"
                className={`px-2 py-0.5 rounded border text-[12px] font-bold
                            ${impactOnly ? "bg-rose-600 text-white border-rose-600" : "bg-white text-rose-700 border-rose-300 hover:bg-rose-50"}`}>
          🇰🇷 영향 큰 것만
        </button>
        <span className="text-[11px] text-gray-500">
          {q.isLoading ? "불러오는 중…" : q.isError ? "불러오기 실패 — 잠시 뒤 다시" : `${q.data?.length ?? 0}건`}
          {" · 한국 시간 · 미국 시총 400억달러↑ · 한국 시총 3조↑ · 내 관심종목"}
        </span>
      </div>

      {Array.from({ length: WEEKS }, (_, w) => {
        const start = addDays(monday, w * 7);
        // 월~금 + (미국 금요일 장 후 → 한국 토요일 새벽처럼) 주말에 걸린 날만 덧붙인다
        const days = Array.from({ length: 7 }, (_, d) => addDays(start, d))
          .filter(d => { const k = dowOf(d); return (k >= 1 && k <= 5) || (byDay.get(d)?.length ?? 0) > 0; });
        return (
          <div key={start} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-2 py-1 bg-amber-50 border-b border-amber-100 text-[12px] font-bold text-amber-900">
              {w === 0 ? (monday > today ? "다음 주" : "이번 주") : w === 1 ? (monday > today ? "다다음 주" : "다음 주") : `${w + (monday > today ? 1 : 0)}주 뒤`} · {start.slice(5).replace("-", "/")} 주
            </div>
            <div className={`grid grid-cols-1 ${MD_COLS[days.length] ?? "md:grid-cols-5"} divide-y md:divide-y-0 md:divide-x divide-gray-100`}>
              {days.map(d => {
                const list = byDay.get(d) ?? [];
                const isToday = d === today;
                return (
                  <div key={d} className={`min-w-0 p-1.5 ${isToday ? "bg-blue-50/60" : d < today ? "opacity-50" : ""}`}>
                    <div className={`text-[12px] font-bold mb-1 ${isToday ? "text-blue-700" : "text-gray-700"}`}>
                      {d.slice(5).replace("-", "/")} ({DOW[dowOf(d)]}){isToday && " · 오늘"}
                      {list.length > 0 && <span className="ml-1 font-normal text-gray-400">{list.length}</span>}
                    </div>
                    {list.length === 0
                      ? <div className="text-[11px] text-gray-300">—</div>
                      : <ul className="space-y-0.5">
                          {list.map(e => {
                            const my = mine.has(e.code);
                            const impact = krImpactOf(e);
                            const t = timeLabel(e);
                            return (
                              <li key={`${e.country}:${e.code}`}
                                  className={`flex items-baseline gap-1 text-[12px] leading-tight rounded px-0.5 border-l-2 ${impact ? "border-rose-500 font-bold text-gray-900" : "border-transparent text-gray-600"} ${my ? "bg-yellow-100 font-bold" : ""}`}
                                  title={`${e.name} (${e.code}) · ${d} ${t || "시각 미정"} (한국 시간)${impact ? `\n한국 영향: ${impact}` : ""}`}>
                                <span className="shrink-0 text-[10px]">{e.country === "US" ? "🇺🇸" : "🇰🇷"}</span>
                                {e.country === "KR" && onOpenValuation
                                  ? <button onClick={() => onOpenValuation(e.code, e.name)} className="truncate text-left hover:text-blue-600">{my && "★"}{e.name}</button>
                                  : <span className="truncate">{my && "★"}{e.name}</span>}
                                {impact && <span className="shrink-0 px-1 rounded text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 leading-tight">{impact}</span>}
                                {t && <span className={`ml-auto shrink-0 text-[10px] font-normal ${e.session === "post" ? "text-violet-600" : "text-gray-500"}`}>{t}</span>}
                              </li>
                            );
                          })}
                        </ul>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="text-[11px] text-gray-400 px-1 leading-relaxed">
        출처: TradingView(다음 실적 발표일). 회사가 확정 공지하기 전엔 추정일이라 하루쯤 어긋날 수 있다.
        미국 장 후 발표는 한국 다음 날 새벽, 장 전 발표는 한국 같은 날 밤(서머타임 끝나면 1시간 늦게)이다.
      </div>
    </div>
  );
}
