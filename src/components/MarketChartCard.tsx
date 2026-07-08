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

const fmtNet = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString()}`;

// 시장명(녹색=코스피 지수 색) + 투자자 순매수(네이버 차트 라인 색: 개인=보라/외국인=주황/기관=파랑) 한 줄
function InfoLine({ label, net }: { label: string; net?: InvestorNet }) {
  const items = net ? [
    { label: "개인", v: net.indiv, color: "text-purple-600" },
    { label: "외국인", v: net.foreign, color: "text-orange-500" },
    { label: "기관", v: net.inst, color: "text-blue-500" },
  ] : [];
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0 text-sm tabular-nums leading-tight">
      <span className="font-bold text-green-600">{label}</span>
      {items.map(it => (
        <span key={it.label} className={it.color}>{it.label} <span className="font-bold">{fmtNet(it.v)}</span></span>
      ))}
      <span className="text-[9px] text-gray-400">↗</span>
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
            <InfoLine label={c.label} net={net} />
            <img src={imgUrl(c.key, sid)} alt={`${c.label} 실시간 차트`} loading="lazy"
                 className="block w-full h-auto mt-0.5" />
          </a>
        );
      })}
    </div>
  );
}
