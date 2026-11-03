// 외국인 K200 선물(근월물) 패널 — 지수(반도체 수급) 탭(사용자 2026-11-03 "아래 그래프 가능?" → 1단계).
//   ① 외국인 누적 순매수 곡선(네이버 시간별, 20분 지연) — 계약 × 선물가 × 25만 원 ÷ 1억 = 억원. 장중 최저(최고)·정리율·15분 변화·현물 동반 판정.
//   ② 시장 전체 미결제약정 장중 곡선 — 무료 출처에 이력이 없어 **이 화면을 켜 둔 동안 1분마다 쌓는다**(localStorage, 날짜 바뀌면 버림).
//      15분마다 미결제 증감 × 가격 방향으로 막대 색: 신규매수(미결제↑·가격↑) · 신규매도(↑·↓) · 숏커버(↓·↑) · 청산매도(↓·↓).
//   2단계(앱+한국투자)에서 외국인 곡선을 실시간·미결제를 장 시작부터로 바꾼다.
import { useEffect, useMemo, useState } from "react";
import type { IntradayFlow, KrFuturesLive } from "../lib/api";
import { TAPE_EVENT, loadFrgnTape, loadOiTape } from "../lib/futuresTape";

const MULT = 250_000;   // 코스피200 선물 1포인트 = 25만 원
const hm2m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const eok = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString()}억`;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// 장중 기록(lib/futuresTape — 앱이 켜진 동안 어느 탭이든 1분마다)을 읽는다
function useTape() {
  const [v, setV] = useState(0);
  useEffect(() => { const h = () => setV(x => x + 1); window.addEventListener(TAPE_EVENT, h); const id = setInterval(h, 60_000); return () => { window.removeEventListener(TAPE_EVENT, h); clearInterval(id); }; }, []);
  return useMemo(() => ({ oi: loadOiTape(), fr: loadFrgnTape() }), [v]);   // eslint-disable-line react-hooks/exhaustive-deps
}

const X0 = 8 * 60 + 45, X1 = 15 * 60 + 45;
function Chart({ series, baseZero, markers, height = 150, color, children }: {
  series: { t: string; v: number }[]; baseZero?: boolean; markers?: { t: string; v: number; label: string; color: string }[];
  height?: number; color: string; children?: (sx: (t: string) => number, sy: (v: number) => number) => React.ReactNode;
}) {
  const W = 600, H = height, PL = 4, PR = 52, PT = 8, PB = 14;
  const vs = series.map(p => p.v).concat(baseZero ? [0] : []);
  const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.08 || 1;
  const sx = (t: string) => PL + ((hm2m(t) - X0) / (X1 - X0)) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - PT - PB);
  const d = series.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      {baseZero && <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={1} />}
      {["09:00", "12:00", "15:30"].map(t => (
        <g key={t}><line x1={sx(t)} x2={sx(t)} y1={PT} y2={H - PB} stroke="#e5e7eb" strokeWidth={1} />
          <text x={sx(t)} y={H - 2} fontSize={9} textAnchor="middle" fill="#9ca3af">{t}</text></g>
      ))}
      {children?.(sx, sy)}
      {series.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={1.8} />}
      {markers?.map(m => (
        <g key={m.label}><circle cx={sx(m.t)} cy={sy(m.v)} r={3.5} fill="white" stroke={m.color} strokeWidth={2} />
          <text x={Math.min(sx(m.t) + 5, W - PR - 2)} y={sy(m.v) + (m.v <= 0 ? 12 : -5)} fontSize={10} fill={m.color} fontWeight={700}>{m.label}</text></g>
      ))}
    </svg>
  );
}

export function ForeignFuturesPanel({ flow, fut, spotFlow, price }: {
  flow?: IntradayFlow; fut?: KrFuturesLive | null; spotFlow?: IntradayFlow; price?: { t: string; v: number }[];
}) {
  const today = kstDate();
  const pxAt = useMemo(() => {
    const m = new Map((price ?? []).map(p => [p.t.slice(0, 5), p.v]));
    return (t: string) => m.get(t) ?? fut?.price ?? 0;
  }, [price, fut?.price]);
  // 외국인 누적(억원) — 오늘 행만
  const tape = useTape();
  // 네이버 시간별(20분 지연) 뒤를 한국투자 실시간 기록으로 잇는다 — 앱+한투 연동일 때만 기록이 있다
  const naver = useMemo(() => (flow?.date === today ? flow.points : [])
    .filter(p => hm2m(p.time) >= X0 && hm2m(p.time) <= X1)
    .map(p => ({ t: p.time, c: p.foreigners, v: (p.foreigners * pxAt(p.time) * MULT) / 1e8, src: "naver" as const })), [flow, today, pxAt]);
  const fs = useMemo(() => {
    const lastT = naver.length ? naver[naver.length - 1].t : "00:00";
    const kis = tape.fr.filter(p => p.t > lastT).map(p => ({ t: p.t, c: p.c, v: (p.c * pxAt(p.t) * MULT) / 1e8, src: "kis" as const }));
    // 네이버가 하나도 없으면(장 초반) 한투 기록만으로
    return [...naver, ...kis];
  }, [naver, tape.fr, pxAt]);
  const live = fs.length > 0 && fs[fs.length - 1].src === "kis";
  const oi = tape.oi;
  const last = fs[fs.length - 1];
  // 장중 극값 — 지금이 음수면 최저, 양수면 최고(되돌린 비율 = 정리율)
  const ext = useMemo(() => {
    if (!last) return null;
    const pick = last.v < 0 ? fs.reduce((a, p) => (p.v < a.v ? p : a), fs[0]) : fs.reduce((a, p) => (p.v > a.v ? p : a), fs[0]);
    return pick;
  }, [fs, last]);
  const recov = ext && last && ext.v !== 0 ? (1 - last.v / ext.v) * 100 : null;
  const ago15 = last ? [...fs].reverse().find(p => hm2m(p.t) <= hm2m(last.t) - 15) : undefined;
  const d15 = last && ago15 ? last.v - ago15.v : null;
  const d15c = last && ago15 ? last.c - ago15.c : null;
  const spot = spotFlow?.date === today ? spotFlow.points[spotFlow.points.length - 1]?.foreigners : undefined;
  const together = last && spot != null ? (last.v < 0 && spot < 0 ? "동반매도" : last.v > 0 && spot > 0 ? "동반매수" : "엇갈림") : null;

  // 미결제 15분 막대 — 미결제 증감 × 가격 방향
  const bars = useMemo(() => {
    const out: { t: string; d: number; kind: "newBuy" | "newSell" | "cover" | "liq" | "flat" }[] = [];
    for (let s = X0; s < X1; s += 15) {
      const inB = oi.filter(p => hm2m(p.t) >= s && hm2m(p.t) < s + 15);
      if (inB.length < 2) continue;
      const a = inB[0], b = inB[inB.length - 1], d = b.oi - a.oi, dp = b.p - a.p;
      const kind = Math.abs(d) < 50 ? "flat" : d > 0 ? (dp >= 0 ? "newBuy" : "newSell") : (dp >= 0 ? "cover" : "liq");
      out.push({ t: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`, d, kind });
    }
    return out;
  }, [oi]);
  const BAR: Record<string, { c: string; l: string }> = {
    newBuy: { c: "#f43f5e", l: "신규매수" }, newSell: { c: "#3b82f6", l: "신규매도" }, cover: { c: "#fda4af", l: "숏커버" }, liq: { c: "#93c5fd", l: "청산매도" }, flat: { c: "#d1d5db", l: "중립" },
  };

  return (
    <div className="pg-card rounded-lg border border-gray-200 bg-white p-2 grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-gray-800">🌐 외국인 K200 선물</span>
          <span className="text-[11px] text-gray-400">근월물 {fut?.month ?? ""} · {live ? <b className="text-emerald-600">● 한투 실시간(1분)</b> : "네이버 20분 지연"} · 계약×선물가×25만</span>
        </div>
        {!last ? <div className="text-gray-400 text-[12px] py-6 text-center">오늘 수급이 아직 없습니다(장 전·휴장).</div> : (<>
          <div className="mt-1 grid grid-cols-4 gap-1.5 text-center">
            <div className="rounded border border-gray-200 py-1"><div className="text-[10.5px] text-gray-500">외국인 누적</div>
              <div className={`font-bold tabular-nums ${tone(last.v)}`}>{eok(last.v)}</div><div className="text-[10px] text-gray-400 tabular-nums">{last.c > 0 ? "+" : ""}{last.c.toLocaleString()}계약 · {last.t}</div></div>
            <div className="rounded border border-gray-200 py-1" title="장중 가장 많이 판(산) 지점에서 얼마나 되돌렸나 — 100% 면 0 까지 되사(되판) 것">
              <div className="text-[10.5px] text-gray-500">정리율</div>
              <div className="font-bold tabular-nums text-gray-800">{recov != null ? `${Math.round(recov)}%` : "—"}</div><div className="text-[10px] text-gray-400">{ext ? `장중 ${ext.v < 0 ? "최저" : "최고"} 대비` : ""}</div></div>
            <div className="rounded border border-gray-200 py-1"><div className="text-[10.5px] text-gray-500">15분 변화</div>
              <div className={`font-bold tabular-nums ${tone(d15 ?? 0)}`}>{d15 != null ? eok(d15) : "—"}</div><div className="text-[10px] text-gray-400 tabular-nums">{d15c != null ? `${d15c > 0 ? "+" : ""}${d15c.toLocaleString()}계약` : ""}</div></div>
            <div className="rounded border border-gray-200 py-1"><div className="text-[10.5px] text-gray-500">장중 {ext && ext.v < 0 ? "최저" : "최고"}</div>
              <div className={`font-bold tabular-nums ${tone(ext?.v ?? 0)}`}>{ext ? eok(ext.v) : "—"}</div><div className="text-[10px] text-gray-400">{ext?.t ?? ""}</div></div>
          </div>
          {spot != null && (
            <div className="mt-1 text-[11px] text-gray-600">현물(코스피) 외국인 <b className={tone(spot)}>{eok(spot)}</b>
              {together && <span className={`ml-1.5 px-1 rounded border text-[10px] font-bold ${together === "동반매도" ? "border-blue-300 bg-blue-50 text-blue-700" : together === "동반매수" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-gray-300 bg-gray-50 text-gray-600"}`}>{together}</span>}
            </div>
          )}
          <Chart series={fs.map(p => ({ t: p.t, v: p.v }))} baseZero color="#1e3a8a"
                 markers={ext ? [{ t: ext.t, v: ext.v, label: `${ext.v < 0 ? "최저" : "최고"} ${ext.t}`, color: "#2563eb" }] : []}>
            {(sx, sy) => ext && ext.v !== 0 ? (<>
              {/* 정리율 기준선 — 최저(최고)에서 20%·50% 되돌린 자리 */}
              {[0.5, 0.2].map(r => <g key={r}><line x1={sx(ext.t)} x2={600 - 52} y1={sy(ext.v * (1 - r))} y2={sy(ext.v * (1 - r))} stroke="#f43f5e" strokeDasharray="2 3" strokeWidth={1} />
                <text x={600 - 50} y={sy(ext.v * (1 - r)) + 3} fontSize={9} fill="#f43f5e">{r * 100}%</text></g>)}
            </>) : null}
          </Chart>
        </>)}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-gray-800">📊 시장 미결제약정</span>
          <span className="text-[11px] text-gray-400">근월물 전체(외국인만 아님) · 앱이 켜진 동안 1분마다 기록</span>
          {fut && fut.oi > 0 && <span className="ml-auto font-bold tabular-nums text-gray-800">{fut.oi.toLocaleString()} <span className={`text-[11px] ${tone(fut.oiChg)}`}>({fut.oiChg > 0 ? "+" : ""}{fut.oiChg.toLocaleString()})</span></span>}
        </div>
        {oi.length < 2 ? <div className="text-gray-400 text-[12px] py-6 text-center">기록 중… (주간 선물장 08:45~15:45, 앱을 켜 둔 시간부터 — 아침에 켜 두면 장 시작부터 채워집니다)</div> : (<>
          <Chart series={oi.map(p => ({ t: p.t, v: p.oi }))} color="#7c3aed" height={120} />
          <Chart series={oi.map(p => ({ t: p.t, v: p.p }))} color="#9ca3af" height={60} />
          <svg viewBox="0 0 600 40" className="w-full" style={{ height: 40 }} preserveAspectRatio="none">
            {(() => {
              const mx = Math.max(1, ...bars.map(b => Math.abs(b.d)));
              const sx = (t: string) => 4 + ((hm2m(t) - X0) / (X1 - X0)) * (600 - 56);
              return bars.map(b => { const h = (Math.abs(b.d) / mx) * 18; return (
                <rect key={b.t} x={sx(b.t)} width={Math.max(2, (15 / (X1 - X0)) * 544 - 2)} y={b.d >= 0 ? 20 - h : 20} height={Math.max(1, h)} fill={BAR[b.kind].c}>
                  <title>{`${b.t}~ 미결제 ${b.d > 0 ? "+" : ""}${b.d.toLocaleString()} · ${BAR[b.kind].l}`}</title>
                </rect>); });
            })()}
            <line x1={4} x2={548} y1={20} y2={20} stroke="#e5e7eb" />
          </svg>
          <div className="flex flex-wrap gap-x-2 text-[10px] text-gray-500">
            <span><b className="text-violet-700">—</b> 미결제</span><span><b className="text-gray-400">—</b> 선물가</span>
            {Object.values(BAR).map(b => <span key={b.l}><span className="inline-block w-2 h-2 rounded-sm mr-0.5 align-middle" style={{ background: b.c }} />{b.l}</span>)}
            {fut?.basis != null && <span className="ml-auto">베이시스 <b>{fut.basis.toFixed(2)}</b></span>}
          </div>
        </>)}
      </div>
    </div>
  );
}
