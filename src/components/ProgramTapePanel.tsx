// 반도체 프로그램 매매 실시간 — 삼성전자·SK하이닉스 프로그램 누적 순매수(억원) 장중 곡선(사용자 2026-11-03 "순서대로" ②).
//   앱 + 한국투자 연동일 때만 — lib/futuresTape 가 1분마다 기록(한국투자 FHPPG04650101). 네이버 일별 값보다 빠르다.
//   프로그램 = 차익·비차익 묶음 주문(대부분 외국인·기관 기계 주문) — 방향이 지수와 반도체를 끌고 가는 경우가 많다.
//   종목마다 따로 그린다(사용자 2026-11-04 "각각 그려도 되고") — 선 = 오늘 누적(총액), 막대 = 1분마다 순매수(빨강 매수·파랑 매도, 축 따로).
import { useEffect, useState } from "react";
import { loadProgTape, PROG_CODES, TAPE_EVENT, type ProgPt } from "../lib/futuresTape";
import { kisFutAvailable } from "../lib/kisFutures";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;
const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString()}억`;
const tone = (v: number) => v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600";

function ProgChart({ name, pts, open, close }: { name: string; pts: ProgPt[]; open: number; close: number }) {
  const W = 600, H = 130, P = 4;
  const last = pts[pts.length - 1];
  const vmax = Math.max(50, ...pts.map(p => Math.abs(p.v)));
  const x = (t: string) => P + ((toMin(t) - open) / Math.max(1, close - open)) * (W - 2 * P);
  const y = (v: number) => H / 2 - (v / vmax) * (H / 2 - P);
  const bars = pts.map((p, k) => (k ? { t: p.t, d: p.v - pts[k - 1].v } : null)).filter((b): b is { t: string; d: number } => !!b && b.d !== 0);
  const bmax = Math.max(1, ...bars.map(b => Math.abs(b.d)));
  const bw = Math.max(0.8, ((W - 2 * P) / Math.max(1, close - open)) * 0.8);
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].filter(h => h * 60 > open && h * 60 < close);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 text-[12px] tabular-nums">
        <span className="font-bold text-gray-800">{name}</span>
        <span className={`font-black text-[14px] ${last ? tone(last.v) : "text-gray-400"}`}>{last ? fmt(last.v) : "—"}</span>
        <span className="text-[10px] text-gray-400">오늘 누적</span>
      </div>
      {pts.length < 2 ? (
        <div className="h-[130px] flex items-center justify-center text-[11px] text-gray-400">1분마다 쌓입니다</div>
      ) : (
        <div className="relative w-full h-[130px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {hours.map(h => <line key={h} x1={x(hhmm(h))} x2={x(hhmm(h))} y1={0} y2={H} stroke="#e5e7eb" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />)}
            {bars.map(({ t, d }) => {
              const h = (Math.abs(d) / bmax) * (H / 2 - P) * 0.9;
              return <rect key={t} x={x(t) - bw / 2} width={bw} y={d > 0 ? H / 2 - h : H / 2} height={Math.max(0.6, h)}
                           fill={d > 0 ? "#f43f5e" : "#3b82f6"} opacity={0.55}><title>{`${t} 1분 ${fmt(d)}`}</title></rect>;
            })}
            <polyline fill="none" stroke="#334155" strokeWidth={1.8} vectorEffect="non-scaling-stroke" points={pts.map(p => `${x(p.t)},${y(p.v)}`).join(" ")} />
          </svg>
          {/* 시각 — svg 가 늘어나 글자가 찌그러지므로 HTML */}
          {hours.filter(h => h % 2 === 1).map(h => (
            <span key={h} className="absolute bottom-0 -translate-x-1/2 text-[9.5px] text-gray-400 pointer-events-none"
                  style={{ left: `${(x(hhmm(h)) / W) * 100}%` }}>{h}시</span>
          ))}
          {/* 선 끝 값 */}
          {last && (() => {
            const lx = (x(last.t) / W) * 100, ly = Math.max(8, Math.min(90, (y(last.v) / H) * 100));
            return (
              <div className="absolute pointer-events-none flex items-center gap-1 whitespace-nowrap"
                   style={{ left: `${Math.min(lx, 82)}%`, top: `${ly}%`, transform: lx > 82 ? "translate(-100%, -50%)" : "translate(6px, -50%)" }}>
                <span className="w-2 h-2 rounded-full bg-slate-700" />
                <span className={`text-[12px] font-black tabular-nums px-0.5 rounded bg-white/85 ${tone(last.v)}`}>{fmt(last.v)}</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export function ProgramTapePanel() {
  const [tapes, setTapes] = useState<ProgPt[][]>(() => PROG_CODES.map(([c]) => loadProgTape(c)));
  useEffect(() => {
    const on = () => setTapes(PROG_CODES.map(([c]) => loadProgTape(c)));
    window.addEventListener(TAPE_EVENT, on);
    return () => window.removeEventListener(TAPE_EVENT, on);
  }, []);
  if (!kisFutAvailable()) return null;
  const all = tapes.flat();
  // 가로축 = 정규장(09:00~15:30) 기본, 프리(08:00~)·애프터(~20:00) 점이 있으면 넓힌다 — 두 그래프 같은 축
  const OPEN = Math.min(9 * 60, ...all.map(p => toMin(p.t))), CLOSE = Math.max(15 * 60 + 30, ...all.map(p => toMin(p.t)));
  return (
    <div className="rounded-lg border border-gray-200 bg-white pg-card p-2 shrink-0">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-bold text-gray-800 text-sm">⚙️ 반도체 프로그램 매매 <span className="text-[11px] font-normal text-emerald-700">● 한투 실시간</span></span>
        <span className="text-[11px] text-gray-500">
          {tapes[0].length ? `${tapes[0][tapes[0].length - 1].t} 기준 · ` : ""}선 = 오늘 누적 순매수(KRX+NXT 통합) · 막대 = 1분마다 순매수(빨강 매수·파랑 매도, 축 따로) ·
          프로그램 = 기관·외국인의 묶음 기계 주문이라 방향이 반도체를 끌고 가는 경우가 많습니다
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
        {PROG_CODES.map(([code, name], i) => <ProgChart key={code} name={name} pts={tapes[i]} open={OPEN} close={CLOSE} />)}
      </div>
    </div>
  );
}
