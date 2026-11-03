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
      {/* 숫자는 모두 CNN 실제 점수 — 괄호 안 글은 '무엇으로 재나' 설명(사용자 2026-11-03 "현재 값이야? 설명이야?") */}
      <div className="text-gray-500 pt-0.5">총점 추이 (지금 {Math.round(fg.score)}점과 비교)</div>
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
          <div className="text-gray-500 pt-0.5">구성 지표 7개 — <b>지금 점수</b> (0 극공포 ~ 100 극탐욕 · 괄호는 재는 방법)</div>
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

// 공포·탐욕 카드 오른쪽 빈 칸 — 구성 지표 7개를 레이어와 같은 내용 그대로(이름(재는 방법)·점수·등급).
//   사용자 2026-11-03 "오른쪽 빈곳에", "내용 다 표시하자", "옆으로 길어져야지", "세로는 그대로", "카드 2개로 나눠 넣자".
//   PC(split): 카드 높이 그대로 상자 둘(4개 + 3개)을 옆으로 / 모바일: 카드 아래 한 상자에 한 열(폭이 좁아 이름을 자르지 않게).
export function CnnFgPanel({ small, split, className = "" }: { small?: boolean; split?: boolean; className?: string }) {
  const { data: fg } = useQuery({
    queryKey: ["cnn-fear-greed"], queryFn: fetchCnnFearGreed,
    staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, refetchOnWindowFocus: false,
  });
  if (!fg?.parts.length) return null;
  const fs = small ? "text-[10px]" : "text-[11px]";
  // 바탕 = 공포·탐욕 카드와 같은 색(전일 대비 점수가 오르면 빨강, 내리면 파랑 — 지수 카드 규칙, 사용자 2026-11-04)
  const d = fg.prevClose != null ? fg.score - fg.prevClose : 0;
  const tone = d > 0 ? "bg-rose-50 border-rose-200" : d < 0 ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200";
  // 한 항목 = 첫 줄 이름·점수·등급, 둘째 줄 재는 방법(작게) — 카드 한 장 폭에 다 들어가게(사용자 2026-11-03 "넓이 다른 카드와 동일하게")
  const box = (parts: typeof fg.parts, head: React.ReactNode, key: string) => (
    <div key={key} className={`min-w-0 rounded-lg border ${tone} pg-card px-1.5 py-1`}>
      {head && <div className={`${small ? "text-[9.5px]" : "text-[10px]"} font-bold text-gray-600 mb-[1px] truncate`}>{head}</div>}
      <div className="space-y-[2px]">
        {parts.map(p => {
          const b = band(p.score);
          const m = p.label.match(/^(.*?)\((.*)\)$/);
          const name = m ? m[1] : p.label, how = m?.[2];
          return (
            <div key={p.label} className="min-w-0 leading-[1.15]" title={p.label}>
              <div className={`flex items-center gap-1 ${fs}`}>
                <span className="truncate flex-1 font-semibold text-gray-800">{name}</span>
                {/* 점수·등급 칸 폭 고정 — 세로줄이 맞게(사용자 2026-11-03) */}
                <span className="shrink-0 w-5 text-right tabular-nums font-bold text-gray-800">{Math.round(p.score)}</span>
                <span className={`shrink-0 w-[30px] text-center rounded text-[9px] font-bold leading-tight ${b.cls}`}>{b.label}</span>
              </div>
              {how && <div className={`truncate ${small ? "text-[8.5px]" : "text-[9px]"} text-gray-500`}>{how}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
  const head = null;   // 제목 줄은 뺐다(사용자 2026-11-03 "설명 삭제") — 마우스를 올리면 전체 이름
  if (!split) return <div className={className}>{box(fg.parts, head, "all")}</div>;
  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {box(fg.parts.slice(0, 4), head, "a")}
      {box(fg.parts.slice(4), null, "b")}
    </div>
  );
}
