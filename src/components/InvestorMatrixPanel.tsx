// 투자자별 수급 호버 패널 — 미니 수급 차트(외국인·기관계·연기금) + 투자자별 매수/매도 표.
//   원래 StockCard 안에만 있던 화면이다. 매매동향 탭(InvestorFlowTab)의 종목 행에서도
//   같은 걸 띄우게 되면서 밖으로 뺐다 — 한쪽만 고치면 두 화면이 갈라진다.
//   데이터는 동일하게 fetchInvestorHistorySafe(ticker, [200,120,60]) 의 결과(최신→과거).

import type { Investor } from "../types";

// 호버 툴팁용 미니 수급 차트 — 일별 막대 (중앙 0 대칭) + 누적 라인 오버레이.
// SVG 만 사용 — lightweight-charts 는 hover tooltip 의 mount/unmount 빈도에 부적합.
// 좌측 = 과거, 우측 = 오늘. data 는 시간순(과거→현재) 으로 들어옴.
function compactShares(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : "-";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000)      return `${sign}${(abs / 10_000).toFixed(1)}만`;
  return `${sign}${abs.toLocaleString()}`;
}
function MiniFlowChart({
  label, daily, cumulative,
  barUpColor = "#fecaca", barDnColor = "#bfdbfe",
  lineColor,
  width = 230, height = 100,
}: {
  label: string;
  daily: number[];
  cumulative: number[];
  barUpColor?: string;
  barDnColor?: string;
  lineColor: string;
  width?: number;
  height?: number;
}) {
  if (daily.length < 2) return <div style={{ width, height }} />;
  const padX = 2, padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const cy = padY + innerH / 2;
  // 좌측(일별) ±max — 1 이상으로 보호 (모두 0 일 때 0 division 방지)
  const dMax = Math.max(...daily.map(v => Math.abs(v)), 1);
  // 우측(누적) ±max — 부호 보존 위해 절댓값 최대
  const cMax = Math.max(...cumulative.map(v => Math.abs(v)), 1);
  const dScale = (innerH / 2) / dMax;
  const cScale = (innerH / 2) / cMax;
  const barW = innerW / daily.length;
  const last = cumulative[cumulative.length - 1] ?? 0;
  const lineD = cumulative.map((v, i) => {
    const x = padX + i * barW + barW / 2;
    const y = cy - v * cScale;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return (
    <div className="border border-gray-200 rounded px-1.5 py-1 bg-white">
      <div className="flex items-baseline gap-1.5 text-[10px] mb-0.5">
        <span className="font-bold" style={{ color: lineColor }}>{label}</span>
        <span className="tabular-nums font-bold" style={{ color: lineColor }}>
          {compactShares(last)}주
        </span>
        <span className="text-gray-400 ml-auto text-[9px]">일별 + 누적</span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
           preserveAspectRatio="none" role="img" aria-label={`${label} 수급 추세`}>
        {/* 0 기준선 */}
        <line x1={padX} x2={width - padX} y1={cy} y2={cy}
              stroke="#e5e7eb" strokeWidth="0.5" />
        {/* 일별 막대 */}
        {daily.map((v, i) => {
          const x = padX + i * barW;
          const h = Math.abs(v) * dScale;
          const y = v >= 0 ? cy - h : cy;
          const c = v >= 0 ? barUpColor : barDnColor;
          return <rect key={i} x={x} y={y}
                       width={Math.max(barW - 0.2, 0.3)} height={h}
                       fill={c} />;
        })}
        {/* 누적 라인 */}
        <path d={lineD} fill="none" stroke={lineColor} strokeWidth="1.2"
              strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// 전체 투자자 매트릭스 — 누적(기간) + 일별(최근 1주일)을 한 표로.
// 컬럼: 일자/기간 | 개인 외국인 기관 금융투자 연기금 투신 사모 보험 은행 기타금융 기타법인 | 외인비율(%)
// 누적 행: 외인비율 = today 와 N일 전의 차이 (%p). 일별 행: 그 날의 실제 외국인비율 (%).
// highlightKey 있으면 해당 컬럼을 노랑으로 강조 (어느 행/투자자에서 호버했는지 표시).
export function InvestorMatrixPanel({ history, highlightKey, title }: {
  history: Investor[] | null | undefined;
  highlightKey?: keyof Investor;
  title?: string;
}) {
  if (!history || history.length === 0) return null;
  const periods: { lbl: string; n: number }[] = [
    { lbl: "5일",             n: 5   },
    { lbl: "20일 (1개월)",    n: 20  },
    { lbl: "60일 (3개월)",    n: 60  },
    { lbl: "120일 (6개월)",   n: 120 },
    { lbl: "200일 (~10개월)", n: 200 },
  ];
  const investors: { label: string; key: keyof Investor }[] = [
    { label: "개인",     key: "개인" },
    { label: "외국인",   key: "외국인" },
    { label: "기관",     key: "기관" },
    { label: "금융투자", key: "금융투자" },
    { label: "연기금",   key: "연기금" },
    { label: "투신",     key: "투신" },
    { label: "사모",     key: "사모" },
    { label: "보험",     key: "보험" },
    { label: "은행",     key: "은행" },
    { label: "기타금융", key: "기타금융" },
    { label: "기타법인", key: "기타법인" },
  ];
  // 만 단위 압축 — "+27.2만" / "-1.5만" 식. 만 미만은 그대로.
  const compact = (n: number): string => {
    if (n === 0) return "0";
    const abs = Math.abs(n);
    const sign = n > 0 ? "+" : "-";
    if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
    if (abs >= 10_000)      return `${sign}${(abs / 10_000).toFixed(1)}만`;
    return `${sign}${abs.toLocaleString()}`;
  };
  const today = history[0]?.외국인비율 ?? 0;
  const recentDays = history.slice(0, Math.min(7, history.length));
  const totalCols = investors.length + 2;  // 일자 + 투자자 + 외인비율
  const rateHl = highlightKey === "외국인비율";
  return (
    // 카드 tooltip 은 위 내용에 이어 붙는다(구분선) / 단독 패널(title) 은 제목이 그 역할을 한다.
    <div className={title ? "" : "mt-1.5 pt-1.5 border-t border-gray-200"}>
      {title && (
        <div className="font-bold text-gray-900 mb-1.5 pb-1 border-b border-gray-200">{title}</div>
      )}
      {/* 미니 수급 차트 — 외국인 / 기관 / 연기금 (전체 history 기준, 시간순) */}
      {(() => {
        const chronological = [...history].reverse();
        const foreignDaily = chronological.map(d => d.외국인 ?? 0);
        const instDaily    = chronological.map(d => d.기관 ?? 0);
        const pensionDaily = chronological.map(d => d.연기금 ?? 0);
        const cum = (xs: number[]): number[] => {
          let s = 0; return xs.map(v => (s += v));
        };
        return (
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <MiniFlowChart label="외국인" daily={foreignDaily} cumulative={cum(foreignDaily)}
                           lineColor="#6d28d9" />
            <MiniFlowChart label="기관계" daily={instDaily}    cumulative={cum(instDaily)}
                           lineColor="#047857" />
            <MiniFlowChart label="연기금" daily={pensionDaily} cumulative={cum(pensionDaily)}
                           lineColor="#c2410c" />
          </div>
        );
      })()}
      <div className="font-bold text-gray-900 mb-1">투자자별 매수/매도</div>
      <table className="w-full text-[10px] border border-gray-300 rounded overflow-hidden whitespace-nowrap">
        <thead className="bg-gray-100">
          <tr>
            <th className="border-b border-r border-gray-300 px-1.5 py-0.5 text-left font-medium text-gray-700">
              일자 / 기간
            </th>
            {investors.map(inv => {
              const hl = highlightKey === inv.key;
              return (
                <th key={inv.key as string}
                    className={`border-b border-r border-gray-300 px-1.5 py-0.5 text-right font-medium
                                ${hl ? "bg-amber-100 text-gray-900" : "text-gray-700"}`}>
                  {inv.label}
                </th>
              );
            })}
            <th className={`border-b border-gray-300 px-1.5 py-0.5 text-right font-medium
                            ${rateHl ? "bg-amber-100 text-gray-900" : "text-gray-700"}`}>
              외인비율(%)
            </th>
          </tr>
        </thead>
        <tbody>
          {/* 누적 (기간) — 외인비율은 today - past delta (%p) */}
          {periods.map(p => {
            const slice = history.slice(0, Math.min(p.n, history.length));
            const days = slice.length;
            const idx = Math.min(p.n - 1, history.length - 1);
            const past = history[idx]?.외국인비율 ?? today;
            const delta = today - past;
            const deltaColor = delta > 0 ? "text-rose-600"
                             : delta < 0 ? "text-blue-600"
                             : "text-gray-400";
            return (
              <tr key={p.lbl}>
                <td className="px-1.5 py-0.5 border-b border-r border-gray-300 text-left text-gray-800 whitespace-nowrap">
                  {p.lbl}
                  {days < p.n && (
                    <span className="text-[9px] text-gray-400 ml-0.5">({days})</span>
                  )}
                </td>
                {investors.map(inv => {
                  const sum = slice.reduce((a, d) => a + ((d[inv.key] as number) ?? 0), 0);
                  const color = sum > 0 ? "text-rose-600"
                              : sum < 0 ? "text-blue-600"
                              : "text-gray-400";
                  const hl = highlightKey === inv.key;
                  return (
                    <td key={inv.key as string}
                        className={`px-1.5 py-0.5 border-b border-r border-gray-300 text-right tabular-nums font-medium
                                    ${color}
                                    ${hl ? "bg-amber-50" : ""}`}>
                      {sum === 0 ? "—" : compact(sum)}
                    </td>
                  );
                })}
                <td className={`px-1.5 py-0.5 border-b border-gray-300 text-right tabular-nums font-medium
                                ${deltaColor}
                                ${rateHl ? "bg-amber-50" : ""}`}>
                  {delta === 0 ? "0.00%p" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%p`}
                </td>
              </tr>
            );
          })}
          {/* 일별 상세 구분선 */}
          <tr>
            <td colSpan={totalCols}
                className="px-1.5 py-0.5 border-b border-gray-300 text-left text-gray-600 bg-gray-50">
              ▼ 일별 상세
            </td>
          </tr>
          {/* 일별 — 외인비율은 그 날의 실제 % 값 */}
          {recentDays.map((d, ri) => {
            const last = ri === recentDays.length - 1;
            const rate = d.외국인비율;
            const dayLabel = d.date && d.date.length >= 10
              ? d.date
              : ri === 0 ? "오늘" : ri === 1 ? "어제" : `${ri}일전`;
            return (
              <tr key={d.date ?? ri}>
                <td className={`px-1.5 py-0.5 border-r border-gray-300 text-left text-gray-700 whitespace-nowrap
                                ${!last ? "border-b" : ""}`}>
                  {dayLabel}
                </td>
                {investors.map(inv => {
                  const v = (d[inv.key] as number) ?? 0;
                  const color = v > 0 ? "text-rose-600"
                              : v < 0 ? "text-blue-600"
                              : "text-gray-400";
                  const hl = highlightKey === inv.key;
                  return (
                    <td key={inv.key as string}
                        className={`px-1.5 py-0.5 border-r border-gray-300 text-right tabular-nums
                                    ${color}
                                    ${hl ? "bg-amber-50" : ""}
                                    ${!last ? "border-b" : ""}`}>
                      {v === 0 ? "—" : compact(v)}
                    </td>
                  );
                })}
                <td className={`px-1.5 py-0.5 text-right tabular-nums text-gray-800
                                ${rateHl ? "bg-amber-50" : ""}
                                ${!last ? "border-b border-gray-300" : ""}`}>
                  {rate != null && rate > 0 ? rate.toFixed(2) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
