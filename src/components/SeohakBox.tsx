// 🐜 서학개미 — 예탁결제원 해외주식 결제·보관 상위(사용자 2026-11-03 "셋다": 랭킹 상자·종목 꼬리표·레버리지 쏠림).
//   PC·모바일 지수(미국) 페이지 맨 아래가 같이 쓴다. 자료는 하루 한 번(lib/seohak).
import { useEffect, useRef, useState } from "react";
import { squarify } from "../lib/treemap";
import { heatColor, sectorKr } from "../lib/heatColor";
import { useQuery } from "@tanstack/react-query";
import { fetchHeatmapForTickers } from "../lib/api";
import { createPortal } from "react-dom";
import { bearShare, bullShare, fmtUsdKr, mdOf, netSellers, seohakOf, useSeohak, type SeohakRow, type SeohakHold, type LevKind } from "../lib/seohak";
import { useHoverLayer, layerStyle } from "../lib/useHoverLayer";
import { US_PAIRS } from "../lib/usMarketData";

// ETF 는 토스에도 한글 이름이 없다 — 지수 탭 카드 설명(desc)의 한글 조각을 빌린다(예: TQQQ → '나스닥100 3배')
const ETF_KO = new Map<string, string>();
for (const p of US_PAIRS) {
  const seg = (p.desc ?? "").split(/\s+—\s+|\. /).find(x => /[가-힣]/.test(x));
  if (seg && !ETF_KO.has(p.symbol)) ETF_KO.set(p.symbol, seg.length > 14 ? seg.slice(0, 13) + "…" : seg);
}
/** 한글 이름 — 토스 이름 > 카드 설명 > 영문(첫 세 단어) */
const koOf = (r: { t?: string; ko?: string; fn?: string; n: string }) =>
  r.ko ?? (r.t && ETF_KO.get(r.t)) ?? (r.fn ?? r.n).split(/\s+/).slice(0, 3).join(" ");

/** 회사 로고 — 토스 아이콘, 없으면 parqet 로고 주소, 그것도 깨지면 숨김 */
function Logo({ r, size }: { r: { t?: string; logo?: string }; size: number }) {
  const [src, setSrc] = useState(r.logo ?? (r.t ? `https://assets.parqet.com/logos/symbol/${r.t}?format=png` : ""));
  if (!src) return null;
  return <img src={src} alt="" width={size} height={size} loading="lazy"
              className="rounded-full bg-white shrink-0 shadow-sm" style={{ width: size, height: size }}
              onError={() => setSrc(r.logo && src === r.logo && r.t ? `https://assets.parqet.com/logos/symbol/${r.t}?format=png` : "")} />;
}

