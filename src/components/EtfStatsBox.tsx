// ETF 카드 공통 지표 박스 — 거래량 + 기간 수익률(1주일·1·3·6개월·1년), 값이 있으면 총보수.
//
// ETF 검색 · ETF 랭킹 · ETF 역검색 팝업 · ETF 구성 팝업이 **이 한 벌만** 쓴다.
//   화면마다 따로 들면 반드시 엇갈린다(어디는 3개월까지, 어디는 6개월까지 같은 식).
//
// 기간 수익률은 크롤러가 하루 1회 계산해 둔 파일에서 읽는다 → 카드가 몇 장이든 추가 호출 0.
//   (종목별로 과거 일봉을 부르면 카드 1장에 1콜, 랭킹 50장이면 50콜이다)
//   ★ 크롤 시점(매일 06:00 KST) 기준이라 오늘 장중 움직임은 안 들어 있다.

import { formatVolume, signColor } from "../lib/format";
import { useEtfReturns, type ReturnPeriod } from "../lib/etfReturns";

const ROWS: [ReturnPeriod, string][] = [
  ["w1", "1주일"], ["m1", "1개월"], ["m3", "3개월"], ["m6", "6개월"], ["y1", "1년"],
];

interface Props {
  code: string;                    // 한국 ETF 6자리 코드
  volume?: number;                 // 오늘 거래량(주)
  fee?: number | null;             // 총보수(%) — 이미 받아 둔 곳만 넘긴다(종목당 2콜이라 목록에선 생략)
  highlight?: ReturnPeriod;        // 정렬/기간 기준 — 그 줄만 흰 박스로 띄운다
  className?: string;
}

export function EtfStatsBox({ code, volume, fee, highlight, className }: Props) {
  const data = useEtfReturns(true);
  const rets = data?.returns[code] ?? null;
  const rows = ROWS.filter(([k]) => rets?.[k] != null);
  if (fee == null && volume == null && rows.length === 0) return null;
  return (
    <div title={`기간 수익률은 매일 06:00 갱신${data?.version ? ` (${data.version} 기준)` : ""} — 오늘 장중 움직임은 빠져 있습니다`}
         className={`rounded-md border border-gray-200 bg-white/85 backdrop-blur-[1px]
                     px-1.5 py-1 flex flex-col justify-center
                     text-[10px] tabular-nums whitespace-nowrap ${className ?? ""}`}>
      {fee != null && (
        <div className="flex items-baseline justify-between gap-2 leading-tight">
          <span className="text-gray-500">총보수</span>
          <span className="text-blue-600 font-bold">{fee}%</span>
        </div>
      )}
      {volume != null && (
        <div className="flex items-baseline justify-between gap-2 leading-tight">
          <span className="text-gray-500">거래량</span>
          <span className="text-gray-700 font-medium">{formatVolume(volume)}</span>
        </div>
      )}
      {rows.map(([k, label]) => {
        const v = rets![k]!;
        const on = highlight === k;
        return (
          <div key={k}
               className={`flex items-baseline justify-between gap-2 leading-tight
                           ${on ? "bg-white border border-gray-300 rounded px-1 -mx-1 shadow-sm"
                                : k === "w1" ? "bg-yellow-100/70 rounded px-1 -mx-1" : ""}`}>
            <span className="text-gray-500">{label}</span>
            <span className={`font-medium ${signColor(v)}`}>
              {v >= 0 ? "+" : ""}{v.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
