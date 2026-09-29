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
  const [glossary, setGlossary] = useState(true);   // 용어 설명 — 처음엔 펴 둔다

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
              {/* 무엇을 어떻게 계산한 건지 — 이게 없으면 숫자를 오해한다. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5
                              text-[11px] text-amber-900 leading-relaxed">
                <b>이렇게 계산했습니다</b>
                <div className="mt-0.5 text-amber-800">
                  ① 조건에 걸린 <b>다음 날 종가</b>에 사서 <b>N거래일 뒤 종가</b>에 팝니다.
                  (걸린 날 종가로 사는 계산은 반칙입니다 — 그 종가가 나와야 조건이 성립하는데,
                  그 값으로 산다는 건 미래를 알고 사는 셈이니까요.)
                  <br />
                  ② 그날 걸린 종목을 <b>전부 똑같은 금액씩</b> 샀다고 봅니다.
                  6개가 걸렸으면 6개 다입니다. 하나만 고르면 결과는 아래 <b>σ</b> 만큼 널뜁니다.
                  <br />
                  ③ 손절·익절은 없습니다. 정해진 날짜에 무조건 팝니다.
                </div>
              </div>
              {res.signals === 0 ? (
                <div className="py-4 text-center text-[12px] text-gray-500">
                  이 조건은 과거 2년 동안 <b className="text-rose-600">한 번도</b> 걸리지 않았습니다.
                  문턱을 풀어 보세요.
                </div>
              ) : (
                // 한 표에 다 넣으면 폭이 넓어져 라벨과 숫자가 화면 양 끝으로 벌어진다.
                //   기간별로 상자를 나누고 그 안에서만 정렬한다.
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {FWD_DAYS.map(h => {
                    const r = res.byHorizon[h];
                    if (!r) return null;
                    const rows: [string, typeof r.signal, boolean][] = [
                      ["신호 종목", r.signal, false],
                      ["시장 전체", r.market, false],
                      ["초과수익", r.excess, true],
                    ];
                    return (
                      <div key={h} className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="px-2 py-1 bg-gray-50 border-b border-gray-200
                                        text-[11px] font-bold text-gray-700">
                          신호 뒤 +{h}일
                        </div>
                        <table className="w-full text-[11px] tabular-nums">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left font-normal py-0.5 pl-2"></th>
                              <th className="text-right font-normal py-0.5 px-1">평균</th>
                              <th className="text-right font-normal py-0.5 px-1">중앙값</th>
                              <th className="text-right font-normal py-0.5 px-1">승률</th>
                              <th className="text-right font-normal py-0.5 pr-2"
                                  title="수익률의 표준편차 — 클수록 결과가 들쭉날쭉">σ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(([label, st, isExcess]) => (
                              <tr key={label}
                                  className={isExcess ? "bg-indigo-50/70 border-t border-indigo-200" : ""}>
                                <td className={`py-0.5 pl-2 whitespace-nowrap
                                                ${isExcess ? "text-indigo-700 font-bold" : "text-gray-500"}`}>
                                  {label}
                                </td>
                                <td className={`text-right px-1 font-bold
                                                ${isExcess ? signColor(st.mean) : "text-gray-700"}`}>
                                  {pct(st.mean)}{isExcess && "p"}
                                </td>
                                <td className={`text-right px-1 font-bold
                                                ${isExcess ? signColor(st.median) : "text-gray-700"}`}>
                                  {pct(st.median)}{isExcess && "p"}
                                </td>
                                <td className={`text-right px-1 font-bold
                                                ${isExcess ? (st.winRate >= 50 ? "text-rose-600" : "text-blue-600")
                                                           : "text-gray-700"}`}>
                                  {st.winRate.toFixed(1)}%
                                </td>
                                <td className="text-right pr-2 text-gray-400">±{st.std.toFixed(1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {/* 보유 중 최대낙폭 — 눌림목은 '더 빠질 수 있는 자리' 를 사는 전략이라
                            평균 수익률만큼이나 "들고 있는 동안 얼마나 빠졌나" 가 중요하다. */}
                        <div className="flex items-baseline gap-2 px-2 py-1 border-t border-gray-200
                                        bg-gray-50/60 text-[10px] tabular-nums">
                          <span className="text-gray-500" title="진입가 대비 보유 기간 내 최저 종가">
                            보유 중 최대낙폭
                          </span>
                          <span className="text-blue-600 font-bold">평균 {r.dd.mean.toFixed(1)}%</span>
                          <span className="text-blue-700 font-bold">최악 {r.dd.worst.toFixed(1)}%</span>
                          <span className="ml-auto text-gray-400">{r.signal.n.toLocaleString()}건</span>
                        </div>
                      </div>
                    );
                  })}
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

              {res.signals > 0 && (
                <div className="rounded-lg border border-gray-200">
                  <button onClick={() => setGlossary(g => !g)}
                          className="w-full flex items-center gap-2 px-2 py-1 text-left">
                    <span className="text-[11px] font-bold text-gray-700">❓ 이 숫자들이 무슨 뜻인가</span>
                    <span className="ml-auto text-gray-400 text-[11px]">{glossary ? "▾" : "▸"}</span>
                  </button>
                  {glossary && (
                    <dl className="px-2 pb-2 space-y-1.5 text-[11px] leading-relaxed border-t border-gray-100 pt-1.5">
                      {([
                        ["신호 종목",
                         "조건에 걸린 종목들을 다음 날 사서 N일 뒤 판 결과입니다."],
                        ["시장 전체",
                         "같은 날 같은 방식으로 코스피200 **전 종목**을 샀다면 어땠을지. 비교용 기준선입니다."],
                        ["초과수익",
                         "신호 종목에서 **그날 시장 평균**을 뺀 값. 상승장 덕을 걷어낸 '진짜 실력' 입니다. 단위 %p — 0 근처면 시장이랑 똑같았다는 뜻입니다."],
                        ["평균",
                         "다 더해서 나눈 값. 크게 오른 몇 개가 끌어올립니다. 중앙값과 많이 벌어지면 '대박 몇 개' 가 만든 숫자입니다."],
                        ["중앙값",
                         "딱 가운데 값. '보통 이 정도였다' 는 평균보다 이쪽이 정확합니다."],
                        ["승률",
                         "이익이 난 비율. 단, **초과수익 줄의 승률**은 '시장보다 잘한 비율' 입니다 — 50% 아래면 시장 평균만도 못했다는 뜻입니다."],
                        ["σ (시그마)",
                         "결과가 얼마나 널뛰는지. 평균 +2% 에 σ ±8% 면 −6% ~ +10% 사이가 흔하다는 뜻입니다. 클수록 운에 가깝습니다."],
                        ["보유 중 최대낙폭",
                         "들고 있는 동안 **가장 많이 빠진 폭**. '평균' 은 보통 이 정도는 물린다, '최악' 은 제일 나빴을 때입니다. 손절선을 이 숫자에 맞춰 잡으세요."],
                        ["건수",
                         "몇 번이나 이런 일이 있었는지. 적으면 우연일 수 있습니다."],
                      ] as [string, string][]).map(([term, desc]) => (
                        <div key={term} className="flex gap-2">
                          <dt className="shrink-0 w-24 text-gray-700 font-bold">{term}</dt>
                          <dd className="flex-1 text-gray-600">
                            {desc.split("**").map((part, i) =>
                              i % 2 ? <b key={i} className="text-gray-800">{part}</b> : part)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
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
