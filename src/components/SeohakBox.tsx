// 🐜 서학개미 — 예탁결제원 해외주식 결제·보관 상위(사용자 2026-11-03 "셋다": 랭킹 상자·종목 꼬리표·레버리지 쏠림).
//   PC·모바일 지수(미국) 페이지 맨 아래가 같이 쓴다. 자료는 하루 한 번(lib/seohak).
import { useState } from "react";
import { createPortal } from "react-dom";
import { bearShare, bullShare, fmtUsdKr, mdOf, netSellers, seohakOf, useSeohak, type SeohakRow, type SeohakHold, type LevKind } from "../lib/seohak";
import { useHoverLayer, layerStyle } from "../lib/useHoverLayer";

const LevBadge = ({ k }: { k?: LevKind }) => !k ? null : (
  <span className={`ml-0.5 px-0.5 rounded text-[8.5px] font-bold leading-none align-middle ${k === "bull" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
    {k === "bull" ? "레버" : "인버스"}
  </span>
);

function FlowList({ title, cls, rows, n, pick }: { title: string; cls: string; rows: SeohakRow[]; n: number; pick: (r: SeohakRow) => number }) {
  return (
    <div className="min-w-0">
      <div className={`text-xs font-bold mb-0.5 ${cls}`}>{title}</div>
      <table className="w-full text-[11.5px] tabular-nums">
        <tbody>
          {rows.slice(0, n).map((r, i) => (
            <tr key={r.isin} className="border-t border-gray-100" title={`${r.n}\n매수 ${fmtUsdKr(r.buy)} · 매도 ${fmtUsdKr(r.sell)} · 순 ${fmtUsdKr(r.net, true)}`}>
              <td className="w-4 text-gray-400">{i + 1}</td>
              <td className="truncate max-w-[7rem] font-semibold text-gray-800">{r.t ?? r.n}<LevBadge k={r.lev} /></td>
              <td className={`text-right font-bold ${cls}`}>{fmtUsdKr(pick(r), true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoldList({ rows, n }: { rows: SeohakHold[]; n: number }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-bold mb-0.5 text-slate-700">💼 보유 상위</div>
      <table className="w-full text-[11.5px] tabular-nums">
        <tbody>
          {rows.slice(0, n).map(r => {
            const mv = r.prevRank == null ? null : r.prevRank - r.rank;
            return (
              <tr key={r.isin} className="border-t border-gray-100" title={`${r.n}\n보관 ${fmtUsdKr(r.amt)}${r.prevAmt ? ` · 전주 ${fmtUsdKr(r.prevAmt)}` : ""}`}>
                <td className="w-4 text-gray-400">{r.rank}</td>
                <td className="truncate max-w-[7rem] font-semibold text-gray-800">{r.t ?? r.n}<LevBadge k={r.lev} /></td>
                <td className="text-right text-gray-700">{fmtUsdKr(r.amt)}</td>
                <td className={`w-6 text-right text-[10px] ${mv == null ? "text-amber-600" : mv > 0 ? "text-rose-600" : mv < 0 ? "text-blue-600" : "text-gray-300"}`}>
                  {mv == null ? "new" : mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 레버리지 쏠림 — 매수 금액 중 레버리지(상승 쪽) 비중, 30결제일 막대(위=레버리지, 아래=인버스) */
function LevPanel({ compact }: { compact?: boolean }) {
  const f = useSeohak();
  const days = f?.lev ?? [];
  if (!days.length) return null;
  const last = days[days.length - 1];
  const shares = days.map(bullShare);
  const avg = shares.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, shares.length - 1);
  const now = bullShare(last);
  // 판정 = 최근 결제일들 가운데 오늘이 몇 번째로 높은가(절대 기준은 시기마다 달라 못 쓴다)
  const pct = shares.filter(x => x <= now).length / shares.length;
  const verdict = pct >= 0.9 ? { t: "과열", c: "text-rose-600 bg-rose-50 border-rose-300", d: `최근 ${shares.length}결제일 중 가장 높은 축 — 개인이 레버리지로 크게 쏠렸어요. 단기 꼭지 경계 신호로 자주 봅니다.` }
    : pct >= 0.7 ? { t: "높음", c: "text-amber-700 bg-amber-50 border-amber-300", d: "레버리지 매수 비중이 평소보다 높아요 — 개인 열기가 달아오르는 중입니다." }
    : pct <= 0.2 ? { t: "식음", c: "text-blue-700 bg-blue-50 border-blue-300", d: "레버리지 매수가 평소보다 적어요 — 개인 열기가 식은 날입니다." }
    : { t: "평소", c: "text-gray-600 bg-gray-50 border-gray-300", d: "레버리지 매수 비중이 평소 수준입니다." };
  const W = 300, H = 56, mid = 36, bw = W / days.length;
  const maxBull = Math.max(0.3, ...shares), maxBear = Math.max(0.05, ...days.map(bearShare));
  return (
    <div className="min-w-0">
      <div className="text-xs font-bold mb-0.5 text-amber-700">🎢 레버리지 쏠림</div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-xl font-black tabular-nums text-amber-700">{Math.round(now * 100)}%</span>
        <span className={`px-1 rounded border text-[10.5px] font-bold ${verdict.c}`}>{verdict.t}</span>
        <span className="text-[10.5px] text-gray-500">평소 {Math.round(avg * 100)}% · {mdOf(last.date)} 결제</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14 mt-0.5" preserveAspectRatio="none">
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="#d1d5db" strokeWidth={0.6} />
        <line x1={0} x2={W} y1={mid - (avg / maxBull) * (mid - 2)} y2={mid - (avg / maxBull) * (mid - 2)} stroke="#f59e0b" strokeWidth={0.6} strokeDasharray="3 2" />
        {days.map((d, i) => {
          const b = (bullShare(d) / maxBull) * (mid - 2), s = (bearShare(d) / maxBear) * (H - mid - 2);
          return (
            <g key={d.date}>
              <title>{`${mdOf(d.date)} 레버리지 ${Math.round(bullShare(d) * 100)}% · 인버스 ${Math.round(bearShare(d) * 100)}%${d.top.length ? `\n${d.top.map(t => `${t.t} ${fmtUsdKr(t.net, true)}`).join(" · ")}` : ""}`}</title>
              <rect x={i * bw + 0.5} y={mid - b} width={Math.max(1, bw - 1)} height={b} fill={i === days.length - 1 ? "#d97706" : "#fbbf24"} />
              <rect x={i * bw + 0.5} y={mid} width={Math.max(1, bw - 1)} height={s} fill="#38bdf8" />
            </g>
          );
        })}
      </svg>
      {!compact && <div className="text-[10.5px] text-gray-600 leading-snug">{verdict.d}</div>}
      {last.top.length > 0 && (
        <div className="text-[10.5px] text-gray-500 leading-snug">그날 많이 거래: {last.top.map(t => `${t.t} ${fmtUsdKr(t.net, true)}`).join(" · ")}</div>
      )}
      <div className="text-[9.5px] text-gray-400 leading-snug">막대 위=레버리지 매수 비중 · 아래=인버스 · 점선=평소</div>
    </div>
  );
}

export function SeohakBox({ compact }: { compact?: boolean }) {
  const f = useSeohak();
  const [per, setPer] = useState<"week" | "day">("week");
  if (!f) return null;
  const src = per === "week" ? f.week : f.day;
  const n = compact ? 7 : 10;
  const buys = src.net.filter(r => r.net > 0), sells = netSellers(src.sell);
  const perLabel = per === "week" ? `${mdOf(f.meta.weekFrom)}~${mdOf(f.meta.setlDate)}` : mdOf(f.meta.setlDate);
  return (
    <div className="pg-box relative rounded-xl border border-gray-300 bg-white p-2.5 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-700 whitespace-nowrap">
        🐜 서학개미 — 한국 개인의 미국 주식
        <span className="ml-2 inline-flex rounded border border-gray-300 overflow-hidden align-middle text-[11px]">
          {([["week", "1주"], ["day", "하루"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setPer(v)} className={`px-1.5 ${per === v ? "bg-gray-700 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>{l}</button>
          ))}
        </span>
      </span>
      <div className="text-[10.5px] text-gray-500 mb-1">
        예탁결제원 결제 {perLabel} · 보관 {mdOf(f.meta.holdDate)} 기준(순위 화살표는 {mdOf(f.meta.holdPrevDate)} 대비) · 달러 · 미국은 결제가 하루 늦어 장중 값이 아닙니다
      </div>
      <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
        <FlowList title="▲ 순매수 상위" cls="text-rose-600" rows={buys} n={n} pick={r => r.net} />
        <FlowList title="▼ 순매도 상위" cls="text-blue-600" rows={sells} n={n} pick={r => r.net} />
        <HoldList rows={f.hold} n={n} />
        <LevPanel compact={compact} />
      </div>
    </div>
  );
}

