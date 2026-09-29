// 눌림목 조건 백테스트 패널 — 스크리너 화면 안에 접어 둔다.
//   "지금 무엇이 걸리나"(스크리너) 옆에 "걸린 뒤 실제로 올랐나"(여기)를 붙여야 판단이 된다.
//   일봉 200콜이 드는 일회성 작업이라 사용자가 눌러야 실행하고, 한 번 받으면 세션 내내 재사용한다.

import { useState } from "react";
import { signColor } from "../lib/format";
import {
  loadBacktestBars, runBacktest, hasBacktestBars, FWD_DAYS,
  type BacktestResult,
} from "../lib/screenerBacktest";
import type { ScreenCriteria } from "../lib/stockScreener";

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export function BacktestPanel({ criteria }: { criteria: ScreenCriteria }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [res, setRes] = useState<BacktestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const bars = await loadBacktestBars((done, total) => setProg({ done, total }));
      setRes(runBacktest(criteria, bars));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "백테스트 실패");
    } finally { setBusy(false); setProg(null); }
  };
  // 일봉이 이미 있으면 조건만 바꿔 즉시 다시 계산(0콜).
  const recompute = () => setRes(runBacktest(criteria));

  return (
    <div className="rounded-xl border border-gray-300 bg-white">
      <button onClick={() => setOpen(o => !o)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
        <span className="text-sm font-bold text-gray-700">📉 이 조건, 과거에 먹혔나</span>
        <span className="text-[11px] text-gray-400">
          신호 뒤 5일·20일 수익률을 <b>같은 날 시장 평균</b>과 비교
        </span>
        <span className="ml-auto text-gray-400">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-gray-100 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={run} disabled={busy}
                    className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300
                               bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50">
              {busy ? "계산 중…" : res ? "🔄 다시 받기" : "▶ 실행 (코스피200 · 약 200콜)"}
            </button>
            {res && hasBacktestBars() && (
              <button onClick={recompute}
                      title="이미 받아 둔 일봉으로 지금 조건에 맞춰 다시 계산합니다 (추가 호출 없음)"
                      className="px-3 py-1.5 text-sm font-medium rounded-md border border-indigo-300
                                 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                지금 조건으로 다시 계산 (0콜)
              </button>
            )}
            {prog && (
              <span className="text-[11px] text-gray-500 tabular-nums">
                일봉 {prog.done} / {prog.total}
              </span>
            )}
          </div>

          {err && (
            <div className="p-2 rounded border border-amber-300 bg-amber-50 text-[11px] text-amber-800">
              ⚠️ {err}
            </div>
          )}

          {!res && !busy && (
            <p className="text-[11px] text-gray-500 leading-relaxed">
              코스피200 201종의 일봉 450개(약 2년)를 받아, 매일 이 조건에 걸렸던 종목을 찾고
              그 뒤 5·20거래일 수익률을 계산합니다. 종목당 1콜이라 1분 남짓 걸립니다.
              한 번 받아 두면 조건을 바꿔도 <b>추가 호출 없이</b> 다시 계산합니다.
            </p>
          )}

          {res && (
            <>
              <div className="text-[11px] text-gray-500 tabular-nums">
                종목 {res.universe} · 평가구간 {res.tradingDays}거래일 ·
                <b className="text-gray-800"> 신호 {res.signals.toLocaleString()}건</b>
                ({res.signalDays}일에 걸쳐 발생)
              </div>
              {res.signals === 0 ? (
                <div className="py-4 text-center text-[12px] text-gray-500">
                  이 조건은 과거 2년 동안 <b className="text-rose-600">한 번도</b> 걸리지 않았습니다.
                  문턱을 풀어 보세요.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-200">
                        <th className="text-left font-normal py-1 pr-2">기간</th>
                        <th className="text-right font-normal px-2">평균</th>
                        <th className="text-right font-normal px-2">중앙값</th>
                        <th className="text-right font-normal px-2">승률</th>
                        <th className="text-right font-normal pl-2">건수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FWD_DAYS.map(h => {
                        const r = res.byHorizon[h];
                        if (!r) return null;
                        const rows: [string, typeof r.signal, string][] = [
                          [`+${h}일 · 신호 종목`, r.signal, "text-gray-800 font-bold"],
                          ["　　　시장 전체", r.market, "text-gray-500"],
                          ["　　　초과수익", r.excess, "font-bold"],
                        ];
                        return rows.map(([label, s, cls], i) => (
                          <tr key={`${h}-${i}`}
                              className={i === 2 ? "border-b-2 border-gray-200" : ""}>
                            <td className={`py-0.5 pr-2 ${i === 0 ? "text-gray-700 font-bold" : "text-gray-400"}`}>
                              {label}
                            </td>
                            <td className={`text-right px-2 ${i === 2 ? signColor(s.mean) : ""} ${cls}`}>
                              {pct(s.mean)}{i === 2 && "p"}
                            </td>
                            <td className={`text-right px-2 ${i === 2 ? signColor(s.median) : ""} ${cls}`}>
                              {pct(s.median)}{i === 2 && "p"}
                            </td>
                            <td className={`text-right px-2 ${cls}`}>{s.winRate.toFixed(1)}%</td>
                            <td className="text-right pl-2 text-gray-400">{s.n.toLocaleString()}</td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {res.signals > 0 && (
                <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px]
                                text-gray-600 leading-relaxed">
                  <b className="text-gray-800">초과수익</b> 줄만 보세요. 위 두 줄(신호·시장)이 같이 높으면
                  조건이 좋은 게 아니라 <b>그냥 상승장</b>이었다는 뜻입니다.
                  초과수익의 <b>승률</b>은 "그날 시장 평균보다 나았던 비율" 입니다 — 50% 를 못 넘으면
                  이 조건으로 고른 것이 평균만도 못했다는 뜻입니다.
                </div>
              )}
            </>
          )}

          <p className="text-[10px] text-gray-400 leading-relaxed">
            한계 — ① <b>생존 편향</b>: 지금의 코스피200 구성종목만 본다(그동안 편출된 종목이 빠졌다).
            ② <b>흑자 조건 제외</b>: 과거 시점의 재무를 모른다. 오늘 흑자를 과거에 적용하면 미래 정보를
            쓰는 꼴이라 가격 기반 조건만 돌린다. ③ <b>매매비용 미반영</b>: 수수료·세금·슬리피지가 빠져 있다.
          </p>
        </div>
      )}
    </div>
  );
}
