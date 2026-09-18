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

import { useCallback, useEffect, useMemo, useState } from "react";
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
  // ★ 구간은 **달력이 단일 진실**이다. 기간 버튼은 그 구간을 채워 넣는 단축키일 뿐이라,
  //   60일을 누르면 달력에 60거래일 전~마지막 거래일이 그대로 뜬다(무엇을 보고 있는지 보인다).
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const withPrice = useMemo(
    () => history.filter(d => (d.종가 ?? 0) > 0 && !!d.date),
    [history],
  );
  // 데이터가 있는 범위 — 달력의 min/max (없는 날짜를 고르면 빈 화면이 된다).
  const bound = useMemo(() => {
    const ds = withPrice.map(d => d.date as string).sort();
    return { min: ds[0] ?? "", max: ds[ds.length - 1] ?? "" };
  }, [withPrice]);

  // 최근 n거래일이 실제로 어느 날짜~어느 날짜인가. 달력에 넣을 값이다.
  const rangeOfPeriod = useCallback((n: number) => {
    const ds = withPrice.slice(0, n).map(d => d.date as string).sort();
    return ds.length ? { from: ds[0], to: ds[ds.length - 1] } : null;
  }, [withPrice]);

  // 첫 렌더 — 기본 기간(120일)을 달력에 채운다. 빈 칸으로 두면 뭘 보는 중인지 알 수 없다.
  useEffect(() => {
    if (from || to) return;
    const r = rangeOfPeriod(days);
    if (r) { setFrom(r.from); setTo(r.to); }
  }, [rangeOfPeriod, days, from, to]);

  // 지금 구간이 어느 버튼과 정확히 같은가 — 그 버튼만 켠다(손으로 고치면 아무것도 안 켜진다).
  const activePeriod = PERIODS.find(p => {
    const r = rangeOfPeriod(p);
    return !!r && r.from === from && r.to === to;
  });

  const rows = useMemo(() => {
    if (!from && !to) return withPrice.slice(0, days);
    return withPrice.filter(d => {
      const t = d.date as string;
      return (!from || t >= from) && (!to || t <= to);
    });
  }, [withPrice, days, from, to]);

  // 구간을 직접 고르면 그 안의 전부를 쓴다(days 로 다시 자르지 않는다).
  const model = useMemo(
    () => buildPriceProfile(rows, who, rows.length || 1, won),
    [rows, who, won],
  );

  const whoMeta = WHO.find(w => w.key === who);

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
          <button key={p}
                  onClick={() => {
                    setDays(p);
                    const r = rangeOfPeriod(p);
                    if (r) { setFrom(r.from); setTo(r.to); }
                  }}
                  title={`최근 ${p}거래일 — 누르면 달력에 그 구간이 채워진다`}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold border transition ${
                    activePeriod === p ? "bg-indigo-600 text-white border-indigo-600"
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

      {/* 구간 직접 지정 — 버튼(60/120/200일)과 같이 쓴다. 날짜를 넣으면 그쪽이 이긴다. */}
      <div className="flex items-center gap-1 flex-wrap mb-1.5 text-[11px]">
        <input type="date" value={from} min={bound.min} max={to || bound.max}
               onChange={e => setFrom(e.target.value)}
               className={`px-1 py-0.5 rounded border text-[11px] tabular-nums ${
                 activePeriod ? "border-gray-300 text-gray-700" : "border-indigo-400 text-gray-800"}`} />
        <span className="text-gray-400">~</span>
        <input type="date" value={to} min={from || bound.min} max={bound.max}
               onChange={e => setTo(e.target.value)}
               className={`px-1 py-0.5 rounded border text-[11px] tabular-nums ${
                 activePeriod ? "border-gray-300 text-gray-700" : "border-indigo-400 text-gray-800"}`} />
        <span className="text-gray-400">
          {activePeriod ? `최근 ${activePeriod}거래일` : "직접 지정한 구간"}
        </span>
      </div>

      {model ? (() => {
        const { bins, max, days: used, avgBuy, avgSell, net } = model;
        // 산 값이 판 값보다 비싸면 '비싸게 사서 싸게 판' 것이다 — 이 화면이 답하려는 질문.
        const gap = avgBuy != null && avgSell != null ? avgBuy - avgSell : null;
        return (<>
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
        </>);
      })() : (
        <div className="py-6 text-center text-[11px] text-gray-400 border border-gray-200 rounded">
          이 구간에 쓸 수 있는 데이터가 5일 미만입니다
          <span className="block mt-0.5">날짜를 넓히거나 위 기간 버튼을 눌러 보세요</span>
        </div>
      )}

      <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">
        일별 순매수를 <b>그 날 종가</b>의 가격대에 쌓은 것입니다 — 체결가가 아니라 근사이고,
        순매수(net)라 같은 날의 매수·매도는 상쇄됩니다. 토스 제공 상한이 200일이라 그 이전은 보이지 않습니다.
        {who === "inst_ex_fin" && " 기관계에서 금융투자(증권사 자기매매 — ETF 설정·차익·헤지)를 뺀 값입니다."}
        {curPrice != null && " 현재가가 속한 칸은 노랑으로 표시됩니다."}
      </p>
    </div>
  );
}
