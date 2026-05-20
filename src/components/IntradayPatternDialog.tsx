// 시간대 겹침(intraday overlay) 모달 — 종목 카드에서 열림.
// 최근 ~30일 5분봉을 "하루 중 시각"으로 겹쳐 전형적 하루 패턴(평균선) 표시.
// 데이터: Yahoo 5분봉(KR .KS/.KQ), 시초가 대비 % 정규화. KR 정규장 09:00~15:30.
// 요일(월~금) 토글로 특정 요일만 골라 평균을 다시 볼 수 있음.
import { useMemo, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchKrIntraday } from "../lib/api";
import {
  buildIntradayOverlay, computeAvg, overlayInsight, minsToHHMM, KR_SESSION,
} from "../lib/intraday";
import { useEscClose } from "../lib/useEscClose";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;       // KR 6자리
  stockName: string;
}

// 요일 (KST getUTCDay 기준 1=월 … 5=금) + 색상
const WEEKDAYS = [
  { dow: 1, label: "월", color: "#ef4444" },
  { dow: 2, label: "화", color: "#f59e0b" },
  { dow: 3, label: "수", color: "#10b981" },
  { dow: 4, label: "목", color: "#3b82f6" },
  { dow: 5, label: "금", color: "#8b5cf6" },
];
const DOW_COLOR: Record<number, string> = Object.fromEntries(WEEKDAYS.map(w => [w.dow, w.color]));

// SVG 좌표계
const W = 900, H = 480;
const ML = 50, MR = 58, MT = 20, MB = 34;   // MR 넓힘 — 우측 끝 날짜 박스 공간
const PW = W - ML - MR;
const PH = H - MT - MB;

