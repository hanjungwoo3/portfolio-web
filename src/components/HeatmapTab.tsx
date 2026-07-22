// KOSPI/KOSDAQ 히트맵 — TradingView scanner 데이터를 squarified 트리맵으로 렌더.
//   섹터로 그룹핑 → 종목 타일(크기=시총/거래량, 색=등락률 한국식 빨강+/파랑−).
//   scanner.tradingview.com 이 워커 화이트리스트에 없으면(403) 안내 + 원본 링크 폴백.
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrHeatmap, heatmapTradingViewUrl, heatmapLogoUrl, heatmapRegion, ProxyHostError,
  HEATMAP_SOURCE_LABEL, type HeatmapSource, type HeatmapItem,
} from "../lib/api";
import { squarify } from "../lib/treemap";
import { loadKrNameDict, getRuntimeNames, fetchMissingKrNames } from "../lib/krStockNames";
import { isMarketOpen } from "../lib/format";
import { reportRefresh } from "../lib/lastRefresh";
import { getEffectivePollMs } from "../lib/proxyConfig";

const KR_SOURCES: HeatmapSource[] = ["kospi200", "kospi", "kosdaq150", "kosdaq", "all"];
const US_SOURCES: HeatmapSource[] = ["us_sp500", "us_ndx", "us_tech", "us_nasdaq", "us_dow", "us_dowcomp",
  "us_dowtrans", "us_dowutil", "us_kbwbank", "us_r1000", "us_r2000", "us_r3000", "us_all"];
// 종목 많은 소스는 상위 N만(트리맵 가독성·부하)
const SOURCE_LIMIT: Partial<Record<HeatmapSource, number>> = {
  all: 700, kosdaq: 700, us_tech: 500, us_nasdaq: 1000, us_r2000: 1000, us_r3000: 1000, us_all: 1000,
};

// 크기 기준
type SizeMode = "marketCap" | "volume" | "value";
const SIZE_OPTS: { key: SizeMode; label: string }[] = [
  { key: "marketCap", label: "시가총액" },
  { key: "volume", label: "거래량" },
  { key: "value", label: "거래대금" },
];
// 색 기준 — 등락(1일) + 기간 수익률. 각 기준별 색 포화 범위(%)가 달라 강도 스케일도 다름.
type ColorMode = "change" | "w" | "m1" | "m3" | "m6" | "ytd" | "y";
const COLOR_OPTS: { key: ColorMode; label: string; sat: number; field: (it: HeatmapItem) => number }[] = [
  { key: "change", label: "1일 등락률", sat: 3, field: it => it.changePct },
  { key: "w", label: "1주 수익률", sat: 8, field: it => it.perfW },
  { key: "m1", label: "1개월 수익률", sat: 15, field: it => it.perf1M },
  { key: "m3", label: "3개월 수익률", sat: 25, field: it => it.perf3M },
  { key: "m6", label: "6개월 수익률", sat: 30, field: it => it.perf6M },
  { key: "ytd", label: "연초대비(YTD)", sat: 35, field: it => it.perfYTD },
  { key: "y", label: "1년 수익률", sat: 40, field: it => it.perfY },
];
// 그룹 기준
type GroupMode = "sector" | "none";

// TradingView 섹터(영문) → 한글
const SECTOR_KR: Record<string, string> = {
  "Commercial Services": "상업 서비스",
  "Communications": "커뮤니케이션",
  "Consumer Durables": "소비자 내구재",
  "Consumer Non-Durables": "소비재 비내구재",
  "Consumer Services": "소비자 서비스",
  "Distribution Services": "유통 서비스",
  "Electronic Technology": "전자 기술",
  "Energy Minerals": "에너지 광물",
  "Finance": "금융",
  "Health Services": "의료 서비스",
  "Health Technology": "의료 기술",
  "Industrial Services": "산업 서비스",
  "Miscellaneous": "기타",
  "Non-Energy Minerals": "비에너지 광물",
  "Process Industries": "공정 산업",
  "Producer Manufacturing": "생산자 제조",
  "Retail Trade": "소매업",
  "Technology Services": "기술 서비스",
  "Transportation": "운송",
  "Utilities": "유틸리티",
};
const sectorKr = (s: string) => SECTOR_KR[s] ?? s;

