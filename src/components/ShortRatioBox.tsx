// 일별 공매도 거래 비중 — 막대(최근 60영업일) + 최근 값 vs 20일 평균. 반도체 수급(미국)·(국내) 공용(사용자 2026-11-21 "국내에 삼전·닉스도 공매도 거래 비중")
//   band = '평소보다 높음/낮음' 판정 폭(%p) — 미국(FINRA)은 평소 30~50%라 5, 국내(토스)는 평소 몇 %라 1
//   막 상장(자료 6일 미만)은 평균이 없어 판정하지 않는다
import type { ReactNode } from "react";

// compact = 좁은 오른쪽 열(반도체 수급(미국) 큰 체결 아래, 사용자 2026-11-21) — 두 줄 머리·낮은 막대
export function ShortRatioBox({ days, band, help, title = "공매도 거래 비중", compact }: { days?: { date: string; ratio: number }[]; band: number; help: ReactNode; title?: string; compact?: boolean }) {
  const ds = (days ?? []).filter(d => Number.isFinite(d.ratio)).slice(-60);
  if (!ds.length) return null;
  const r = ds.map(d => d.ratio);
  const last = r[r.length - 1], prev20 = r.slice(-21, -1), avg20 = prev20.reduce((a, v) => a + v, 0) / Math.max(1, prev20.length);
  const few = r.length < 6;
  const diff = few ? 0 : last - avg20;
  const lo = Math.max(0, Math.min(...r) - band * 0.4), hi = Math.max(...r) + band * 0.4, W = 300, H = compact ? 22 : 40;
  const verdict = few ? "" : diff >= band ? "평소보다 공매도 비중이 높음" : diff <= -band ? "평소보다 공매도 비중이 낮음" : "평소 수준";
  const yy = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  if (compact) return (
    <div className="mt-1.5 rounded-md border border-gray-200 bg-white px-1.5 py-1" title={`${ds[ds.length - 1].date} 기준`}>
      <div className="flex items-baseline gap-1 text-[10.5px] whitespace-nowrap">
        <b className="text-gray-700">공매도</b><b className="tabular-nums">{last.toFixed(1)}%</b>
        <span className="text-gray-500 tabular-nums truncate">{few ? `자료 ${r.length}일` : `평균 ${avg20.toFixed(1)}%`}</span>
      </div>
      {verdict && <div className={`text-[10px] font-bold ${diff >= band ? "text-blue-600" : diff <= -band ? "text-rose-600" : "text-gray-500"}`}>{verdict}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-0.5 w-full h-[22px]" preserveAspectRatio="none">
        {r.map((v, i) => <rect key={i} x={(i / r.length) * W} y={yy(v)} width={W / r.length - 0.8} height={H - yy(v)} fill={i === r.length - 1 ? "#6366f1" : "#c7d2fe"} />)}
        {!few && <line x1={0} x2={W} y1={yy(avg20)} y2={yy(avg20)} stroke="#f59e0b" strokeDasharray="3 2" strokeWidth={1} />}
      </svg>
      <details className="text-[10px] text-gray-500"><summary className="cursor-pointer select-none text-indigo-600">이게 뭔가요?</summary><div className="leading-snug mt-0.5">{help}</div></details>
    </div>
  );
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
      <div className="flex items-baseline gap-1.5 text-[11.5px]">
        <b className="text-gray-700">{title}</b>
        <b className="tabular-nums">{last.toFixed(1)}%</b>
        <span className="text-gray-500 tabular-nums">{few ? `(자료 ${r.length}일 — 평균 비교는 쌓인 뒤)` : `(20일 평균 ${avg20.toFixed(1)}%)`}</span>
        <span className={`ml-auto font-bold ${diff >= band ? "text-blue-600" : diff <= -band ? "text-rose-600" : "text-gray-500"}`}>{verdict}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full h-[40px]" preserveAspectRatio="none">
        {r.map((v, i) => <rect key={i} x={(i / r.length) * W} y={yy(v)} width={W / r.length - 0.8} height={H - yy(v)} fill={i === r.length - 1 ? "#6366f1" : "#c7d2fe"} />)}
        {!few && <line x1={0} x2={W} y1={yy(avg20)} y2={yy(avg20)} stroke="#f59e0b" strokeDasharray="3 2" strokeWidth={1} />}
      </svg>
      <details className="text-[10.5px] text-gray-500">
        <summary className="cursor-pointer select-none text-indigo-600">이게 뭔가요? ({ds[ds.length - 1].date} 기준)</summary>
        <div className="leading-snug mt-0.5">{help}</div>
      </details>
    </div>
  );
}
