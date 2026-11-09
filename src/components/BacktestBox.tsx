// 단타 신호 성적(백테스트) — 종목정보 ⚡실시간, 호가·거래원·프로그램 옆 칸(사용자 2026-11-09 "단타 보조 신호, 백테스트", "공시 자리에", "초보도 알아먹게").
//   최근 일주일쯤 토스 1분봉으로 lib/scalpSignals 규칙(실시간 신호와 같은 것)을 되짚는다:
//   "이 신호가 떴을 때 샀다면, N분 뒤 팔았을 때 돈을 벌었나?" — 수수료·세금(0.25%)을 뺀 결과. 떨어지는 신호는 '팔았다면'.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTossMinuteDays } from "../lib/api";
import { backtest, SIGNAL_LABEL, SIGNAL_PLAIN, type SignalKind } from "../lib/scalpSignals";
import { HoverTip } from "./HoverTip";

const HS = [5, 15, 30] as const;
const COST = 0.25;

export interface LiveHit { kind: SignalKind; text: string; detail: string; t: string; dir: "up" | "down" }
export function BacktestBox({ code, name, live = [] }: { code: string; name: string; live?: LiveHit[] }) {
  const [h, setH] = useState<number>(15);
  const { data, isLoading, error } = useQuery({
    queryKey: ["backtest-min", code], queryFn: () => fetchTossMinuteDays(code, 10),   // 450×10 ≈ 4,500분 ≈ 일주일
    staleTime: 30 * 60_000, refetchOnWindowFocus: false,
  });
  const days = (data ?? []).filter(d => d.bars.length >= 60);
  const rows = days.length ? backtest(days.map(d => d.bars), h, COST) : [];
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  return (
    <div className="pg-card rounded-lg border border-gray-200 bg-white p-2 text-[12px] flex flex-col min-h-0 min-w-0">
      <div className="flex items-baseline gap-1">
        <b className="text-gray-800">⚡ 단타 신호 성적</b>
        <HoverTip width={320} tip={`이 칸은 무엇인가요?\n'종목 신호'에 뜨는 ⚡ 신호들이 ${name}에서 예전에 얼마나 맞았는지 보여 줘요.\n최근 ${days.length || "며칠"}일 동안 신호가 뜬 순간에 샀다고 치고, 정해 둔 시간 뒤에 팔았다면 돈을 벌었는지 계산했어요.\n떨어지는 신호는 반대로 '그때 팔았다면 손해를 피했는지'로 봐요.\n수수료와 세금(약 0.25%)을 빼고 계산해요.\n예전에 잘 맞았다고 앞으로도 맞는다는 보장은 없어요.`}>
          <span className="w-4 h-4 inline-flex items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500 cursor-help">?</span>
        </HoverTip>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px]">
        <span className="text-gray-500">신호 보고 산 뒤</span>
        <span className="inline-flex rounded border border-gray-300 overflow-hidden font-bold">
          {HS.map(x => (
            <button key={x} onClick={() => setH(x)} className={`px-1.5 ${h === x ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100"}`}>{x}분</button>
          ))}
        </span>
        <span className="text-gray-500">뒤에 팔았다면</span>
      </div>
      {/* 지금 뜬 신호 — 최근 10분(종목 신호의 ⚡ 줄과 같은 것). 아래 성적과 같이 보면 '믿을 만한 신호인가'가 보인다 */}
      <div className="mt-1.5 rounded bg-amber-50 border border-amber-200 px-1.5 py-1">
        <div className="text-[11px] font-bold text-amber-800">지금 뜬 신호 <span className="font-normal text-amber-700/70">최근 10분</span></div>
        {live.length === 0 ? <div className="text-[11.5px] text-gray-500">아직 없어요 — 뜨면 여기와 '종목 신호'에 같이 나와요</div>
          : live.map(l => (
            <HoverTip key={l.kind} tip={`${l.detail}\n${SIGNAL_PLAIN[l.kind]}`} width={320}>
              <div className={`text-[12px] font-bold cursor-help ${l.dir === "up" ? "text-rose-600" : "text-blue-600"}`}>⚡ {l.t} {l.text}</div>
            </HoverTip>
          ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto mt-1.5 space-y-2">
        {isLoading ? <div className="text-gray-400">지난 기록 받는 중…</div>
          : error ? <div className="text-rose-600">⚠️ {(error as Error).message}</div>
          : !rows.length ? <div className="text-gray-400">지난 기록이 모자라요</div>
          : rows.map(r => {
            const won = Math.round(r.win * r.n);
            const few = r.n < 10;
            return (
              <div key={r.kind} className={`rounded border px-1.5 py-1 ${live.some(l => l.kind === r.kind) ? "border-amber-400 bg-amber-50/60" : "border-gray-100"} ${few ? "opacity-50" : ""}`}>
                <HoverTip tip={SIGNAL_PLAIN[r.kind]} width={300}><b className="text-gray-800 cursor-help">{SIGNAL_LABEL[r.kind]}</b></HoverTip>
                {live.some(l => l.kind === r.kind) && <span className="ml-1 px-1 rounded bg-amber-500 text-white text-[9.5px] font-bold">지금 떴어요</span>}
                {r.n === 0 ? <div className="text-gray-400 text-[11.5px]">최근엔 이 신호가 한 번도 안 떴어요</div> : (<>
                  <div className="text-[12px]">
                    {r.n}번 중 <b className={r.win >= 0.5 ? "text-rose-600" : "text-blue-600"}>{won}번 이익</b>
                    <span className="text-gray-500"> ({Math.round(r.win * 100)}%)</span>
                  </div>
                  <div className="text-[11.5px] text-gray-600">
                    한 번에 평균 <b className={r.avgAfterCost > 0 ? "text-rose-600" : "text-blue-600"}>{pct(r.avgAfterCost)}</b>
                    <span className="text-gray-400"> · 가장 좋았을 때 {pct(r.best - COST)} · 나빴을 때 {pct(r.worst - COST)}</span>
                  </div>
                  {few && <div className="text-[10.5px] text-gray-400">횟수가 적어서 아직 믿기 어려워요</div>}
                </>)}
              </div>
            );
          })}
      </div>
      <div className="mt-1 text-[10.5px] text-gray-400 leading-snug">수수료·세금 0.25% 뺀 결과 · 최근 {days.length || "-"}일 1분 기록 · '사려는 사람이 갑자기 몰림' 신호는 지난 기록이 없어 여기선 못 봐요</div>
    </div>
  );
}
