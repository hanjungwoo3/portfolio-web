// 단타 보조 신호 백테스트 — 종목정보 ⚡실시간 아래(사용자 2026-11-09 "단타 보조 신호, 백테스트 넣어 보자").
//   최근 일주일쯤 토스 1분봉(10쪽 ≈ 4,500분)으로 lib/scalpSignals 규칙(실시간 신호와 같은 것)을 되짚어,
//   신호가 켜진 1분 종가에 샀다면(하락 신호는 팔았다면) h분 뒤 결과가 어땠는지. 왕복 비용 0.25%(수수료·세금 어림) 빼고 승률.
//   돈을 거는 판단이 아니라 '이 규칙이 이 종목에서 통했나'를 보는 것 — 표본이 적으면(10회 미만) 흐리게.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTossMinuteDays } from "../lib/api";
import { backtest, SIGNAL_LABEL } from "../lib/scalpSignals";

const HS = [5, 15, 30] as const;
const COST = 0.25;

export function BacktestBox({ code, name }: { code: string; name: string }) {
  const [h, setH] = useState<number>(15);
  const { data, isLoading, error } = useQuery({
    queryKey: ["backtest-min", code], queryFn: () => fetchTossMinuteDays(code, 10),   // 450×10 ≈ 4,500분 ≈ 일주일(NXT 포함 하루 ~720분)
    staleTime: 30 * 60_000, refetchOnWindowFocus: false,
  });
  const days = (data ?? []).filter(d => d.bars.length >= 60);
  const rows = days.length ? backtest(days.map(d => d.bars), h, COST) : [];
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");
  return (
    <div className="pg-card rounded-lg border border-gray-200 bg-white p-2 text-[12px] shrink-0">
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <b className="text-gray-800">⚡ 단타 신호 백테스트 — {name}</b>
        <span className="text-[11px] text-gray-400">{days.length ? `최근 ${days.length}일 1분봉(${days[0].date.slice(5)}~${days[days.length - 1].date.slice(5)}) · 왕복 비용 ${COST}% 반영` : ""}</span>
        <span className="ml-auto inline-flex rounded border border-gray-300 overflow-hidden text-[11px] font-bold">
          {HS.map(x => (
            <button key={x} onClick={() => setH(x)} className={`px-1.5 ${h === x ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100"}`}>{x}분 뒤</button>
          ))}
        </span>
      </div>
      {isLoading ? <div className="text-gray-400">1분봉 받는 중…</div>
        : error ? <div className="text-rose-600">⚠️ {(error as Error).message}</div>
        : !rows.length ? <div className="text-gray-400">1분봉이 모자랍니다</div> : (
        <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] gap-x-2 gap-y-0.5 tabular-nums">
          <span className="text-[10.5px] text-gray-400">신호</span><span className="text-[10.5px] text-gray-400 text-right">횟수</span>
          <span className="text-[10.5px] text-gray-400 text-right">승률(비용 뒤)</span><span className="text-[10.5px] text-gray-400 text-right">평균</span>
          <span className="text-[10.5px] text-gray-400 text-right">비용 뺀 평균</span><span className="text-[10.5px] text-gray-400 text-right">최고 / 최저</span>
          {rows.map(r => (
            // 10회 미만은 칸마다 흐리게(contents 상자엔 투명도가 안 먹는다)
            (() => { const dim = r.n < 10 ? "opacity-40" : ""; return (
            <div key={r.kind} className="contents">
              <span className={`truncate text-gray-800 ${dim}`}>{SIGNAL_LABEL[r.kind]}</span>
              <span className={`text-right ${dim}`}>{r.n}</span>
              <b className={`text-right ${dim} ${r.n ? (r.win >= 0.5 ? "text-rose-600" : "text-blue-600") : "text-gray-400"}`}>{r.n ? `${Math.round(r.win * 100)}%` : "—"}</b>
              <span className={`text-right ${dim} ${tone(r.avg)}`}>{r.n ? fmt(r.avg) : "—"}</span>
              <b className={`text-right ${dim} ${tone(r.avgAfterCost)}`}>{r.n ? fmt(r.avgAfterCost) : "—"}</b>
              <span className={`text-right text-[11px] text-gray-500 ${dim}`}>{r.n ? `${fmt(r.best)} / ${fmt(r.worst)}` : "—"}</span>
            </div>); })()
          ))}
        </div>
      )}
      <div className="mt-1 text-[10.5px] text-gray-400 leading-snug">
        신호가 켜진 1분 종가에 사고(하락 신호는 팔고) {h}분 뒤 종가로 정리했다고 보고 계산 · 같은 날 안에서만 · 연달아 켜진 신호는 {h}분에 한 번 · 10회 미만은 흐리게(믿기 어렵다) · 체결강도 급등 신호는 지난 체결 기록이 없어 실시간에서만 · 과거 성적이 앞으로를 보장하지 않습니다
      </div>
    </div>
  );
}
