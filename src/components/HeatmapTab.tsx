// KOSPI/KOSDAQ 히트맵 — TradingView scanner 데이터를 squarified 트리맵으로 렌더.
//   섹터로 그룹핑 → 종목 타일(크기=시총/거래량, 색=등락률 한국식 빨강+/파랑−).
//   scanner.tradingview.com 이 워커 화이트리스트에 없으면(403) 안내 + 원본 링크 폴백.
import { useState, useRef, useLayoutEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrHeatmap, heatmapTradingViewUrl, heatmapLogoUrl, ProxyHostError,
  HEATMAP_SOURCE_LABEL, type HeatmapSource, type HeatmapItem,
} from "../lib/api";
import { squarify } from "../lib/treemap";

const SOURCES: HeatmapSource[] = ["kospi200", "kospi", "kosdaq150", "kosdaq", "all"];
type SizeMode = "marketCap" | "volume";

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

// 등락률 → 한국식 색(빨강 상승 / 파랑 하락). ±3% 에서 포화.
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
function heatColor(pct: number): string {
  const t = Math.max(-1, Math.min(1, pct / 3));
  const g = [71, 85, 105];   // slate-600 (보합)
  if (t >= 0) { const r = [190, 30, 45]; const k = t; return `rgb(${mix(g[0], r[0], k)},${mix(g[1], r[1], k)},${mix(g[2], r[2], k)})`; }
  const b = [29, 78, 216];   // blue-700
  const k = -t; return `rgb(${mix(g[0], b[0], k)},${mix(g[1], b[1], k)},${mix(g[2], b[2], k)})`;
}
const fmtPct = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
// 시가총액(원) → 조/억 축약
function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조원`;
  if (v >= 1e8) return `${Math.round(v / 1e8).toLocaleString()}억원`;
  return `${Math.round(v).toLocaleString()}원`;
}

export function HeatmapTab() {
  const [source, setSource] = useState<HeatmapSource>("kospi200");
  const [sizeMode, setSizeMode] = useState<SizeMode>("volume");
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

  const q = useQuery({
    queryKey: ["kr-heatmap", source],
    queryFn: () => fetchKrHeatmap(source, source === "all" || source === "kosdaq" ? 700 : 400),
    staleTime: 60_000, refetchOnWindowFocus: false, retry: false,
  });

  const sizeVal = (it: HeatmapItem) => (sizeMode === "marketCap" ? it.marketCap : it.volume) || 0;

  // 2단계 트리맵 — 섹터 그룹 → 종목. 섹터 헤더 공간 확보.
  const layout = useMemo(() => {
    const items = q.data ?? [];
    if (!items.length || size.w < 40 || size.h < 40) return { stocks: [], headers: [] as { sec: string; x: number; y: number; w: number }[] };
    const bySector = new Map<string, HeatmapItem[]>();
    for (const it of items) { const a = bySector.get(it.sector); if (a) a.push(it); else bySector.set(it.sector, [it]); }
    const sectorInputs = [...bySector].map(([sec, list]) => ({
      item: { sec, list }, value: list.reduce((s, x) => s + sizeVal(x), 0),
    }));
    const sectorTiles = squarify(sectorInputs, { x: 0, y: 0, w: size.w, h: size.h });
    const stocks: { it: HeatmapItem; x: number; y: number; w: number; h: number }[] = [];
    const headers: { sec: string; x: number; y: number; w: number }[] = [];
    for (const st of sectorTiles) {
      const head = st.h > 34 && st.w > 46 ? 13 : 0;
      if (head) headers.push({ sec: st.item.sec, x: st.x, y: st.y, w: st.w });
      const inner = { x: st.x, y: st.y + head, w: st.w, h: st.h - head };
      const cells = squarify(st.item.list.map(it => ({ item: it, value: sizeVal(it) })), inner);
      for (const c of cells) stocks.push({ it: c.item, x: c.x, y: c.y, w: c.w, h: c.h });
    }
    return { stocks, headers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, size.w, size.h, sizeMode]);

  const isHostErr = q.error instanceof ProxyHostError;

  return (
    <div className="p-2">
      {/* 컨트롤 */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
          {SOURCES.map(s => (
            <button key={s} onClick={() => setSource(s)}
                    className={`px-2.5 py-1 font-medium transition ${source === s ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {HEATMAP_SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
          {(["marketCap", "volume"] as SizeMode[]).map(m => (
            <button key={m} onClick={() => setSizeMode(m)}
                    className={`px-2.5 py-1 font-medium transition ${sizeMode === m ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {m === "marketCap" ? "크기=시총" : "크기=거래량"}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400">색=등락률(빨강▲/파랑▼) · 그룹=섹터 · {q.data?.length ?? 0}종목</span>
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

        {/* 종목 타일 — 로고 아이콘 + 코드 + 등락%. hover 시 흰 아웃라인 강조 + 커스텀 툴팁. */}
        {layout.stocks.map(t => {
          const showLabel = t.w > 30 && t.h > 20;
          const big = t.w >= 66 && t.h >= 50;
          const logoSize = t.w >= 62 && t.h >= 52 ? 30 : t.w >= 40 && t.h >= 34 ? 18 : 0;
          return (
            <div key={t.it.code}
                 onMouseMove={e => setHover({ it: t.it, x: e.clientX, y: e.clientY })}
                 onMouseLeave={() => setHover(null)}
                 className="absolute flex flex-col items-center justify-center overflow-hidden text-white cursor-default
                            hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-white hover:z-10 hover:brightness-110"
                 style={{
                   left: t.x + 0.5, top: t.y + 0.5,
                   width: Math.max(0, t.w - 1), height: Math.max(0, t.h - 1),
                   background: heatColor(t.it.changePct),
                 }}>
              {logoSize > 0 && t.it.logoid && (
                <img src={heatmapLogoUrl(t.it.logoid)} alt="" loading="lazy"
                     onError={e => { e.currentTarget.style.display = "none"; }}
                     className="rounded-full bg-white/90 object-contain mb-0.5 pointer-events-none"
                     style={{ width: logoSize, height: logoSize, padding: 1 }} />
              )}
              {showLabel && (
                <>
                  {/* 공간 넉넉하면 회사명(영문)도 — 코드만으론 알아보기 어려움 */}
                  {t.w >= 84 && t.h >= 60 && (
                    <span className="font-semibold leading-tight text-center max-w-full px-1 pointer-events-none text-[10px] line-clamp-2">
                      {t.it.name}
                    </span>
                  )}
                  <span className={`font-semibold leading-none truncate max-w-full px-0.5 pointer-events-none ${big ? "text-[11px]" : "text-[8px]"}`}>
                    {t.it.code}
                  </span>
                  <span className={`leading-none pointer-events-none ${big ? "text-[10px]" : "text-[7px]"}`}>{fmtPct(t.it.changePct)}</span>
                </>
              )}
            </div>
          );
        })}
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
            <span className="font-bold truncate max-w-[180px]">{hover.it.name}</span>
          </div>
          <div className="text-gray-400 text-[10px] mb-1">{hover.it.code} · {sectorKr(hover.it.sector)}</div>
          <div className="tabular-nums space-y-0.5">
            <div className="flex justify-between gap-4">
              <span className="text-gray-400">등락</span>
              <span className="font-bold" style={{ color: hover.it.changePct >= 0 ? "#f87171" : "#60a5fa" }}>{fmtPct(hover.it.changePct)}</span>
            </div>
            <div className="flex justify-between gap-4"><span className="text-gray-400">현재가</span><span>{hover.it.close.toLocaleString()}원</span></div>
            <div className="flex justify-between gap-4"><span className="text-gray-400">거래량</span><span>{hover.it.volume.toLocaleString()}</span></div>
            <div className="flex justify-between gap-4"><span className="text-gray-400">시총</span><span>{fmtCap(hover.it.marketCap)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HeatmapTab;
