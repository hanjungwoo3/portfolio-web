// ⚡ 종목 실시간 체결 팝업 — 한 종목을 크게(사용자 요청 2026-10-22). 종목 카드 ⚡·반도체 탭 체결 칸 제목에서 연다.
//   위: 오늘 1분 가격(전일 종가 기준선) / 가운데: 실시간 체결(반도체 탭 칸을 크게 + 1분 매수·매도 막대) + 큰 체결 목록
//   아래: 투자자 일별 수급 60일 — 종목별 장중 시간별 투자자 수급은 무료 소스가 없다(일별까지만).
//   체결은 팝업이 열려 있을 때만 5초마다 받는다. 쌓인 것은 종목별로 브라우저에 남아(useTickFlow) 다시 열면 이어진다.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fetchTossPrices, fetchTossKrMinuteToday, fetchTossDayStrength, fetchInvestorHistory } from "../lib/api";
import { useTickFlow } from "../lib/useTickFlow";
import { useTickPopup, closeTickPopup } from "../lib/tickPopup";
import { TickPanel } from "./SemiDashTab";
import { Sparkline } from "./Sparkline";
import type { Investor } from "../types";

export function StockTickPopupHost() {
  const t = useTickPopup();
  if (!t) return null;
  return <StockTickPopup key={t.code} code={t.code} name={t.name} />;   // 종목이 바뀌면 새로(체결 누적 상태가 종목별)
}