// 값 → 한국식 색(빨강 상승 / 파랑 하락). sat(%) 에서 포화(색 기준별로 다름).
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
function heatColor(pct: number, sat = 3): string {
  const t = Math.max(-1, Math.min(1, pct / sat));
  const g = [71, 85, 105];   // slate-600 (보합)
  if (t >= 0) { const r = [190, 30, 45]; const k = t; return `rgb(${mix(g[0], r[0], k)},${mix(g[1], r[1], k)},${mix(g[2], r[2], k)})`; }
  const b = [29, 78, 216];   // blue-700
  const k = -t; return `rgb(${mix(g[0], b[0], k)},${mix(g[1], b[1], k)},${mix(g[2], b[2], k)})`;
}
const fmtPct = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
// 금액 축약 — 한국은 원(조/억), 미국은 달러(T/B/M)
function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조원`;
  if (v >= 1e8) return `${Math.round(v / 1e8).toLocaleString()}억원`;
  return `${Math.round(v).toLocaleString()}원`;
}
function fmtCapUsd(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}조`;
  if (v >= 1e8) return `$${Math.round(v / 1e8).toLocaleString()}억`;
  return `$${Math.round(v).toLocaleString()}`;
}

export function HeatmapTab() {
  const [source, setSource] = useState<HeatmapSource>("kospi200");
  const [sizeMode, setSizeMode] = useState<SizeMode>("marketCap");
  const [colorMode, setColorMode] = useState<ColorMode>("change");
  const [groupMode, setGroupMode] = useState<GroupMode>("sector");
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // 커스텀 호버 툴팁 — title 은 브라우저 지연이 있어 느림. 마우스 따라다니는 레이어로 즉시 표시.
  const [hover, setHover] = useState<{ it: HeatmapItem; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const isKr = heatmapRegion(source) === "kr";   // 한글명은 한국 종목만(미국은 영문 회사명)
  const marketOpen = isMarketOpen(isKr ? "KR" : "US");   // 표시용(장중/장마감 라벨)
  // 폴링 주기는 전역과 동일(getEffectivePollMs) — 상단 시계 카운트다운과 맞아 '0초 멈춤' 방지.
  //   수동 모드(0)면 폴링 안 함. 보유탭처럼 장마감에도 폴링(refetchIntervalInBackground).
  const pollMs = getEffectivePollMs();
  const q = useQuery({
    queryKey: ["kr-heatmap", source],
    queryFn: () => fetchKrHeatmap(source, SOURCE_LIMIT[source] ?? 400),
    staleTime: 0, refetchOnWindowFocus: false, retry: false,
    refetchInterval: pollMs > 0 ? pollMs : false,
    refetchIntervalInBackground: true,
  });
  // 갱신 상대시각 표시용 1초 tick
  const [, tick] = useState(0);
  useLayoutEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const ago = q.dataUpdatedAt ? Math.max(0, Math.round((Date.now() - q.dataUpdatedAt) / 1000)) : null;
  // 상단 갱신 시계(전역 lastRefresh)에 히트맵 폴링 시각도 반영 — 히트맵 탭에서 시계 멈추던 문제 해결.
  useEffect(() => { if (q.dataUpdatedAt > 0) reportRefresh(q.dataUpdatedAt); }, [q.dataUpdatedAt]);

  const sizeVal = (it: HeatmapItem) =>
    (sizeMode === "marketCap" ? it.marketCap : sizeMode === "value" ? it.valueTraded : it.volume) || 0;
  const colorDef = COLOR_OPTS.find(o => o.key === colorMode)!;
  const colorOf = (it: HeatmapItem) => heatColor(colorDef.field(it), colorDef.sat);

  // 한글 종목명 — 정적 사전(0콜) + 런타임 캐시. 사전에 없는 코드만 폴백 조회.
  const dictQ = useQuery({ queryKey: ["kr-name-dict"], queryFn: loadKrNameDict, staleTime: Infinity, refetchOnWindowFocus: false, enabled: isKr });
  const missCodes = useMemo(() => {
    if (!isKr) return [];
    const dict = dictQ.data; if (!dict) return [];
    const runtime = getRuntimeNames();
    return (q.data ?? []).map(it => it.code).filter(c => !dict[c] && !runtime[c]);
  }, [isKr, dictQ.data, q.data]);
  const missQ = useQuery({
    queryKey: ["kr-name-miss", missCodes.join(",")],
    queryFn: () => fetchMissingKrNames(missCodes),
    enabled: missCodes.length > 0, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  // 미국은 영문 회사명(scanner name) 그대로, 한국은 한글 사전
  const krName = (it: HeatmapItem): string =>
    isKr ? (dictQ.data?.[it.code] ?? getRuntimeNames()[it.code] ?? missQ.data?.[it.code] ?? it.name) : it.name;

  // 트리맵 — 그룹=섹터면 2단계(섹터→종목), 그룹없음이면 종목만 1단계.
  const layout = useMemo(() => {
    const items = q.data ?? [];
    const empty = { stocks: [] as { it: HeatmapItem; x: number; y: number; w: number; h: number }[], headers: [] as { sec: string; x: number; y: number; w: number }[] };
    if (!items.length || size.w < 40 || size.h < 40) return empty;
    const stocks: { it: HeatmapItem; x: number; y: number; w: number; h: number }[] = [];
    const headers: { sec: string; x: number; y: number; w: number }[] = [];
    if (groupMode === "none") {
      const cells = squarify(items.map(it => ({ item: it, value: sizeVal(it) })), { x: 0, y: 0, w: size.w, h: size.h });
      for (const c of cells) stocks.push({ it: c.item, x: c.x, y: c.y, w: c.w, h: c.h });
      return { stocks, headers };
    }
    const bySector = new Map<string, HeatmapItem[]>();
    for (const it of items) { const a = bySector.get(it.sector); if (a) a.push(it); else bySector.set(it.sector, [it]); }
    const sectorInputs = [...bySector].map(([sec, list]) => ({
      item: { sec, list }, value: list.reduce((s, x) => s + sizeVal(x), 0),
    }));
    const sectorTiles = squarify(sectorInputs, { x: 0, y: 0, w: size.w, h: size.h });
    for (const st of sectorTiles) {
      const head = st.h > 34 && st.w > 46 ? 13 : 0;
      if (head) headers.push({ sec: st.item.sec, x: st.x, y: st.y, w: st.w });
      const inner = { x: st.x, y: st.y + head, w: st.w, h: st.h - head };
      const cells = squarify(st.item.list.map(it => ({ item: it, value: sizeVal(it) })), inner);
      for (const c of cells) stocks.push({ it: c.item, x: c.x, y: c.y, w: c.w, h: c.h });
    }
    return { stocks, headers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, size.w, size.h, sizeMode, groupMode]);

  const isHostErr = q.error instanceof ProxyHostError;

  return (
    <div className="p-2">
      {/* 컨트롤 */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <label className="flex items-center gap-1 text-xs">
          <span className="text-gray-400">지수</span>
          <select value={source} onChange={e => setSource(e.target.value as HeatmapSource)}
                  className="border border-gray-300 rounded px-1.5 py-1 bg-white font-semibold text-gray-800">
            <optgroup label="🇰🇷 한국">
              {KR_SOURCES.map(s => <option key={s} value={s}>{HEATMAP_SOURCE_LABEL[s]}</option>)}
            </optgroup>
            <optgroup label="🇺🇸 미국">
              {US_SOURCES.map(s => <option key={s} value={s}>{HEATMAP_SOURCE_LABEL[s]}</option>)}
            </optgroup>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <span className="text-gray-400">크기</span>
          <select value={sizeMode} onChange={e => setSizeMode(e.target.value as SizeMode)}
                  className="border border-gray-300 rounded px-1.5 py-1 bg-white font-medium text-gray-700">
            {SIZE_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <span className="text-gray-400">색</span>
          <select value={colorMode} onChange={e => setColorMode(e.target.value as ColorMode)}
                  className="border border-gray-300 rounded px-1.5 py-1 bg-white font-medium text-gray-700">
            {COLOR_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <span className="text-gray-400">그룹</span>
          <select value={groupMode} onChange={e => setGroupMode(e.target.value as GroupMode)}
                  className="border border-gray-300 rounded px-1.5 py-1 bg-white font-medium text-gray-700">
            <option value="sector">섹터</option>
            <option value="none">그룹없음</option>
          </select>
        </label>
        <span className="text-[10px] text-gray-400">색: 빨강▲/파랑▼ · {q.data?.length ?? 0}종목</span>
        {ago != null && (
          <span className="text-[10px] text-gray-400 flex items-center gap-1">
            <span className={marketOpen ? "text-emerald-500" : "text-gray-300"}>●</span>
            {q.isFetching ? "갱신 중…" : `${ago}초 전`}{marketOpen ? " · 장중" : " · 장마감"}
          </span>
        )}
        <a href={heatmapTradingViewUrl(source)} target="_blank" rel="noopener noreferrer"
           className="text-[10px] text-blue-600 hover:underline ml-auto">TradingView 원본 ↗</a>
      </div>

      {/* 트리맵 캔버스 */}
      <div ref={boxRef} className="relative w-full h-[72vh] min-h-[360px] bg-gray-100 rounded-lg overflow-hidden">
        {q.isLoading && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">불러오는 중…</div>}

        {isHostErr && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md bg-white rounded-lg border border-amber-300 p-4 text-sm text-gray-700 shadow">
              <div className="font-bold text-amber-700 mb-1.5">⚠️ 프록시 워커 설정 필요</div>
              <p className="text-xs leading-relaxed mb-3">
                히트맵 데이터(<code className="bg-gray-100 px-1 rounded">scanner.tradingview.com</code>)가 아직 프록시 워커 허용 목록에 없어요.
                워커의 <b>허용 호스트 목록</b>에 이 주소를 추가하고 재배포하면 여기에 바로 표시됩니다. (약 3분)
              </p>
              <div className="flex items-center gap-2">
                <a href="https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/ADD-HEATMAP-HOST.md"
                   target="_blank" rel="noopener noreferrer"
                   className="inline-block px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">
                  워커 수정 방법 보기 ↗
                </a>
                <a href={heatmapTradingViewUrl(source)} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                  또는 TradingView 원본
                </a>
              </div>
            </div>
          </div>
        )}

        {q.error && !isHostErr && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-gray-400">
            <span>데이터를 불러오지 못했어요.</span>
            <a href={heatmapTradingViewUrl(source)} target="_blank" rel="noopener noreferrer"
               className="text-blue-600 hover:underline text-xs">TradingView 원본 열기 ↗</a>
          </div>
        )}

        {/* 섹터 헤더 */}
        {layout.headers.map(h => (
          <div key={`h-${h.sec}-${Math.round(h.x)}-${Math.round(h.y)}`}
               className="absolute text-[9px] font-semibold text-gray-500 px-1 truncate pointer-events-none"
               style={{ left: h.x, top: h.y, width: h.w, height: 13, lineHeight: "13px" }}>
            {sectorKr(h.sec)}
          </div>
        ))}

        {/* 종목 타일 — 로고 + (회사명) + 코드 + 등락%. 폰트·로고는 타일 크기에 비례. hover 강조+툴팁. */}
        {layout.stocks.map(t => {
          const s = Math.min(t.w, t.h);                                   // 타일 짧은변 기준 스케일
          const logoSize = s >= 140 ? 54 : s >= 88 ? 42 : s >= 52 ? 30 : s >= 34 ? 18 : 0;
          const codeFs = s >= 190 ? 30 : s >= 140 ? 24 : s >= 100 ? 18 : s >= 66 ? 13 : s >= 42 ? 10 : (t.w > 30 && t.h > 18 ? 8 : 0);
          const nameFs = s >= 190 ? 18 : s >= 140 ? 15 : s >= 95 ? 12 : 0;   // 회사명은 공간 넉넉할 때만
          const pctFs = Math.max(7, Math.round(codeFs * 0.82));
          return (
            <div key={t.it.code}
                 onMouseMove={e => setHover({ it: t.it, x: e.clientX, y: e.clientY })}
                 onMouseLeave={() => setHover(null)}
                 className="absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden text-white cursor-default
                            hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-white hover:z-10 hover:brightness-110"
                 style={{
                   left: t.x + 0.5, top: t.y + 0.5,
                   width: Math.max(0, t.w - 1), height: Math.max(0, t.h - 1),
                   background: colorOf(t.it),
                 }}>
              {logoSize > 0 && t.it.logoid && (
                <img src={heatmapLogoUrl(t.it.logoid)} alt="" loading="lazy"
                     onError={e => { e.currentTarget.style.display = "none"; }}
                     className="rounded-full bg-white/90 object-contain pointer-events-none"
                     style={{ width: logoSize, height: logoSize, padding: 1 }} />
              )}
              {nameFs > 0 && (
                <span className="font-semibold leading-tight text-center max-w-full px-1 pointer-events-none line-clamp-2"
                      style={{ fontSize: nameFs }}>
                  {krName(t.it)}
                </span>
              )}
              {codeFs > 0 && (
                <>
                  <span className="font-semibold leading-none truncate max-w-full px-0.5 pointer-events-none" style={{ fontSize: codeFs }}>
                    {t.it.code}
                  </span>
                  <span className="leading-none pointer-events-none" style={{ fontSize: pctFs }}>{fmtPct(colorDef.field(t.it))}</span>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 옵션 설명 */}
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-gray-600">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
          <div className="font-bold text-gray-700 mb-1">📐 크기 (타일 크기 기준)</div>
          <ul className="space-y-0.5 leading-relaxed">
            <li><b>시가총액</b> — 회사 전체 가치(주가×주식수). 큰 기업일수록 타일이 큼</li>
            <li><b>거래량</b> — 오늘 거래된 주식 수. 활발히 거래된 종목이 큼</li>
            <li><b>거래대금</b> — 가격×거래량. 실제 돈이 많이 오간 종목이 큼</li>
          </ul>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
          <div className="font-bold text-gray-700 mb-1">🎨 색 (빨강▲상승 / 파랑▼하락)</div>
          <ul className="space-y-0.5 leading-relaxed">
            <li><b>1일 등락률</b> — 오늘 하루 등락</li>
            <li><b>1주~1년 수익률</b> — 그 기간 전 대비 주가 변화율(배당 아님). 장기 추세 파악용</li>
            <li><b>연초대비(YTD)</b> — 올해 1월 1일 대비 변화율</li>
            <li className="text-gray-400">기간이 길수록 색이 더 큰 변동에서 진해짐(스케일 자동)</li>
          </ul>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
          <div className="font-bold text-gray-700 mb-1">🗂️ 그룹 (배치 방식)</div>
          <ul className="space-y-0.5 leading-relaxed">
            <li><b>섹터</b> — 업종(전자기술·금융·생산자제조 등)별로 묶어 배치. 어느 업종이 강한지 한눈에</li>
            <li><b>그룹없음</b> — 업종 구분 없이 전체를 크기순으로 배치</li>
          </ul>
        </div>
      </div>

      {/* 커스텀 호버 툴팁 — 마우스 따라다니며 즉시 표시(title 지연 회피) */}
      {hover && (
        <div className="fixed z-[60] pointer-events-none bg-gray-900/95 text-white rounded-md shadow-lg px-2.5 py-1.5 text-xs leading-tight"
             style={{ left: Math.min(hover.x + 14, window.innerWidth - 210), top: hover.y + 14 }}>
          <div className="flex items-center gap-1.5 mb-1">
            {hover.it.logoid && (
              <img src={heatmapLogoUrl(hover.it.logoid)} alt="" className="w-4 h-4 rounded-full bg-white object-contain"
                   onError={e => { e.currentTarget.style.display = "none"; }} />
            )}
            <span className="font-bold truncate max-w-[180px]">{krName(hover.it)}</span>
          </div>
          <div className="text-gray-400 text-[10px] mb-1">{hover.it.code} · {sectorKr(hover.it.sector)}</div>
          <div className="tabular-nums space-y-0.5">
            <div className="flex justify-between gap-4">
              <span className="text-gray-400">{colorDef.label}</span>
              <span className="font-bold" style={{ color: colorDef.field(hover.it) >= 0 ? "#f87171" : "#60a5fa" }}>{fmtPct(colorDef.field(hover.it))}</span>
            </div>
            <div className="flex justify-between gap-4"><span className="text-gray-400">현재가</span><span>{isKr ? `${hover.it.close.toLocaleString()}원` : `$${hover.it.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span></div>
            <div className="flex justify-between gap-4"><span className="text-gray-400">거래량</span><span>{hover.it.volume.toLocaleString()}</span></div>
            <div className="flex justify-between gap-4"><span className="text-gray-400">거래대금</span><span>{isKr ? fmtCap(hover.it.valueTraded) : fmtCapUsd(hover.it.valueTraded)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-gray-400">시총</span><span>{isKr ? fmtCap(hover.it.marketCap) : fmtCapUsd(hover.it.marketCap)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HeatmapTab;
