// 반도체 프로그램 매매 실시간 — 삼성전자·SK하이닉스 프로그램 누적 순매수(억원) 장중 곡선(사용자 2026-11-03 "순서대로" ②).
//   앱 + 한국투자 연동일 때만 — lib/futuresTape 가 1분마다 기록(한국투자 FHPPG04650101). 네이버 일별 값보다 빠르다.
//   프로그램 = 차익·비차익 묶음 주문(대부분 외국인·기관 기계 주문) — 방향이 지수와 반도체를 끌고 가는 경우가 많다.
import { useEffect, useState } from "react";
import { loadProgTape, PROG_CODES, TAPE_EVENT, type ProgPt } from "../lib/futuresTape";
import { kisFutAvailable } from "../lib/kisFutures";

const COLORS = ["#4f46e5", "#e11d48"];   // 삼성 남색 · 하이닉스 빨강(선 구분용 — 오르내림 색 아님)
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString()}억`;
const tone = (v: number) => v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600";

export function ProgramTapePanel() {
  const [tapes, setTapes] = useState<ProgPt[][]>(() => PROG_CODES.map(([c]) => loadProgTape(c)));
  useEffect(() => {
    const on = () => setTapes(PROG_CODES.map(([c]) => loadProgTape(c)));
    window.addEventListener(TAPE_EVENT, on);
    return () => window.removeEventListener(TAPE_EVENT, on);
  }, []);
  if (!kisFutAvailable()) return null;
  const all = tapes.flat();
  const W = 600, H = 120, P = 4;
  const vmax = Math.max(50, ...all.map(p => Math.abs(p.v)));
  // 가로축 = 정규장(09:00~15:30)을 기본으로, 프리(08:00~)·애프터(~20:00) 점이 있으면 그만큼 넓힌다
  const OPEN = Math.min(9 * 60, ...all.map(p => toMin(p.t))), CLOSE = Math.max(15 * 60 + 30, ...all.map(p => toMin(p.t)));
  const x = (t: string) => P + ((toMin(t) - OPEN) / Math.max(1, CLOSE - OPEN)) * (W - 2 * P);
  const y = (v: number) => H / 2 - (v / vmax) * (H / 2 - P);
  const chg15 = (pts: ProgPt[]) => {
    const last = pts[pts.length - 1];
    if (!last) return null;
    const ago = [...pts].reverse().find(p => toMin(last.t) - toMin(p.t) >= 15);
    return ago ? last.v - ago.v : null;
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-white pg-card p-2 shrink-0">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-bold text-gray-800 text-sm">⚙️ 반도체 프로그램 매매 <span className="text-[11px] font-normal text-emerald-700">● 한투 실시간</span></span>
        <span className="text-[11px] text-gray-500">{tapes[0].length ? `${tapes[0][tapes[0].length - 1].t} 기준 · ` : ""}오늘 누적 순매수(KRX+NXT 통합) · 0선 위 = 순매수 · 1분마다 · 프로그램 = 기관·외국인의 묶음 기계 주문이라 방향이 반도체를 끌고 가는 경우가 많습니다</span>
      </div>
      <div className="mt-1">   {/* 오른쪽 목록은 없애고 값은 선 끝에(사용자 2026-11-04 "그래프로 다 옮기면") */}
        {all.length < 2 ? (
          <div className="text-[11px] text-gray-400 py-6 text-center">프리장(08:00)부터 애프터(20:00)까지 1분마다 쌓입니다 — 앱을 켜 두면 곡선이 이어집니다</div>
        ) : (
          <div className="relative w-full h-[120px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="3 3" />
            {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].filter(h => h * 60 > OPEN && h * 60 < CLOSE).map(h => <line key={h} x1={x(`${h}:00`)} x2={x(`${h}:00`)} y1={0} y2={H} stroke="#e5e7eb" strokeWidth={0.6} />)}
            {tapes.map((pts, i) => pts.length > 1 && (
              <polyline key={i} fill="none" stroke={COLORS[i]} strokeWidth={1.6} vectorEffect="non-scaling-stroke"
                        points={pts.map(p => `${x(p.t)},${y(p.v)}`).join(" ")} />
            ))}
          </svg>
          {/* 선 끝에 종목·값(사용자 2026-11-04 "그래프 끝에 종목이랑 숫자") — svg 가 늘어나 글자가 찌그러지므로 HTML 로 */}
          {tapes.map((pts, i) => {
            const last = pts[pts.length - 1];
            if (!last) return null;
            const lx = (x(last.t) / W) * 100, ly = Math.max(8, Math.min(92, (y(last.v) / H) * 100));
            const other = tapes[1 - i]?.[tapes[1 - i].length - 1];
            // 두 끝이 붙으면 위·아래로 벌린다
            const near = other && Math.abs(y(other.v) - y(last.v)) < 14;
            const dy = near ? (last.v >= other!.v ? -9 : 9) : 0;
            return (
              <div key={i} className="absolute pointer-events-none flex items-center gap-1 whitespace-nowrap"
                   style={{ left: `${Math.min(lx, 72)}%`, top: `calc(${ly}% + ${dy}px)`, transform: lx > 72 ? "translate(-100%, -50%)" : "translate(6px, -50%)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
                <span className="text-[11px] font-bold px-0.5 rounded bg-white/85" style={{ color: COLORS[i] }}>{PROG_CODES[i][1]}</span>
                <span className={`text-[12px] font-black tabular-nums px-0.5 rounded bg-white/85 ${tone(last.v)}`}>{fmt(last.v)}</span>
                {(() => { const c = chg15(pts); return c == null ? null : <span className={`text-[10.5px] tabular-nums px-0.5 rounded bg-white/85 ${tone(c)}`} title="최근 15분 변화">15분 {fmt(c)}</span>; })()}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}
