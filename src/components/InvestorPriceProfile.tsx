// 가격대별 투자자 순매수 — "이 투자자가 **어느 가격대에서 사서 어느 가격대에서 팔았나**".
//
// 일별 순매수(수량)를 그 날 종가의 가격대 칸에 쌓는다. 기존 '투자자별 순매수' 표가 날짜 축이라면
//   여기는 **가격 축**이다. 같은 데이터를 돌려 쓰므로 추가 조회가 없다(모달이 이미 200일치를 받는다).
//
// ★ 금융투자를 기관에서 뺀 걸 기본으로 둔다.
//   금융투자는 증권사 자기매매 계정이라 ETF 설정·차익거래·헤지가 섞인다. 그걸 합쳐 놓으면
//   "기관이 고점에 매집했다" 처럼 읽히는데 실은 기계적 물량인 경우가 많다.
//   실측(성호전자 200일): 48,105~53,200원 구간 기관계 +146만주 중 **134만주가 금융투자**였다.
//
// ⚠️ 한계 셋. 화면에도 적는다.
//   1) 체결가가 아니라 **그 날 종가**다. 장중 등락이 큰 종목은 실제 매집 단가와 벌어진다.
//   2) **순매수(net)** 라 같은 날의 대량 매수·매도가 상쇄된다.
//   3) 토스 상한이 **200일** 이라 그 이전 매집은 안 보인다.

import { useMemo, useState } from "react";
import type { Investor } from "../types";
import { signColor } from "../lib/format";
import { buildPriceProfile, type ProfileWho } from "../lib/investorProfile";

type Who = ProfileWho;

const WHO: { key: Who; label: string; hint: string }[] = [
  { key: "inst_ex_fin", label: "기관(금투 제외)", hint: "기관계에서 금융투자를 뺀 값 — 차익·헤지 물량을 걷어낸 '실수요' 쪽" },
  { key: "financialInvestment", label: "금융투자", hint: "증권사 자기매매 — ETF 설정·차익거래·헤지가 섞인다" },
  { key: "pensionFund", label: "연기금", hint: "장기 자금" },
  { key: "trust", label: "투신", hint: "펀드" },
  { key: "foreigner", label: "외국인", hint: "외국인 순매수" },
  { key: "individual", label: "개인", hint: "개인 순매수" },
];

const PERIODS = [60, 120, 200];

function fmtVol(n: number, won: boolean): string {
  const v = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  if (won) {
    if (v >= 1e12) return `${sign}${(v / 1e12).toFixed(2)}조`;
    if (v >= 1e8)  return `${sign}${(v / 1e8).toFixed(1)}억`;
    return `${sign}${Math.round(v / 1e4).toLocaleString()}만`;
  }
  if (v >= 1e8) return `${sign}${(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${sign}${(v / 1e4).toFixed(1)}만`;
  return `${sign}${Math.round(v).toLocaleString()}`;
}

