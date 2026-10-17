// CNN 공포·탐욕 카드의 등급 칩 + 설명 레이어 — PC(UsMarketTab)·모바일(MobileSimpleView) 공용.
//   칩은 늘 보이고(모바일은 호버가 없다), 레이어엔 전일·1주·1개월·1년 전 값과 구성 지표 7개를 띄운다.
//   응답은 api.ts 의 5분 메모를 같이 쓴다 — 카드 시세와 같은 한 번의 호출.
import { useQuery } from "@tanstack/react-query";
import { fetchCnnFearGreed } from "../lib/api";
import { Tooltip } from "./Tooltip";

// CNN 구간 — 0~25 극공포 · 25~45 공포 · 45~55 중립 · 55~75 탐욕 · 75~100 극탐욕
function band(score: number): { label: string; cls: string } {
  if (score < 25) return { label: "극공포", cls: "bg-blue-600 text-white" };
  if (score < 45) return { label: "공포", cls: "bg-blue-100 text-blue-700" };
  if (score <= 55) return { label: "중립", cls: "bg-gray-100 text-gray-700" };
  if (score <= 75) return { label: "탐욕", cls: "bg-rose-100 text-rose-700" };
  return { label: "극탐욕", cls: "bg-rose-600 text-white" };
}

export function CnnFearGreedTag() {
  const { data: fg } = useQuery({
    queryKey: ["cnn-fear-greed"],
    queryFn: fetchCnnFearGreed,
    staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, refetchOnWindowFocus: false,
  });
  if (!fg) return null;
  const b = band(fg.score);
  const past: [string, number | null][] = [["전일", fg.prevClose], ["1주 전", fg.week], ["1개월 전", fg.month], ["1년 전", fg.year]];
  const ms = Date.parse(fg.timestamp);
  const content = (
    <div className="space-y-1.5 w-[300px]">
      <div className="font-bold">
        CNN 공포·탐욕 <span className="tabular-nums">{Math.round(fg.score)}</span>{" "}
        <span className={`px-1 rounded text-[10px] ${b.cls}`}>{b.label}</span>
      </div>
      <table className="text-[11px] w-full">
        <tbody>
          {past.map(([k, v]) => v != null && (
            <tr key={k}>
              <td className="text-gray-500 pr-3">{k}</td>
              <td className="tabular-nums text-right pr-2">{Math.round(v)}</td>
              <td><span className={`px-1 rounded text-[10px] ${band(v).cls}`}>{band(v).label}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {fg.parts.length > 0 && (
        <>
          <div className="text-gray-500 pt-0.5">구성 지표 (각 0~100)</div>
          <table className="text-[11px] w-full">
            <tbody>
              {fg.parts.map(p => (
                <tr key={p.label}>
                  <td className="pr-3">{p.label}</td>
                  <td className="tabular-nums text-right pr-2">{Math.round(p.score)}</td>
                  <td><span className={`px-1 rounded text-[10px] ${band(p.score).cls}`}>{band(p.score).label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="text-gray-500 leading-snug">
        미국 투자심리 합성 점수. 극단은 <b>역발상</b> 신호로 많이 읽는다 — 극공포는 매도가 과해 반등 여지, 극탐욕은 과열.
        {Number.isFinite(ms) && <> · 기준 {new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
      </div>
    </div>
  );
  return (
    <Tooltip content={content} className="shrink-0">
      <span className={`px-1 rounded text-[10px] font-bold leading-tight cursor-help ${b.cls}`}>{b.label}</span>
    </Tooltip>
  );
}
