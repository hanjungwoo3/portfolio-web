// 동시호가 예상 등락률 순위 — 지수 탭 맨 위, 앱 + 한국투자 연동일 때만, 장전(08:25~09:03)·장마감(15:15~15:33) 동시호가 동안만(사용자 2026-11-02).
//   PC·모바일 지수 탭이 같이 쓴다. 종목을 누르면 📊종목정보 창.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { expPhaseNow, expRankAvailable, fetchKisExpRank, type ExpRankRow } from "../lib/kisExpRank";
import { openStockInfo } from "../lib/tickPopup";

const MARKETS = [["0000", "전체"], ["0001", "코스피"], ["1001", "코스닥"]] as const;

export function KisExpRankBox({ compact }: { compact?: boolean }) {
  const [phase, setPhase] = useState(expPhaseNow);
  useEffect(() => { const id = setInterval(() => setPhase(expPhaseNow()), 20_000); return () => clearInterval(id); }, []);
  const [mkt, setMkt] = useState<(typeof MARKETS)[number][0]>("0000");
  const on = expRankAvailable() && !!phase;
  const opt = { enabled: on, refetchInterval: 5_000, staleTime: 3_000, retry: 1 } as const;
  const up = useQuery({ queryKey: ["kis-exp-rank", "up", phase, mkt], queryFn: () => fetchKisExpRank("up", phase!, mkt), ...opt });
  const dn = useQuery({ queryKey: ["kis-exp-rank", "down", phase, mkt], queryFn: () => fetchKisExpRank("down", phase!, mkt), ...opt });
  if (!on) return null;
  const n = compact ? 10 : 15;
  const list = (rows: ExpRankRow[] | undefined, err: unknown, title: string, cls: string) => (
    <div className="min-w-0">
      <div className={`text-xs font-bold mb-0.5 ${cls}`}>{title}</div>
      {err ? <div className="text-[11px] text-amber-700">⚠️ {(err as Error).message}</div>
        : !rows ? <div className="text-[11px] text-gray-400">불러오는 중…</div>
        : !rows.length ? <div className="text-[11px] text-gray-400">아직 없음</div>
        : (
          <table className="w-full text-[11.5px] tabular-nums">
            <tbody>
              {rows.slice(0, n).map((r, i) => (
                <tr key={r.code} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openStockInfo(r.code, r.name)} title={`${r.name}(${r.code}) — 눌러서 종목정보`}>
                  <td className="w-5 text-gray-400">{i + 1}</td>
                  <td className="truncate max-w-[9rem] font-medium text-gray-800">{r.name}</td>
                  <td className="text-right">{r.price.toLocaleString()}</td>
                  <td className={`text-right font-bold ${r.pct > 0 ? "text-rose-600" : r.pct < 0 ? "text-blue-600" : "text-gray-600"}`}>{r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%</td>
                  {!compact && <td className="text-right text-gray-500">{r.amt > 0 ? `${(r.amt / 1e8).toFixed(r.amt >= 1e10 ? 0 : 1)}억` : ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
  return (
    <div className="pg-box relative rounded-xl border border-amber-300 bg-amber-50/40 p-2.5 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 text-sm font-bold text-amber-800 whitespace-nowrap">
        ⏱ 동시호가 예상 순위 · {phase === "open" ? "장 시작 전" : "장 마감 전"}
        <span className="ml-2 inline-flex rounded border border-amber-300 overflow-hidden align-middle text-[11px]">
          {MARKETS.map(([v, l]) => (
            <button key={v} onClick={() => setMkt(v)} className={`px-1.5 ${mkt === v ? "bg-amber-600 text-white" : "bg-white text-gray-600 hover:bg-amber-100"}`}>{l}</button>
          ))}
        </span>
      </span>
      <div className="text-[10.5px] text-gray-500 mb-1">예상 체결가 기준 · 5초마다 · 보통주 · 한국투자 — 동시호가가 끝나면 사라집니다</div>
      <div className="grid grid-cols-2 gap-3">
        {list(up.data, up.error, "▲ 상승 상위", "text-rose-600")}
        {list(dn.data, dn.error, "▼ 하락 상위", "text-blue-600")}
      </div>
    </div>
  );
}