const LevBadge = ({ k }: { k?: LevKind }) => !k ? null : (
  <span className={`ml-0.5 px-0.5 rounded text-[8.5px] font-bold leading-none align-middle ${k === "bull" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
    {k === "bull" ? "레버" : "인버스"}
  </span>
);

/** 폭 재기 — 트리맵은 실제 픽셀 폭으로 배치해야 글자가 찌그러지지 않는다 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 💼 보유 비중 트리맵 — 히트맵 탭처럼 크기·색·그룹을 고른다(사용자 2026-11-03 "히트맵처럼").
 *  시세(1일·1주·1개월 등락률)와 섹터는 TradingView 스캐너 1콜(fetchHeatmapForTickers, 히트맵과 같은 길) */
type SizeBy = "hold" | "trade" | "net";
type ColorBy = "d1" | "w1" | "m1" | "flow" | "chg";
type GroupBy = "none" | "sector" | "kind";
const SIZE_OPTS: [SizeBy, string][] = [["hold", "보유액"], ["trade", "이번 주 거래액(매수+매도)"], ["net", "이번 주 순매매 크기"]];
const COLOR_OPTS: [ColorBy, string][] = [["d1", "1일 등락률"], ["w1", "1주 등락률"], ["m1", "1개월 등락률"], ["flow", "이번 주 순매매(보유 대비)"], ["chg", "보유 평가액 1주 변화"]];
const GROUP_OPTS: [GroupBy, string][] = [["kind", "종류(주식·ETF·레버리지)"], ["sector", "섹터"], ["none", "그룹 없음"]];   // 기본 = 종류(사용자 2026-11-03)
const SEL = "rounded border border-gray-300 bg-white text-[11px] px-1 py-0.5";
const HEAD = 15;

function HoldTreemap({ hold, week, height }: { hold: SeohakHold[]; week: { net: SeohakRow[]; sell: SeohakRow[] }; height: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [sizeBy, setSizeBy] = useState<SizeBy>("hold");
  const [colorBy, setColorBy] = useState<ColorBy>("d1");
  const [groupBy, setGroupBy] = useState<GroupBy>("kind");
  const tickers = hold.map(r => r.t).filter((t): t is string => !!t);
  const quotes = useQuery({
    queryKey: ["seohak-quotes", tickers.join(",")], queryFn: () => fetchHeatmapForTickers(tickers),
    enabled: tickers.length > 0, staleTime: 60_000, refetchInterval: 120_000, retry: 1,
  });
  const q = (r: SeohakHold) => (r.t ? quotes.data?.get(r.t) : undefined);
  const wk = new Map<string, SeohakRow>();
  for (const r of [...week.sell, ...week.net]) wk.set(r.isin, r);
  const total = hold.reduce((a, r) => a + r.amt, 0);
  const sizeOf = (r: SeohakHold) => sizeBy === "hold" ? r.amt
    : sizeBy === "trade" ? (wk.get(r.isin) ? wk.get(r.isin)!.buy + wk.get(r.isin)!.sell : 0)
    : Math.abs(wk.get(r.isin)?.net ?? 0);
  const pctOf = (r: SeohakHold): number | undefined => {
    const x = q(r);
    if (colorBy === "d1") return x ? x.changePct : undefined;
    if (colorBy === "w1") return x ? x.perfW : undefined;
    if (colorBy === "m1") return x ? x.perf1M : undefined;
    if (colorBy === "flow") return wk.has(r.isin) ? wk.get(r.isin)!.net / r.amt * 100 : undefined;
    return r.prevAmt ? (r.amt / r.prevAmt - 1) * 100 : undefined;
  };
  const sat = colorBy === "d1" ? 3 : colorBy === "w1" ? 6 : colorBy === "m1" ? 12 : colorBy === "flow" ? 3 : 6;
  const groupOf = (r: SeohakHold) => {
    const etf = !!r.lev || /\bETF\b|TRUST|SPDR|ISHARES|VANGUARD|INVESCO|PROSHARES|DIREX|SCHWAB|JPM|GLOBAL X|ROUNDHILL/i.test(`${r.n} ${r.fn ?? ""}`)
      || (q(r)?.sector ?? "") === "Miscellaneous";
    if (groupBy === "kind") return r.lev === "bull" ? "레버리지" : r.lev === "bear" ? "인버스" : etf ? "ETF" : "개별 주식";
    if (etf) return r.lev ? "레버리지·인버스 ETF" : "ETF";
    return sectorKr(q(r)?.sector ?? "기타");
  };
  type T = { r: SeohakHold; x: number; y: number; w: number; h: number };
  const tiles: T[] = [], heads: { name: string; x: number; y: number; w: number; h: number; sum: number }[] = [];
  const items = hold.filter(r => sizeOf(r) > 0);
  const sumSize = items.reduce((a, r) => a + sizeOf(r), 0);
  if (w > 0) {
    if (groupBy === "none") {
      for (const c of squarify(items.map(r => ({ item: r, value: sizeOf(r) })), { x: 0, y: 0, w, h: height })) tiles.push({ r: c.item, x: c.x, y: c.y, w: c.w, h: c.h });
    } else {
      const groups = new Map<string, SeohakHold[]>();
      for (const r of items) { const g = groupOf(r); (groups.get(g) ?? groups.set(g, []).get(g)!).push(r); }
      const gt = squarify([...groups].map(([name, list]) => ({ item: { name, list }, value: list.reduce((a, r) => a + sizeOf(r), 0) })), { x: 0, y: 0, w, h: height });
      for (const g of gt) {
        const sum = g.item.list.reduce((a, r) => a + sizeOf(r), 0);
        const head = g.h > 40 && g.w > 50 ? HEAD : 0;
        heads.push({ name: g.item.name, x: g.x, y: g.y, w: g.w, h: g.h, sum });
        for (const c of squarify(g.item.list.map(r => ({ item: r, value: sizeOf(r) })), { x: g.x + 1, y: g.y + head, w: g.w - 2, h: g.h - head - 1 }))
          tiles.push({ r: c.item, x: c.x, y: c.y, w: c.w, h: c.h });
      }
    }
  }
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-xs font-bold text-slate-700">💼 서학개미 보유 상위 50</span>
        <span className="text-[10px] text-gray-400">합계 {fmtUsdKr(total)}</span>
        <span className="ml-auto flex items-center gap-1 text-[10.5px] text-gray-500">
          크기 <select className={SEL} value={sizeBy} onChange={e => setSizeBy(e.target.value as SizeBy)}>{SIZE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          색 <select className={SEL} value={colorBy} onChange={e => setColorBy(e.target.value as ColorBy)}>{COLOR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          그룹 <select className={SEL} value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>{GROUP_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </span>
      </div>
      <div ref={ref} className="relative w-full rounded-md overflow-hidden bg-slate-100" style={{ height }}>
        {heads.map(g => (
          <div key={g.name} className="absolute rounded-sm border border-slate-400/60 bg-slate-300/40" style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
            {g.h > 40 && g.w > 50 && (
              <div className="h-[15px] px-1 text-[10.5px] font-bold text-slate-700 truncate leading-[15px]">
                {g.name} <span className="font-normal text-slate-500">{(g.sum / sumSize * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        ))}
        {tiles.map(({ r, x, y, w: tw, h: th }) => {
          const p = pctOf(r);
          const huge = tw > 120 && th > 95, big = tw > 76 && th > 58, mid = tw > 40 && th > 30;
          const name = koOf(r);
          const x0 = q(r);
          return (
            <div key={r.isin} className="absolute border border-white/70 text-white overflow-hidden flex flex-col items-center justify-center text-center leading-tight px-0.5"
                 style={{ left: x, top: y, width: tw, height: th, background: p == null ? "#94a3b8" : heatColor(p, sat) }}
                 title={`${r.t ?? r.n}${r.ko ? ` ${r.ko}` : ""} — ${r.n}${x0?.sector ? ` · ${sectorKr(x0.sector)}` : ""}\n` +
                        `보유 ${r.rank}위 · ${fmtUsdKr(r.amt)} (비중 ${(r.amt / total * 100).toFixed(1)}%)${r.prevRank ? ` · 전주 ${r.prevRank}위` : ""}\n` +
                        (wk.has(r.isin) ? `이번 주 매수 ${fmtUsdKr(wk.get(r.isin)!.buy)} · 매도 ${fmtUsdKr(wk.get(r.isin)!.sell)} · 순 ${fmtUsdKr(wk.get(r.isin)!.net, true)}` : "이번 주 매매 상위 50 밖") +
                        (x0 ? `\n1일 ${x0.changePct.toFixed(2)}% · 1주 ${x0.perfW.toFixed(1)}% · 1개월 ${x0.perf1M.toFixed(1)}%` : "")}>
              {mid && <Logo r={r} size={huge ? 34 : big ? 24 : 16} />}
              {big && name && <span className={`mt-0.5 font-bold truncate max-w-full ${huge ? "text-[15px]" : "text-[12px]"}`}>{name}</span>}
              {(mid || tw > 26) && th > 16 && (
                <span className={`font-bold truncate max-w-full ${big && name ? "text-[10px] opacity-85" : huge ? "text-[15px]" : big ? "text-[12px]" : "text-[9.5px]"}`}>
                  {r.t ?? r.n.split(" ")[0]}{r.lev && big && <span className="ml-0.5 text-[8px] px-0.5 rounded bg-white/25">{r.lev === "bull" ? "레버" : "인버스"}</span>}
                </span>
              )}
              {big && <span className={`tabular-nums font-black ${huge ? "text-[19px]" : "text-[14px]"}`}>{fmtUsdKr(sizeBy === "hold" ? r.amt : sizeOf(r))}</span>}
              {mid && !big && th > 52 && <span className="tabular-nums font-bold text-[11px]">{fmtUsdKr(sizeBy === "hold" ? r.amt : sizeOf(r))}</span>}
              {(big || (mid && th > 44)) && p != null && <span className={`tabular-nums font-bold ${huge ? "text-[14px]" : "text-[10.5px]"}`}>{p > 0 ? "+" : ""}{p.toFixed(colorBy === "d1" ? 2 : 1)}%</span>}
            </div>
          );
        })}
      </div>
      <div className="text-[9.5px] text-gray-400 mt-0.5 leading-snug">
        {colorBy === "flow" ? "색 = 이번 주 순매수(빨강)·순매도(파랑)가 보유액의 몇 %인가 · 회색 = 순매매 상위 50 밖"
          : colorBy === "chg" ? "색 = 보유 평가액 1주 변화(주가 등락 + 매매) · 회색 = 전주 상위 50 밖(새로 들어옴)"
          : `색 = ${COLOR_OPTS.find(o => o[0] === colorBy)![1]}(TradingView 시세${quotes.isError ? " — 불러오기 실패" : ""}) · 크기 = ${SIZE_OPTS.find(o => o[0] === sizeBy)![1]}`}
      </div>
    </div>
  );
}

/** ⇄ 순매수·순매도 나비 막대 — 왼쪽 파랑 = 순매도, 오른쪽 빨강 = 순매수, 같은 눈금 */
function FlowButterfly({ buys, sells, n }: { buys: SeohakRow[]; sells: SeohakRow[]; n: number }) {
  const b = buys.slice(0, n), s = sells.slice(0, n);
  const max = Math.max(1, ...b.map(r => r.net), ...s.map(r => -r.net));
  const tip = (r: SeohakRow) => `${r.t ?? r.n} — ${r.n}\n매수 ${fmtUsdKr(r.buy)} · 매도 ${fmtUsdKr(r.sell)} · 순 ${fmtUsdKr(r.net, true)}`;
  const label = (r: SeohakRow, right?: boolean) => (
    <span className={`inline-flex items-center gap-1 min-w-0 ${right ? "flex-row-reverse" : ""}`}>
      <Logo r={r} size={16} />
      <span className={`min-w-0 leading-[1.05] ${right ? "text-right" : ""}`}>
        <span className="block truncate font-bold text-gray-800">{r.t ?? r.n.split(" ")[0]}{r.lev && <LevBadge k={r.lev} />}</span>
        <span className="block truncate text-[9.5px] font-normal text-gray-500">{koOf(r)}</span>
      </span>
    </span>
  );
  return (
    <div className="min-w-0">
      <div className="flex items-center text-xs font-bold mb-1">
        <span className="text-blue-600">◀ 순매도</span>
        <span className="mx-auto text-[10px] font-normal text-gray-400">같은 눈금</span>
        <span className="text-rose-600">순매수 ▶</span>
      </div>
      <div className="space-y-[3px]">
        {Array.from({ length: Math.max(b.length, s.length) }, (_, i) => (
          <div key={i} className="grid grid-cols-2 gap-1 items-center text-[11px] tabular-nums">
            {/* 왼쪽 — 막대가 가운데에서 왼쪽으로 */}
            <div className="flex items-center justify-end gap-1 min-w-0" title={s[i] ? tip(s[i]) : undefined}>
              {s[i] && <>
                <span className="w-[92px] shrink-0">{label(s[i])}</span>
                <span className="relative flex-1 h-5 min-w-[30px]">
                  <span className="absolute right-0 top-0 h-full rounded-l bg-blue-500/75" style={{ width: `${(-s[i].net / max) * 100}%` }} />
                  {/* 금액은 막대 끝 바깥(짧은 막대에 겹치지 않게), 긴 막대는 안쪽 */}
                  <span className={`absolute top-0 h-full flex items-center text-[10px] font-bold whitespace-nowrap ${-s[i].net / max > 0.7 ? "text-white" : "text-blue-700"}`}
                        style={-s[i].net / max > 0.7 ? { right: 4 } : { right: `calc(${(-s[i].net / max) * 100}% + 3px)` }}>{fmtUsdKr(s[i].net, true)}</span>
                </span>
              </>}
            </div>
            {/* 오른쪽 — 가운데에서 오른쪽으로 */}
            <div className="flex items-center gap-1 min-w-0" title={b[i] ? tip(b[i]) : undefined}>
              {b[i] && <>
                <span className="relative flex-1 h-5 min-w-[30px]">
                  <span className="absolute left-0 top-0 h-full rounded-r bg-rose-500/75" style={{ width: `${(b[i].net / max) * 100}%` }} />
                  <span className={`absolute top-0 h-full flex items-center text-[10px] font-bold whitespace-nowrap ${b[i].net / max > 0.7 ? "text-white" : "text-rose-700"}`}
                        style={b[i].net / max > 0.7 ? { left: 4 } : { left: `calc(${(b[i].net / max) * 100}% + 3px)` }}>{fmtUsdKr(b[i].net, true)}</span>
                </span>
                <span className="w-[92px] shrink-0 flex justify-end">{label(b[i], true)}</span>
              </>}
            </div>
          </div>
        ))}
      </div>
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
  const W = 300, H = 90, mid = 62, bw = W / days.length;
  const maxBull = Math.max(0.3, ...shares), maxBear = Math.max(0.05, ...days.map(bearShare));
  return (
    <div className="min-w-0">
      <div className="text-xs font-bold text-amber-700">🎢 레버리지 쏠림</div>
      {/* 무엇을 그린 그래프인지 먼저(사용자 2026-11-03 "그래프 설명?") */}
      <div className="text-[10.5px] text-gray-600 leading-snug mb-1">
        서학개미가 그날 산 돈 가운데 <b>2·3배 레버리지 ETF</b>(TQQQ·SOXL 등)에 들어간 비율입니다. 높을수록 개인이 빚내듯 크게 베팅한 날이에요.
      </div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-xl font-black tabular-nums text-amber-700">{Math.round(now * 100)}%</span>
        <span className={`px-1 rounded border text-[10.5px] font-bold ${verdict.c}`}>{verdict.t}</span>
        <span className="text-[10.5px] text-gray-500">평소 {Math.round(avg * 100)}% · {mdOf(last.date)} 결제</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28 mt-1" preserveAspectRatio="none">
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
      <div className="flex justify-between text-[9.5px] text-gray-400 tabular-nums -mt-0.5">
        <span>{mdOf(days[0].date)}</span><span>{mdOf(days[Math.floor(days.length / 2)].date)}</span><span>{mdOf(last.date)}</span>
      </div>
      {!compact && <div className="text-[10.5px] text-gray-600 leading-snug">{verdict.d}</div>}
      {last.top.length > 0 && (
        <div className="text-[10.5px] text-gray-500 leading-snug">그날 많이 거래: {last.top.map(t => `${t.t} ${fmtUsdKr(t.net, true)}`).join(" · ")}</div>
      )}
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-gray-500 leading-snug mt-0.5">
        <span><i className="inline-block w-2 h-2 mr-0.5 align-middle bg-amber-400" />위 막대 = 하루 레버리지 매수 비중</span>
        <span><i className="inline-block w-2 h-2 mr-0.5 align-middle bg-amber-600" />진한 막대 = 가장 최근 결제일</span>
        <span><i className="inline-block w-2 h-2 mr-0.5 align-middle bg-sky-400" />아래 막대 = 인버스(하락 베팅) 매수 비중</span>
        <span><i className="inline-block w-3 border-t border-dashed border-amber-500 mr-0.5 align-middle" />점선 = 30일 평균</span>
      </div>
      <div className="text-[9.5px] text-gray-400 leading-snug">판정은 최근 30결제일 중 오늘이 몇 번째로 높은가 — 상위 10% 과열 · 30% 높음 · 하위 20% 식음. 막대에 마우스를 올리면 그날 숫자</div>
    </div>
  );
}

/** 🐜 지수(서학개미) 페이지 — 보유 비중 트리맵(위 전체 폭) + 순매수·순매도 나비 막대 + 레버리지 쏠림(사용자 2026-11-03 "별도 페이지", "그래프로") */
export function SeohakPage({ compact }: { compact?: boolean }) {
  const f = useSeohak();
  const [per, setPer] = useState<"week" | "day">("week");
  if (!f) return <div className="p-6 text-center text-sm text-gray-400">서학개미 자료를 불러오는 중…</div>;
  const src = per === "week" ? f.week : f.day;
  const n = compact ? 12 : 12;
  // 트리맵 색 — 이번 주(1주) 순매매. 순매수 상위·매도 상위 두 목록을 합친다(둘 다 50위까지라 빠진 종목은 회색)
  const buys = src.net.filter(r => r.net > 0), sells = netSellers(src.sell);
  const perLabel = per === "week" ? `${mdOf(f.meta.weekFrom)}~${mdOf(f.meta.setlDate)}` : mdOf(f.meta.setlDate);
  const card = "pg-box relative rounded-xl border border-gray-300 bg-white p-2.5";
  return (
    <div className="space-y-3">
      {/* PC: 왼쪽 = 보유 트리맵 한 화면 가득, 오른쪽 = 순매수·순매도 + 레버리지 쏠림 위아래(사용자 2026-11-03) */}
      <div className={`grid gap-3 items-start ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px]"}`}>
        <div className={card}>
          <HoldTreemap hold={f.hold} week={f.week} height={compact ? 360 : Math.max(560, (typeof window !== "undefined" ? window.innerHeight : 900) - 200)} />
          <div className="text-[10px] text-gray-400 mt-0.5">보유 {mdOf(f.meta.holdDate)} 기준 · 전주 {mdOf(f.meta.holdPrevDate)} 대비</div>
        </div>
        <div className="space-y-3 min-w-0">
          <div className={card}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-gray-700">⇄ 순매수·순매도 상위</span>
              <span className="text-[10.5px] text-gray-500">{perLabel} 결제</span>
              <span className="ml-auto inline-flex rounded border border-gray-300 overflow-hidden text-[11px]">
                {([["week", "1주"], ["day", "하루"]] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setPer(v)} className={`px-1.5 ${per === v ? "bg-gray-700 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>{l}</button>
                ))}
              </span>
            </div>
            <FlowButterfly buys={buys} sells={sells} n={n} />
          </div>
          <div className={`${card} border-amber-200 bg-amber-50/40`}><LevPanel compact={compact} /></div>
        </div>
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