const up = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function StockTickPopup({ code, name }: { code: string; name: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeTickPopup(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const flow = useTickFlow(code);
  const { data: price } = useQuery({
    queryKey: ["tick-popup-price", code], queryFn: async () => (await fetchTossPrices([code]))[0] ?? null,
    refetchInterval: 5_000, staleTime: 3_000,
  });
  const { data: mins } = useQuery({
    queryKey: ["tick-popup-min", code], queryFn: () => fetchTossKrMinuteToday(code),
    refetchInterval: 30_000, staleTime: 20_000,
  });
  const { data: dayStr } = useQuery({
    queryKey: ["toss-day-strength", code], queryFn: () => fetchTossDayStrength([code]),
    refetchInterval: 10_000, staleTime: 5_000,
  });
  const { data: inv } = useQuery({
    queryKey: ["tick-popup-inv", code], queryFn: () => fetchInvestorHistory(code, 60),
    refetchInterval: 5 * 60_000, staleTime: 60_000,
  });

  const base = price?.prevClose || mins?.base;
  const pct = price && base ? ((price.price - base) / base) * 100 : undefined;
  // 하루 가격 — 가로 = 시각(08:00 ~ 15:30, 시간외까지 있으면 그 끝까지)
  const bars = mins?.bars ?? [];
  const T0 = 8 * 60, T1 = Math.max(15 * 60 + 30, bars.length ? hm(bars[bars.length - 1].t) : 0);
  const openIdx = bars.findIndex(b => b.t >= "09:00");
  const closeIdx = bars.map(b => b.t <= "15:30").lastIndexOf(true);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={closeTickPopup}>
      <div className="bg-gray-50 w-full h-full sm:w-[min(1400px,96vw)] sm:h-[92vh] sm:rounded-xl shadow-2xl flex flex-col overflow-hidden text-[12px]"
           onClick={e => e.stopPropagation()}>
        {/* 머리 — 종목·가격 */}
        <div className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 bg-white border-b">
          <span className="text-base font-bold text-gray-900">⚡ {name}</span>
          <span className="text-gray-400">{code}</span>
          {price && <span className="text-base font-bold tabular-nums text-gray-900">{Math.round(price.price).toLocaleString()}</span>}
          {pct != null && <span className={`font-bold tabular-nums ${up(pct)}`}>{pct > 0 ? "+" : ""}{pct.toFixed(2)}%</span>}
          <a href={`https://tossinvest.com/stocks/A${code}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:text-blue-600 underline">토스</a>
          <button onClick={closeTickPopup} title="닫기 (Esc)" className="ml-auto p-1 rounded text-gray-500 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
          {/* ① 오늘 가격 1분 */}
          <div className="rounded-lg border border-gray-200 bg-white p-2 shrink-0">
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-gray-800">오늘 가격</span>
              <span className="text-[11px] text-gray-400">1분 · 08:00(NXT)부터 · 점선 = 정규장 시작 · 실선 = 15:30 마감 · 가로 점선 = 전일 종가</span>
            </div>
            <div className="h-[110px]">
              {bars.length > 1
                ? <Sparkline data={bars.map(b => b.close)} xs={bars.map(b => (hm(b.t) - T0) / (T1 - T0))} baseline={base}
                             markIndex={openIdx > 0 ? openIdx : undefined} closeIndex={closeIdx > 0 && closeIdx < bars.length - 1 ? closeIdx : undefined}
                             width={600} height={110} className="w-full h-full" strokeWidth={1.4} />
                : <div className="h-full flex items-center justify-center text-gray-400">{mins ? "오늘 거래 전" : "불러오는 중…"}</div>}
            </div>
          </div>
          {/* ② 실시간 체결 — 반도체 탭 칸을 크게 */}
          <div className="h-[420px] shrink-0 grid">
            <TickPanel name={name} flow={flow} day={dayStr?.get(code)} big={40} split span={240} />
          </div>
          {/* ③ 투자자 일별 수급 */}
          <InvestorDaily hist={inv ?? []} price={price?.price} />
        </div>
      </div>
    </div>
  );
}

// 투자자 일별 순매수(억원 = 수량 × 그날 종가) — 개인·외국인·기관(금융투자 제외: ETF·차익 헤지가 섞여 방향이 흐려진다)
const INV_ROWS: { label: string; color: string; v: (r: Investor) => number }[] = [
  { label: "개인", color: "#7c3aed", v: r => r.개인 },
  { label: "외국인", color: "#ea580c", v: r => r.외국인 },
  { label: "기관(금투 제외)", color: "#059669", v: r => r.기관 - r.금융투자 },
];
function InvestorDaily({ hist, price }: { hist: Investor[]; price?: number }) {
  const days = [...hist].reverse();   // 과거 → 최신
  const W = 600, H = 44;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 shrink-0">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-bold text-gray-800">투자자 일별 수급</span>
        <span className="text-[11px] text-gray-400">최근 {days.length}일 · 억원(수량 × 그날 종가) · 오늘은 잠정치 · 장중 시간별 종목 수급은 소스가 없어 일별만</span>
      </div>
      {days.length < 2 ? <div className="h-[60px] flex items-center justify-center text-gray-400">불러오는 중…</div> : INV_ROWS.map(row => {
        const vals = days.map(r => (row.v(r) * (r.종가 || price || 0)) / 1e8);
        const mx = Math.max(1, ...vals.map(Math.abs));
        const bw = W / vals.length;
        const sum = (n: number) => vals.slice(-n).reduce((a, v) => a + v, 0);
        let streak = 0;
        for (const v of [...vals].reverse()) { const sg = Math.sign(v); if (!sg || (streak && Math.sign(streak) !== sg)) break; streak += sg; }
        const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString()}`;
        return (
          <div key={row.label} className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 tabular-nums">
            <span className="w-[92px] shrink-0 font-bold" style={{ color: row.color }}>{row.label}</span>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="order-last sm:order-none basis-full sm:basis-auto flex-1 min-w-0 h-[44px]">
              <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#e5e7eb" vectorEffect="non-scaling-stroke" />
              {vals.map((v, i) => {
                const h = (Math.abs(v) / mx) * (H / 2 - 1);
                return <rect key={i} x={i * bw + bw * 0.1} width={bw * 0.8} y={v >= 0 ? H / 2 - h : H / 2} height={Math.max(0.5, h)} fill={v >= 0 ? "#f43f5e" : "#3b82f6"} opacity={i === vals.length - 1 ? 1 : 0.7} />;
              })}
            </svg>
            <span className="ml-auto sm:ml-0 sm:w-[260px] shrink-0 text-[11px] text-gray-500 flex gap-2 justify-end">
              <span>오늘 <b className={up(vals[vals.length - 1])}>{fmt(vals[vals.length - 1])}</b></span>
              <span>5일 <b className={up(sum(5))}>{fmt(sum(5))}</b></span>
              <span>20일 <b className={up(sum(20))}>{fmt(sum(20))}</b></span>
              <span className={up(streak)}>{streak ? `${Math.abs(streak)}일${streak > 0 ? "↑" : "↓"}` : "-"}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
