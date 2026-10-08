// 수급별 평균 매수단가 — 외국인·기관(금융투자 제외)·연기금이 이 기간에 평균 얼마에 샀나.
//   차트에 겹쳐 그리지 않고 표로 따로 보여준다(사용자 결정 2026-10-09).
//   계산·한계(일별 순매수 수량 × 그날 종가 근사)는 lib/flowProfile.
import { computeFlowProfile, FLOW_GROUPS, FLOW_GROUP_COLOR } from "../lib/flowProfile";
import type { Investor } from "../types";

function fmtWon(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}
function fmtEok(v: number): string {
  const e = v / 100_000_000;
  const s = Math.abs(e) >= 10 ? Math.round(e).toLocaleString("ko-KR") : e.toFixed(1);
  return `${e > 0 ? "+" : ""}${s}억`;
}

export function FlowCostTable({ investors, curPrice }: { investors: Investor[]; curPrice?: number }) {
  const rows = FLOW_GROUPS.map(g => computeFlowProfile(investors, g, 10)).filter(p => p != null);
  if (rows.length === 0) return null;
  const { from, to, days } = rows[0];
  return (
    <div className="border border-gray-200 rounded p-2 text-[12px]">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-bold text-gray-800">💰 수급별 평균 매수단가</span>
        <span className="text-[11px] text-gray-500">
          최근 {days}거래일{from && to ? ` (${from.slice(2).replace(/-/g, ".")}~${to.slice(5).replace("-", ".")})` : ""}
        </span>
      </div>
      <table className="w-full tabular-nums">
        <thead>
          <tr className="text-[11px] text-gray-500">
            <th className="text-left font-normal py-0.5">투자자</th>
            <th className="text-right font-normal" title="순매수한 날만 모아, 그날 종가를 순매수 수량으로 가중 평균">평균 매수단가</th>
            <th className="text-right font-normal" title="현재가가 평균 매수단가보다 몇 % 위(+)/아래(−)인가 — 그 투자자의 대략적인 평가손익">현재가 대비</th>
            <th className="text-right font-normal" title="날마다 순매수 금액을 가격 구간(10개)에 모아 가장 많이 산 구간">주로 산 가격대</th>
            <th className="text-right font-normal" title="기간 전체 순매수 금액(순매수 수량 × 그날 종가의 합). +면 이 기간 모아갔다">기간 순매수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const vs = p.avgBuy && curPrice ? (curPrice / p.avgBuy - 1) * 100 : null;
            return (
              <tr key={p.group} className="border-t border-gray-100">
                <td className="py-0.5 font-bold" style={{ color: FLOW_GROUP_COLOR[p.group] }}>
                  {p.group}{p.group === "기관" && <span className="ml-0.5 text-[10px] font-normal text-gray-400">(금투 제외)</span>}
                </td>
                <td className="text-right font-bold text-gray-900">{p.avgBuy ? `${fmtWon(p.avgBuy)}원` : "—"}</td>
                <td className={`text-right ${vs == null ? "text-gray-400" : vs > 0 ? "text-rose-600" : vs < 0 ? "text-blue-600" : "text-gray-700"}`}>
                  {vs == null ? "—" : `${vs > 0 ? "+" : ""}${vs.toFixed(1)}%`}
                </td>
                <td className="text-right text-gray-700">
                  {p.topBand ? `${fmtWon(p.topBand.lo)}~${fmtWon(p.topBand.hi)}` : "—"}
                </td>
                <td className={`text-right ${p.netAmount > 0 ? "text-rose-600" : p.netAmount < 0 ? "text-blue-600" : "text-gray-700"}`}>
                  {fmtEok(p.netAmount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-1 text-[10px] text-gray-400 leading-snug">
        토스 일별 순매수 수량 × 그날 종가로 근사(장중 실제 체결가가 아님). 순매수한 날만 평균 — 판 물량은 단가에 안 섞는다.
      </div>
    </div>
  );
}