export function IntradayPatternDialog({ isOpen, onClose, ticker, stockName }: Props) {
  useEscClose(isOpen, onClose);
  // 선택 요일 — 기본 "오늘 요일"(KST). 주말이면 월~금 전체.
  const [sel, setSel] = useState<Set<number>>(() => {
    const dow = new Date(Date.now() + 9 * 3600_000).getUTCDay();   // 0=일 … 6=토 (KST)
    return dow >= 1 && dow <= 5 ? new Set([dow]) : new Set([1, 2, 3, 4, 5]);
  });
  // 마우스 오버 위치 (SVG 좌표). x = 스냅된 시각(분), my = 커서 y
  const [hover, setHover] = useState<{ x: number; my: number } | null>(null);
  // 오른쪽 날짜 박스에 직접 오버한 일자 (차트 hover 보다 우선)
  const [boxDate, setBoxDate] = useState<string | null>(null);

  const { data: bars, isLoading, isError } = useQuery({
    queryKey: ["intraday-5m", ticker],
    queryFn: () => fetchKrIntraday(ticker, "1mo", "5m"),
    enabled: isOpen,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const overlay = useMemo(
    () => (bars && bars.length > 0 ? buildIntradayOverlay(bars, KR_SESSION) : null),
    [bars],
  );
  // 요일별 거래일 수 (버튼 라벨용)
  const dowCount = useMemo(() => {
    const m: Record<number, number> = {};
    for (const d of overlay?.days ?? []) m[d.weekday] = (m[d.weekday] ?? 0) + 1;
    return m;
  }, [overlay]);

  const filteredDays = useMemo(
    () => (overlay?.days ?? []).filter(d => sel.has(d.weekday)),
    [overlay, sel],
  );
  const avg = useMemo(() => computeAvg(filteredDays), [filteredDays]);
  const insight = useMemo(
    () => (overlay ? overlayInsight(avg, filteredDays.length, overlay.openMin) : {}),
    [avg, filteredDays.length, overlay],
  );

  if (!isOpen) return null;

  // y 도메인 — 선택된 일자 + 평균 절대값 최대 (최소 ±0.5%)
  let absMax = 0.5;
  for (const d of filteredDays) for (const p of d.points) absMax = Math.max(absMax, Math.abs(p.y));
  for (const p of avg) absMax = Math.max(absMax, Math.abs(p.y));
  const D = Math.ceil(absMax * 2) / 2;   // 0.5 단위 올림

  const sessionMins = overlay?.sessionMins ?? 390;
  const openMin = overlay?.openMin ?? KR_SESSION.openMin;
  const sx = (x: number) => ML + (x / sessionMins) * PW;
  const sy = (y: number) => MT + (1 - (y + D) / (2 * D)) * PH;

  // x축 시각 눈금 (정시 + 마감)
  const xTicks: number[] = [];
  for (let x = 0; x <= sessionMins; x++) if ((openMin + x) % 60 === 0) xTicks.push(x);
  if (xTicks[xTicks.length - 1] !== sessionMins) xTicks.push(sessionMins);
  const yTicks = [D, D / 2, 0, -D / 2, -D];

  const dayPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");

  // 평균선 — 표본 적은 시각 버킷(마감 동시호가 15:20 등)은 제외해 스파이크 방지
  const minSamples = Math.max(2, Math.ceil(filteredDays.length * 0.5));
  const avgPlot = avg.filter(p => p.n >= minSamples);

  // 각 선 오른쪽 끝(15:30) 날짜 박스 — y 충돌 시 아래로 밀어 분리
  const LBL_H = 14;
  const lblX = W - MR + 3;
  const lblW = MR - 6;
  const endLabels = filteredDays
    .map(d => {
      const last = d.points[d.points.length - 1];
      return {
        key: d.date,                                // YYYY-MM-DD (오버 매칭용)
        date: d.date.slice(5).replace("-", "/"),   // MM/DD
        color: DOW_COLOR[d.weekday] ?? "#94a3b8",
        endY: sy(last.y), endX: sx(last.x), y: sy(last.y),
      };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y < endLabels[i - 1].y + LBL_H) endLabels[i].y = endLabels[i - 1].y + LBL_H;
  }

  // 마우스 오버 — 박스 오버 우선, 없으면 스냅된 시각(x)에서 커서에 가장 가까운 일자 선.
  let hoverInfo: { x: number; y: number; date: string; weekday: number } | null = null;
  if (boxDate) {
    const d = filteredDays.find(x => x.date === boxDate);
    if (d) {
      const last = d.points[d.points.length - 1];
      hoverInfo = { x: last.x, y: last.y, date: d.date, weekday: d.weekday };
    }
  } else if (hover) {
    let best: { y: number; date: string; weekday: number; dist: number } | null = null;
    for (const d of filteredDays) {
      const pt = d.points.find(p => p.x === hover.x);
      if (!pt) continue;
      const dist = Math.abs(sy(pt.y) - hover.my);
      if (!best || dist < best.dist) best = { y: pt.y, date: d.date, weekday: d.weekday, dist };
    }
    if (best) hoverInfo = { x: hover.x, y: best.y, date: best.date, weekday: best.weekday };
  }

  // 오버된 라인의 그날 최저·최고 지점
  let hoverMinMax: { lo: { x: number; y: number }; hi: { x: number; y: number } } | null = null;
  if (hoverInfo) {
    const d = filteredDays.find(x => x.date === hoverInfo!.date);
    if (d && d.points.length > 0) {
      let lo = d.points[0], hi = d.points[0];
      for (const p of d.points) { if (p.y < lo.y) lo = p; if (p.y > hi.y) hi = p; }
      hoverMinMax = { lo, hi };
    }
  }

  const onSvgMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const svgY = ((e.clientY - rect.top) / rect.height) * H;
    let mins = ((svgX - ML) / PW) * sessionMins;
    mins = Math.round(mins / 5) * 5;   // 5분 버킷 스냅
    if (mins < 0 || mins > sessionMins) { setHover(null); return; }
    setHover({ x: mins, my: svgY });
  };

  // 기본: 단일 선택(그 요일만). Shift+클릭: 여러 요일 토글.
  const pickDow = (e: MouseEvent, dow: number) => {
    if (e.shiftKey) {
      setSel(prev => {
        const next = new Set(prev);
        if (next.has(dow)) next.delete(dow); else next.add(dow);
        if (next.size === 0) next.add(dow);   // 최소 1개 유지
        return next;
      });
    } else {
      setSel(new Set([dow]));
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white shadow-xl flex flex-col
                       w-[920px] max-w-[96vw] h-[680px] max-h-[94vh]
                       rounded-t-xl sm:rounded-lg overflow-hidden">
        <header className="px-5 py-3 border-b bg-gray-50 flex items-center shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-1.5">⏰ 시간대 패턴</h2>
          <span className="ml-3 text-sm text-gray-600 truncate">{stockName} ({ticker})</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>

        <div className="px-5 py-3 space-y-3 flex-1 overflow-y-auto">
          {isLoading && <div className="h-40 flex items-center justify-center text-gray-400 text-sm">분봉 불러오는 중…</div>}
          {isError && <div className="h-40 flex items-center justify-center text-red-400 text-sm">데이터를 불러오지 못했습니다.</div>}
          {!isLoading && !isError && (!overlay || overlay.days.length === 0) && (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
              분봉 데이터가 없습니다 (해외/ETF 일부는 미지원).
            </div>
          )}

          {overlay && overlay.days.length > 0 && (
            <>
              {/* 요일 선택 — 기본 단일, Shift+클릭 시 다중 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {WEEKDAYS.map(w => {
                  const on = sel.has(w.dow);
                  const cnt = dowCount[w.dow] ?? 0;
                  return (
                    <button key={w.dow} type="button" onClick={e => pickDow(e, w.dow)}
                            disabled={cnt === 0}
                            className={`px-2.5 py-1 rounded-full text-xs font-bold border transition
                                        ${cnt === 0 ? "opacity-30 cursor-not-allowed border-gray-200 text-gray-400"
                                          : on ? "text-white" : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}
                            style={on && cnt > 0 ? { backgroundColor: w.color, borderColor: w.color } : undefined}>
                      {w.label}<span className="ml-1 font-normal opacity-80">{cnt}</span>
                    </button>
                  );
                })}
                <button type="button" onClick={() => setSel(new Set([1, 2, 3, 4, 5]))}
                        className={`ml-1 px-2.5 py-1 rounded-full text-xs font-bold border transition
                                    ${sel.size === 5 ? "bg-gray-800 text-white border-gray-800"
                                      : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
                  전체
                </button>
                <span className="ml-1 text-[11px] text-gray-400">Shift+클릭 = 여러 요일</span>
              </div>

              <div className="text-xs text-gray-500">
                선택 <b className="text-gray-700">{filteredDays.length}</b>거래일 (전체 {overlay.days.length}) ·
                KR 정규장 09:00~15:30 · 각 날 시초가 대비 % (5분봉)
              </div>

              {filteredDays.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-gray-400 text-sm">요일을 선택하세요.</div>
              ) : (
              <svg viewBox={`0 0 ${W} ${H}`}
                   className="w-full h-auto rounded border border-gray-100 bg-white cursor-crosshair"
                   onMouseMove={onSvgMove} onMouseLeave={() => setHover(null)}>
                {/* y 눈금 + 가로선 */}
                {yTicks.map(yt => (
                  <g key={`y${yt}`}>
                    <line x1={ML} y1={sy(yt)} x2={W - MR} y2={sy(yt)}
                          stroke={yt === 0 ? "#9ca3af" : "#f1f5f9"} strokeWidth={1} />
                    <text x={ML - 6} y={sy(yt) + 3} textAnchor="end" fontSize={12} fill="#94a3b8">
                      {yt > 0 ? "+" : ""}{yt.toFixed(1)}%
                    </text>
                  </g>
                ))}
                {/* x 눈금 (시각) */}
                {xTicks.map(xt => (
                  <text key={`x${xt}`} x={sx(xt)} y={H - MB + 16} textAnchor="middle" fontSize={12} fill="#94a3b8">
                    {minsToHHMM(openMin, xt)}
                  </text>
                ))}
                {/* 날짜별 선 — 요일 색. 마우스 오버 시 오버된 선만 강조, 나머지 흐림 */}
                {filteredDays.map(d => {
                  const hi = hoverInfo?.date === d.date;
                  const dim = hoverInfo && !hi;
                  return (
                    <path key={d.date} d={dayPath(d.points)} fill="none"
                          stroke={DOW_COLOR[d.weekday] ?? "#cbd5e1"}
                          strokeWidth={hi ? 2.5 : 1}
                          opacity={dim ? 0.1 : hi ? 1 : 0.35} />
                  );
                })}
                {/* 평균선 (굵게) — 표본 적은 버킷 제외. 특정 선 오버 시 살짝 흐림 */}
                <path d={dayPath(avgPlot)} fill="none" stroke="#1f2937" strokeWidth={3}
                      opacity={hoverInfo ? 0.35 : 1} />
                {/* 최저/최고 평균 시각 마커 */}
                {insight.lowX != null && (
                  <circle cx={sx(insight.lowX)} cy={sy(insight.lowPct ?? 0)} r={3.5} fill="#2563eb" />
                )}
                {insight.highX != null && (
                  <circle cx={sx(insight.highX)} cy={sy(insight.highPct ?? 0)} r={3.5} fill="#e11d48" />
                )}
                {/* 각 선 오른쪽 끝 날짜 박스 (선 끝 → 박스 연결선). 오버 시 해당 박스만 남기고 흐림 */}
                {endLabels.map((l, i) => {
                  const hi = hoverInfo?.date === l.key;
                  return (
                    <g key={`lbl${i}`} opacity={hoverInfo ? (hi ? 1 : 0.12) : 1}
                       style={{ cursor: "pointer" }}
                       onMouseEnter={() => setBoxDate(l.key)}
                       onMouseLeave={() => setBoxDate(null)}>
                      <line x1={l.endX} y1={l.endY} x2={lblX} y2={l.y}
                            stroke={l.color} strokeWidth={0.75} opacity={0.5} />
                      <rect x={lblX} y={l.y - LBL_H / 2} width={lblW} height={LBL_H} rx={2}
                            fill={l.color} opacity={0.92} />
                      <text x={lblX + lblW / 2} y={l.y + 3} textAnchor="middle"
                            fontSize={9} fontWeight={700} fill="#fff">{l.date}</text>
                    </g>
                  );
                })}
                {/* 마우스 오버 — 크로스헤어 + 시각/값 강조 + 툴팁 */}
                {hoverInfo && (() => {
                  const px = sx(hoverInfo.x), py = sy(hoverInfo.y);
                  const color = DOW_COLOR[hoverInfo.weekday] ?? "#1f2937";
                  const dowLabel = WEEKDAYS.find(w => w.dow === hoverInfo.weekday)?.label ?? "";
                  const timeStr = minsToHHMM(openMin, hoverInfo.x);
                  const valStr = `${hoverInfo.y >= 0 ? "+" : ""}${hoverInfo.y.toFixed(2)}%`;
                  const tipW = 132, tipH = 20;
                  const tx = Math.min(Math.max(px + 8, ML), W - MR - tipW);
                  const ty = Math.min(Math.max(py - tipH - 6, MT), MT + PH - tipH);
                  return (
                    <g>
                      {/* 세로 크로스헤어 (오버된 시간) */}
                      <line x1={px} y1={MT} x2={px} y2={MT + PH} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />
                      {/* 가로 크로스헤어 (오버된 값) */}
                      <line x1={ML} y1={py} x2={W - MR} y2={py} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />
                      {/* 시각 강조 라벨 (x축) */}
                      <rect x={px - 22} y={H - MB + 4} width={44} height={16} rx={2} fill={color} />
                      <text x={px} y={H - MB + 16} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{timeStr}</text>
                      {/* 값 강조 라벨 (y축) */}
                      <rect x={ML - 44} y={py - 8} width={42} height={16} rx={2} fill={color} />
                      <text x={ML - 23} y={py + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{valStr}</text>
                      {/* 오버된 점 */}
                      <circle cx={px} cy={py} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
                      {/* 툴팁 */}
                      <rect x={tx} y={ty} width={tipW} height={tipH} rx={3} fill="#1f2937" opacity={0.92} />
                      <text x={tx + 8} y={ty + 14} fontSize={11} fontWeight={600} fill="#fff">
                        {hoverInfo.date.slice(5).replace("-", "/")}({dowLabel}) {timeStr} {valStr}
                      </text>
                    </g>
                  );
                })()}
                {/* 오버된 라인의 그날 최저·최고 값 */}
                {hoverMinMax && (() => {
                  const mk = (p: { x: number; y: number }, isHi: boolean) => {
                    const cx = sx(p.x), cy = sy(p.y);
                    const fill = isHi ? "#e11d48" : "#2563eb";
                    const txt = `${isHi ? "고" : "저"} ${p.y >= 0 ? "+" : ""}${p.y.toFixed(2)}% ${minsToHHMM(openMin, p.x)}`;
                    const bw = 86, bh = 15;
                    const bx = Math.min(Math.max(cx - bw / 2, ML), W - MR - bw);
                    const by = isHi ? cy - bh - 7 : cy + 7;   // 고점 위, 저점 아래
                    return (
                      <g>
                        <circle cx={cx} cy={cy} r={3.5} fill={fill} stroke="#fff" strokeWidth={1.2} />
                        <rect x={bx} y={by} width={bw} height={bh} rx={2} fill={fill} />
                        <text x={bx + bw / 2} y={by + 11} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff">{txt}</text>
                      </g>
                    );
                  };
                  return <g>{mk(hoverMinMax.hi, true)}{mk(hoverMinMax.lo, false)}</g>;
                })()}
              </svg>
              )}

              {/* 인사이트 */}
              {insight.lowAt && insight.highAt && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className="text-blue-600">
                    🔵 평균 최저 <b>{insight.lowAt}</b> ({insight.lowPct! >= 0 ? "+" : ""}{insight.lowPct!.toFixed(2)}%)
                    <span className="text-gray-400 text-xs"> — 매수 유리</span>
                  </span>
                  <span className="text-rose-600">
                    🔴 평균 최고 <b>{insight.highAt}</b> ({insight.highPct! >= 0 ? "+" : ""}{insight.highPct!.toFixed(2)}%)
                    <span className="text-gray-400 text-xs"> — 매도 유리</span>
                  </span>
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-gray-400 border-t border-gray-100 pt-2">
                ⚠️ 굵은 선 = 선택 요일 평균(전형적 하루 모양), 가는 선 = 개별 일자(요일 색).
                과거 시간대 경향은 <b>약한 참고용</b>일 뿐이며, 표본이 적을수록(요일별 ~4일) 변동이 큽니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default IntradayPatternDialog;
