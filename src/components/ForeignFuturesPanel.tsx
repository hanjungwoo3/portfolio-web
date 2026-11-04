// 외국인 K200 선물(근월물) 패널 — 지수(반도체 수급) 탭(사용자 2026-11-03 "아래 그래프 가능?" → 1단계).
//   ① 외국인 누적 순매수 곡선(네이버 시간별, 20분 지연) — 계약 × 선물가 × 25만 원 ÷ 1억 = 억원. 장중 최저(최고)·정리율·15분 변화·현물 동반 판정.
//   ② 시장 전체 미결제약정 장중 곡선 — 무료 출처에 이력이 없어 **이 화면을 켜 둔 동안 1분마다 쌓는다**(localStorage, 날짜 바뀌면 버림).
//      15분마다 미결제 증감 × 가격 방향으로 막대 색: 신규매수(미결제↑·가격↑) · 신규매도(↑·↓) · 숏커버(↓·↑) · 청산매도(↓·↓).
//   2단계(앱+한국투자)에서 외국인 곡선을 실시간·미결제를 장 시작부터로 바꾼다.
import { useEffect, useMemo, useState } from "react";
import type { IntradayFlow, KrFuturesLive } from "../lib/api";
import { TAPE_EVENT, loadFrgnTape, loadOiTape } from "../lib/futuresTape";
import { readFutures } from "../lib/futuresRead";

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
function Chart({ series, baseZero, markers, height = 150, width = 600, color, children }: {
  series: { t: string; v: number }[]; baseZero?: boolean; markers?: { t: string; v: number; label: string; color: string }[];
  height?: number; width?: number; color: string; children?: (sx: (t: string) => number, sy: (v: number) => number) => React.ReactNode;
}) {
  const W = width, H = height, PL = 4, PR = 52, PT = 8, PB = 14;
  const vs = series.map(p => p.v).concat(baseZero ? [0] : []);
  const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.08 || 1;
  const sx = (t: string) => PL + ((hm2m(t) - X0) / (X1 - X0)) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - PT - PB);
  const d = series.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      {baseZero && <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={1} />}
      {baseZero && <text x={PL + 2} y={sy(0) - 3} fontSize={9} fill="#9ca3af">외국인 0</text>}
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