/** 미국 종목 카드 꼬리표 — '서학 3위'(보관 순위), 색은 이번 주 방향(순매수 빨강·순매도 파랑). 마우스를 올리면 금액. */
export function SeohakTag({ symbol, size = "sm", bookmark, flat }: { symbol: string | undefined; size?: "xs" | "sm"; bookmark?: boolean; flat?: boolean }) {
  const f = useSeohak();
  const hl = useHoverLayer();
  const info = seohakOf(f, symbol);
  if (!f || !info) return null;
  const tone = info.weekNet ? "border-rose-300 bg-rose-50 text-rose-700" : info.weekSell ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 bg-slate-50 text-slate-700";
  const label = info.hold ? `서학 보유 ${info.hold.rank}위` : info.weekNet ? `서학 매수 ${info.weekNet.rank}위` : `서학 매도 ${info.weekSell!.rank}위`;
  const base = flat
    ? "px-1.5 py-0 rounded text-[9px] font-bold leading-tight border whitespace-nowrap"
    : `inline-flex items-center px-1.5 py-0.5 ${bookmark ? "rounded-t-md" : "rounded"} border font-bold leading-none whitespace-nowrap ${size === "xs" ? "text-[9px]" : "text-[10px]"}`;
  const lines: string[] = [];
  if (info.hold) lines.push(`보유 ${info.hold.rank}위 · ${fmtUsdKr(info.hold.amt)}${info.hold.prevRank ? ` (전주 ${info.hold.prevRank}위)` : ""} — ${mdOf(f.meta.holdDate)}`);
  if (info.weekNet) lines.push(`1주 순매수 ${info.weekNet.rank}위 · ${fmtUsdKr(info.weekNet.row.net, true)}`);
  if (info.weekSell) lines.push(`1주 순매도 ${info.weekSell.rank}위 · ${fmtUsdKr(info.weekSell.row.net, true)}`);
  if (info.dayNet) lines.push(`${mdOf(f.meta.setlDate)} 하루 순매수 ${info.dayNet.rank}위 · ${fmtUsdKr(info.dayNet.row.net, true)}`);
  return (
    <>
      <span className={`${base} ${tone} cursor-default`} onMouseEnter={hl.enter} onMouseLeave={hl.leave}>{label}</span>
      {hl.pos && createPortal(
        <div className="fixed z-[1000] rounded-lg border border-gray-300 bg-white shadow-xl p-2 text-[11px] leading-snug pg-card"
             style={layerStyle(hl.pos, 280, 110)} onMouseEnter={hl.keep} onMouseLeave={hl.leave}>
          <div className="font-bold text-[12px] text-gray-800 mb-0.5">🐜 서학개미(한국 개인) — 예탁결제원</div>
          {lines.map((l, i) => <div key={i} className="text-gray-600">{l}</div>)}
          <div className="text-[10px] text-gray-400 mt-0.5">결제 {mdOf(f.meta.weekFrom)}~{mdOf(f.meta.setlDate)} · 상위 50 안에 들 때만 표시</div>
        </div>, document.body)}
    </>
  );
}
