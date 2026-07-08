import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketInvestor, type MarketInvestor, type InvestorNet } from "../lib/api";

// 실시간 지수·투자자 미니 차트 — 네이버 금융 sise 메인 PNG(siseMain{시장}.png) 임베드.
//   한국 시장 그룹 안(VKOSPI 아래)에 코스피/코스닥/코스피200 3개를 작게 나란히. 이미지라 프록시 불필요.
//   sid(캐시버스터) 주기 갱신으로 장중 실시간 반영. 투자자 순매수는 sise 페이지 파싱.

const NAVER_URL = "https://finance.naver.com/sise/";
const CHARTS: { key: string; label: string; investor: "KOSPI" | "KOSDAQ" }[] = [
  { key: "KOSPI", label: "코스피", investor: "KOSPI" },
  { key: "KOSDAQ", label: "코스닥", investor: "KOSDAQ" },
  { key: "KPI200", label: "코스피200", investor: "KOSPI" },   // 코스피200 은 코스피 수급 기준
];
const imgUrl = (market: string, sid: number) =>
  `https://ssl.pstatic.net/imgfinance/chart/sise/siseMain${market}.png?sid=${sid}`;

const netColor = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-400");
const fmtNet = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString()}`;

function InvestorLine({ net }: { net: InvestorNet }) {
  const items: [string, number][] = [["개인", net.indiv], ["외국인", net.foreign], ["기관", net.inst]];
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0 text-sm tabular-nums leading-tight">
      {items.map(([label, v]) => (
        <span key={label}><span className="text-gray-400">{label}</span> <span className={`font-bold ${netColor(v)}`}>{fmtNet(v)}</span></span>
      ))}
    </div>
  );
}

export function MarketChartCard() {
  const [sid, setSid] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setSid(Date.now()), 60 * 1000);   // 60초마다 새 이미지
    return () => clearInterval(t);
  }, []);

  const { data: investor } = useQuery<MarketInvestor | null>({
    queryKey: ["marketInvestor"],
    queryFn: fetchMarketInvestor,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 한국 시장 심볼 그리드 아래에 코스피/코스닥/코스피200 3개를 한 줄로.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {CHARTS.map(c => {
        const net = investor?.[c.investor];
        return (
          <a key={c.key} href={NAVER_URL} target="_blank" rel="noopener noreferrer"
             className="block rounded-lg border border-gray-200 bg-white p-1 min-w-0 hover:border-gray-300 self-start">
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[10px] font-bold text-gray-600">{c.label}</span>
              <span className="text-[9px] text-gray-400">↗</span>
            </div>
            {net && <InvestorLine net={net} />}
            <img src={imgUrl(c.key, sid)} alt={`${c.label} 실시간 차트`} loading="lazy"
                 className="block w-full h-auto mt-0.5" />
          </a>
        );
      })}
    </div>
  );
}