export function ForeignFuturesPanel({ flow, fut, spotFlow, price, kospi, kospiBase }: {
  flow?: IntradayFlow; fut?: KrFuturesLive | null; spotFlow?: IntradayFlow; price?: { t: string; v: number }[];
  kospi?: { t: string; v: number }[]; kospiBase?: number;   // 배경 코스피(1분) · 전일 종가 — 위 빨강·아래 파랑 면(현물 칸과 같은 모양, 사용자 2026-11-04)
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

  // 그래프 읽기(오른쪽 칸) — 최근 30분 미결제·선물가 변화로 성격을 본다
  const read = useMemo(() => {
    if (!last && oi.length < 2) return null;
    const lo = oi[oi.length - 1];
    const base = lo ? [...oi].reverse().find(p => hm2m(lo.t) - hm2m(p.t) >= 30) ?? oi[0] : undefined;
    return readFutures({
      cum: last?.v ?? 0, ext: ext ? { v: ext.v, t: ext.t } : null, recov, d15,
      oi: lo && base && lo !== base ? { doi: lo.oi - base.oi, dp: lo.p - base.p, min: hm2m(lo.t) - hm2m(base.t) } : null,
      spot: spot ?? null,
    });
  }, [last, oi, ext, recov, d15, spot]);
  const RT: Record<string, string> = { up: "text-rose-600", down: "text-blue-600", flat: "text-gray-600", warn: "text-amber-700" };

  // 한 패널·한 그래프(사용자 2026-11-04 "외국인 선물 그래프까지 포함해 패널 전체를 하나로") —
  //   남색 = 외국인 누적(억원, 0선), 보라 = 시장 미결제(근월물 전체, 축 따로), 회색 = 선물가(축 따로), 아래 막대 = 15분 미결제 변화 성격
  // 장중 최저·최고가 방금(끝 10분 안)이면 표시를 따로 달지 않고 선 끝 '외국인' 글자에 붙인다 — 끝 글자들과 겹쳤다(사용자 2026-11-04)
  const extAtEnd = !!(ext && last && hm2m(last.t) - hm2m(ext.t) <= 10);
  const H = 240, CW = 1200;   // 그래프 내부 폭 — 패널 전체 폭이라 600 이면 글자가 가로로 늘어났다(viewBox 비율)
  // 배경 코스피 면 — 전일 종가 위 빨강·아래 파랑(축 따로, 위아래 10% 여백). 최고·최저 ▼▲ 와 오른쪽 현재값
  const kospiLayer = (sx: (t: string) => number) => {
    const ks = (kospi ?? []).filter(p => hm2m(p.t) >= X0 && hm2m(p.t) <= X1 && p.v > 0);
    if (ks.length < 2) return null;
    const vals = [...ks.map(p => p.v), ...(kospiBase && kospiBase > 0 ? [kospiBase] : [])];
    const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1, PY = H * 0.1;
    const ky = (v: number) => PY + (1 - (v - lo) / r) * (H - 14 - PY * 2);
    const baseY = ky(kospiBase && kospiBase > 0 ? kospiBase : ks[0].v);
    const line = ks.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${ky(p.v).toFixed(1)}`).join(" ");
    const band = `${line} L${sx(ks[ks.length - 1].t).toFixed(1)},${baseY.toFixed(1)} L${sx(ks[0].t).toFixed(1)},${baseY.toFixed(1)} Z`;
    const hiP = ks.reduce((a, p) => (p.v > a.v ? p : a)), loP = ks.reduce((a, p) => (p.v < a.v ? p : a)), lastK = ks[ks.length - 1];
    return (<>
      <defs>
        <clipPath id="ffp-ku"><rect x={0} y={0} width={CW} height={baseY} /></clipPath>
        <clipPath id="ffp-kd"><rect x={0} y={baseY} width={CW} height={Math.max(0, H - baseY)} /></clipPath>
      </defs>
      <g clipPath="url(#ffp-ku)"><path d={band} fill="#fecdd3" fillOpacity={0.45} /><path d={line} fill="none" stroke="#fb7185" strokeOpacity={0.55} strokeWidth={1} /></g>
      <g clipPath="url(#ffp-kd)"><path d={band} fill="#bfdbfe" fillOpacity={0.45} /><path d={line} fill="none" stroke="#60a5fa" strokeOpacity={0.55} strokeWidth={1} /></g>
      {kospiBase && kospiBase > 0 && <line x1={4} x2={CW - 52} y1={baseY} y2={baseY} stroke="#9ca3af" strokeOpacity={0.5} strokeDasharray="2 3" />}
      <text x={sx(hiP.t)} y={ky(hiP.v) - 3} fontSize={9} textAnchor="middle" fill="#e11d48">▼</text>
      <text x={Math.max(40, Math.min(CW - 120, sx(hiP.t)))} y={ky(hiP.v) - 12} fontSize={9.5} textAnchor="middle" fill="#e11d48">코스피 최고 {hiP.v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</text>
      <text x={sx(loP.t)} y={ky(loP.v) + 10} fontSize={9} textAnchor="middle" fill="#2563eb">▲</text>
      <text x={Math.max(40, Math.min(CW - 120, sx(loP.t)))} y={ky(loP.v) + 20} fontSize={9.5} textAnchor="middle" fill="#2563eb">코스피 최저 {loP.v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</text>
      <g><rect x={CW - 50} y={ky(lastK.v) - 7} width={46} height={14} rx={2} fill="#374151" /><text x={CW - 27} y={ky(lastK.v) + 3.5} fontSize={9.5} textAnchor="middle" fill="white">{Math.round(lastK.v).toLocaleString()}</text></g>
    </>);
  };
  const oiLayer = (sx: (t: string) => number) => {
    const scale = (vals: number[]) => { const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || 0.5; return (v: number) => 8 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 8 - 14); };
    const oiv = oi.map(p => p.oi).filter(v => v > 0), ps = oi.map(p => p.p).filter(v => v > 0);
    const oy = oiv.length > 1 ? scale(oiv) : null, py = ps.length > 1 ? scale(ps) : null;
    const path = (f: (v: number) => number, k: "oi" | "p") => oi.filter(p => p[k] > 0).map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${f(p[k]).toFixed(1)}`).join(" ");
    return (<>
      {py && <path d={path(py, "p")} fill="none" stroke="#9ca3af" strokeWidth={1.3} />}
      {oy && <path d={path(oy, "oi")} fill="none" stroke="#7c3aed" strokeWidth={1.6} />}
      {py && <><text x={CW - 50} y={py(Math.max(...ps)) + 3} fontSize={9} fill="#9ca3af">{Math.max(...ps).toFixed(1)}</text>
        <text x={CW - 50} y={py(Math.min(...ps)) + 3} fontSize={9} fill="#9ca3af">{Math.min(...ps).toFixed(1)}</text></>}
    </>);
  };
  return (
    <div className="pg-card rounded-lg border border-gray-200 bg-white p-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-bold text-gray-800">🌐 외국인 K200 선물 · 시장 미결제약정</span>
        <span className="text-[11px] text-gray-400">근월물 {fut?.month ?? ""} · 외국인 {live ? <b className="text-emerald-600">● 한투 실시간(1분)</b> : "네이버 20분 지연"} · 계약×선물가×25만 · 미결제는 근월물 전체(외국인만 아님), 앱이 켜진 동안 1분마다 기록</span>
        {fut && fut.oi > 0 && <span className="ml-auto font-bold tabular-nums text-gray-800">미결제 {fut.oi.toLocaleString()} <span className={`text-[11px] ${tone(fut.oiChg)}`}>({fut.oiChg > 0 ? "+" : ""}{fut.oiChg.toLocaleString()})</span></span>}
      </div>
      {!last && oi.length < 2 ? <div className="text-gray-400 text-[12px] py-6 text-center">오늘 수급이 아직 없습니다(장 전·휴장) — 주간 선물장 08:45~15:45, 앱을 켜 둔 시간부터 기록합니다.</div> : (
        <div className="mt-1 flex gap-2">
          {last && (<>
          <div className="w-[124px] shrink-0 flex flex-col gap-1 text-center">
            <div className="rounded border border-gray-200 py-1"><div className="text-[10.5px] text-gray-500">외국인 누적</div>
              <div className={`font-bold tabular-nums ${tone(last.v)}`}>{eok(last.v)}</div><div className="text-[10px] text-gray-400 tabular-nums">{last.c > 0 ? "+" : ""}{last.c.toLocaleString()}계약 · {last.t}</div></div>
            <div className="rounded border border-gray-200 py-1" title="장중 가장 많이 판(산) 지점에서 얼마나 되돌렸나 — 100% 면 0 까지 되사(되판) 것">
              <div className="text-[10.5px] text-gray-500">정리율</div>
              <div className="font-bold tabular-nums text-gray-800">{recov != null ? `${Math.round(recov)}%` : "—"}</div><div className="text-[10px] text-gray-400">{ext ? `장중 ${ext.v < 0 ? "최저" : "최고"} 대비` : ""}</div></div>
            <div className="rounded border border-gray-200 py-1"><div className="text-[10.5px] text-gray-500">15분 변화</div>
              <div className={`font-bold tabular-nums ${tone(d15 ?? 0)}`}>{d15 != null ? eok(d15) : "—"}</div><div className="text-[10px] text-gray-400 tabular-nums">{d15c != null ? `${d15c > 0 ? "+" : ""}${d15c.toLocaleString()}계약` : ""}</div></div>
            <div className="rounded border border-gray-200 py-1"><div className="text-[10.5px] text-gray-500">장중 {ext && ext.v < 0 ? "최저" : "최고"}</div>
              <div className={`font-bold tabular-nums ${tone(ext?.v ?? 0)}`}>{ext ? eok(ext.v) : "—"}</div><div className="text-[10px] text-gray-400">{ext?.t ?? ""}</div></div>
            {spot != null && (
              <div className="text-[10.5px] text-gray-600 leading-tight">현물(코스피) 외국인<br /><b className={tone(spot)}>{eok(spot)}</b>
                {together && <span className={`ml-1 px-1 rounded border text-[10px] font-bold ${together === "동반매도" ? "border-blue-300 bg-blue-50 text-blue-700" : together === "동반매수" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-gray-300 bg-gray-50 text-gray-600"}`}>{together}</span>}
              </div>
            )}
          </div>
          </>)}
          <div className="flex-1 min-w-0">
            <Chart series={fs.map(p => ({ t: p.t, v: p.v }))} baseZero color="#1e3a8a" height={H} width={CW}
                   markers={ext && !extAtEnd ? [{ t: ext.t, v: ext.v, label: `${ext.v < 0 ? "최저" : "최고"} ${ext.t}`, color: "#2563eb" }] : []}>
              {(sx, sy) => (<>
                {kospiLayer(sx)}
                {oiLayer(sx)}
                {/* 선 끝 이름·값 — 무슨 선인지 바로(사용자 2026-11-04 "무슨 선인지, 선에 숫자도"). 겹치면 순서대로 쌓는다 */}
                {(() => {
                  const scale = (vals: number[]) => { const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || 0.5; return (v: number) => 8 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 8 - 14); };
                  const lo = oi[oi.length - 1], lf = fs[fs.length - 1];
                  const oiv = oi.map(p => p.oi).filter(v => v > 0), ps = oi.map(p => p.p).filter(v => v > 0);
                  const items: { x: number; y: number; t: string; c: string }[] = [];
                  if (lf) items.push({ x: sx(lf.t), y: sy(lf.v), t: `외국인 ${eok(lf.v)}${extAtEnd && ext ? ` (장중 ${ext.v < 0 ? "최저" : "최고"})` : ""}`, c: lf.v >= 0 ? "#e11d48" : "#1e3a8a" });
                  if (lo && oiv.length > 1) items.push({ x: sx(lo.t), y: scale(oiv)(lo.oi), t: `미결제 ${lo.oi.toLocaleString()}`, c: "#7c3aed" });
                  if (lo && ps.length > 1) items.push({ x: sx(lo.t), y: scale(ps)(lo.p), t: `선물 ${lo.p.toFixed(2)}`, c: "#6b7280" });
                  items.sort((a, b) => a.y - b.y);
                  const GAP = 13;
                  for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + GAP);
                  for (let i = items.length - 1; i >= 0; i--) { if (items[i].y > H - 16) items[i].y = H - 16; if (i > 0) items[i - 1].y = Math.min(items[i - 1].y, items[i].y - GAP); }
                  return items.map(it => (
                    <g key={it.t}>
                      <circle cx={it.x} cy={it.y} r={0} />
                      <text x={Math.min(it.x + 6, CW - 150)} y={Math.max(10, it.y) + 3} fontSize={10.5} fontWeight={700} fill={it.c} paintOrder="stroke" stroke="white" strokeWidth={3}>{it.t}</text>
                    </g>
                  ));
                })()}
                {ext && ext.v !== 0 && [0.5, 0.2].map(r => <g key={r}><line x1={sx(ext.t)} x2={CW - 52} y1={sy(ext.v * (1 - r))} y2={sy(ext.v * (1 - r))} stroke="#f43f5e" strokeDasharray="2 3" strokeWidth={1} />
                  <text x={CW - 50} y={sy(ext.v * (1 - r)) + 3} fontSize={9} fill="#f43f5e">{r * 100}%</text></g>)}
              </>)}
            </Chart>
            <svg viewBox={`0 0 ${CW} 40`} className="w-full" style={{ height: 40 }} preserveAspectRatio="none">
              {(() => {
                const mx = Math.max(1, ...bars.map(b => Math.abs(b.d)));
                const sx = (t: string) => 4 + ((hm2m(t) - X0) / (X1 - X0)) * (CW - 56);
                return bars.map(b => { const h = (Math.abs(b.d) / mx) * 18; return (
                  <rect key={b.t} x={sx(b.t)} width={Math.max(2, (15 / (X1 - X0)) * (CW - 56) - 2)} y={b.d >= 0 ? 20 - h : 20} height={Math.max(1, h)} fill={BAR[b.kind].c}>
                    <title>{`${b.t}~ 미결제 ${b.d > 0 ? "+" : ""}${b.d.toLocaleString()} · ${BAR[b.kind].l}`}</title>
                  </rect>); });
              })()}
              <line x1={4} x2={CW - 52} y1={20} y2={20} stroke="#e5e7eb" />
            </svg>
            <div className="flex flex-wrap gap-x-2 text-[10px] text-gray-500">
              <span><b className="text-blue-900">—</b> 외국인 누적(억원)</span><span><span className="text-rose-500">┈</span> 정리율 20·50%</span>
              {kospi && kospi.length > 1 && <span><span className="inline-block w-3 h-2 mr-0.5 align-middle bg-rose-200" /><span className="inline-block w-3 h-2 mr-0.5 align-middle bg-blue-200" />코스피(전일 종가 위·아래, 축 따로)</span>}
              <span><b className="text-violet-700">—</b> 미결제(축 따로)</span><span><b className="text-gray-400">—</b> 선물가(축 따로)</span>
              <span className="text-gray-400">15분 막대:</span>
              {Object.values(BAR).map(b => <span key={b.l}><span className="inline-block w-2 h-2 rounded-sm mr-0.5 align-middle" style={{ background: b.c }} />{b.l}</span>)}
              {fut?.basis != null && <span className="ml-auto">베이시스 <b>{fut.basis.toFixed(2)}</b></span>}
            </div>
          </div>
          {/* 읽기 — 결론 먼저, 근거 한 줄씩(사용자 2026-11-04 "이 그래프 분석을 오른쪽에") */}
          {read && (
            <div className="hidden lg:flex flex-col w-[400px] shrink-0 rounded border border-gray-200 bg-gray-50/60 p-2 text-[11.5px] leading-snug">
              <div className="text-[10.5px] text-gray-400 mb-0.5">그래프 읽기</div>
              <div className={`font-bold text-[12.5px] ${RT[read.head.tone]}`}>{read.head.text}</div>
              <div className="mt-1.5 space-y-1">
                {read.lines.map(l => (
                  <div key={l.label}><b className="text-gray-700">{l.label}:</b> <span className={RT[l.tone]}>{l.text}</span></div>
                ))}
              </div>
              <div className="mt-auto pt-1 text-[10px] text-gray-400">숫자를 규칙으로 읽은 지금 상태 · 예측 아님</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