export function InvestorPriceProfile({ history, curPrice }: {
  history: Investor[];
  curPrice?: number;
}) {
  const [who, setWho] = useState<Who>("inst_ex_fin");
  const [days, setDays] = useState(120);
  const [won, setWon] = useState(false);   // 수량(주) / 금액(원)

  const model = useMemo(
    () => buildPriceProfile(history, who, days, won),
    [history, who, days, won],
  );

  if (!model) return null;
  const { bins, max, days: used, avgBuy, avgSell, net } = model;
  const whoMeta = WHO.find(w => w.key === who);
  // 산 값이 판 값보다 비싸면 '비싸게 사서 싸게 판' 것이다 — 이 화면이 답하려는 질문.
  const gap = avgBuy != null && avgSell != null ? avgBuy - avgSell : null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1 flex-wrap mb-1.5">
        {WHO.map(w => (
          <button key={w.key} onClick={() => setWho(w.key)} title={w.hint}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold border transition ${
                    who === w.key ? "bg-gray-800 text-white border-gray-800"
                                  : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {w.label}
          </button>
        ))}
        <span className="text-gray-300 mx-0.5">|</span>
        {PERIODS.map(p => (
          <button key={p} onClick={() => setDays(p)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold border transition ${
                    days === p ? "bg-indigo-600 text-white border-indigo-600"
                               : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {p}일
          </button>
        ))}
        <button onClick={() => setWon(v => !v)}
                title="수량(주) ↔ 금액(수량 × 그 날 종가)"
                className="px-1.5 py-0.5 rounded text-[11px] font-bold border border-gray-300
                           bg-white text-gray-600 hover:bg-gray-50">
          {won ? "금액" : "수량"}
        </button>
      </div>

      {/* 요약 — 평균 매수단가 vs 평균 매도단가. 이 두 숫자가 질문의 답이다. */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] mb-1.5">
        <span className="text-gray-500">{used}일 · {whoMeta?.label}</span>
        {avgBuy != null && (
          <span>평균 매수 <b className="tabular-nums text-rose-600">{Math.round(avgBuy).toLocaleString()}원</b></span>
        )}
        {avgSell != null && (
          <span>평균 매도 <b className="tabular-nums text-blue-600">{Math.round(avgSell).toLocaleString()}원</b></span>
        )}
        {gap != null && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100">
            매수−매도{" "}
            <b className={`tabular-nums ${gap > 0 ? "text-rose-700" : "text-blue-700"}`}>
              {gap > 0 ? "+" : ""}{Math.round(gap).toLocaleString()}원
            </b>
            <span className="text-gray-500 ml-1">{gap > 0 ? "비싸게 사서 싸게 팔았다" : "싸게 사서 비싸게 팔았다"}</span>
          </span>
        )}
        <span className="ml-auto text-gray-400">
          합계 <b className={`tabular-nums ${signColor(net)}`}>{fmtVol(net, won)}</b>{won ? "원" : "주"}
        </span>
      </div>

      {/* 가로 막대 — 위가 고가. 오른쪽(빨강) 순매수 / 왼쪽(파랑) 순매도 */}
      <div className="border border-gray-200 rounded overflow-hidden">
        {[...bins].reverse().map((b, i) => {
          const ratio = Math.abs(b.value) / max;
          const buy = b.value > 0;
          const inHere = curPrice != null && curPrice >= b.lo && curPrice < b.hi;
          return (
            <div key={i}
                 title={`${Math.round(b.lo).toLocaleString()}~${Math.round(b.hi).toLocaleString()}원 · `
                        + `${fmtVol(b.value, won)}${won ? "원" : "주"}`}
                 className={`flex items-center gap-1 px-1 h-5 text-[10px] ${
                   inHere ? "bg-amber-50" : i % 2 ? "bg-gray-50/50" : ""}`}>
              <span className="w-20 shrink-0 tabular-nums text-right text-gray-500">
                {Math.round(b.lo).toLocaleString()}
                {inHere && <span className="ml-0.5 text-amber-600">◀</span>}
              </span>
              {/* 0 을 가운데 두고 좌우로 뻗는다 */}
              <span className="relative flex-1 h-3">
                <span className="absolute inset-y-0 left-1/2 w-px bg-gray-300" />
                {b.value !== 0 && (
                  <span className={`absolute inset-y-0 ${buy ? "left-1/2 bg-rose-400" : "right-1/2 bg-blue-400"}`}
                        style={{ width: `${ratio * 50}%` }} />
                )}
              </span>
              <span className={`w-16 shrink-0 tabular-nums text-right ${signColor(b.value)}`}>
                {b.value === 0 ? "—" : fmtVol(b.value, won)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">
        일별 순매수를 <b>그 날 종가</b>의 가격대에 쌓은 것입니다 — 체결가가 아니라 근사이고,
        순매수(net)라 같은 날의 매수·매도는 상쇄됩니다. 토스 제공 상한이 200일이라 그 이전은 보이지 않습니다.
        {who === "inst_ex_fin" && " 기관계에서 금융투자(증권사 자기매매 — ETF 설정·차익·헤지)를 뺀 값입니다."}
        {curPrice != null && " 현재가가 속한 칸은 노랑으로 표시됩니다."}
      </p>
    </div>
  );
}
