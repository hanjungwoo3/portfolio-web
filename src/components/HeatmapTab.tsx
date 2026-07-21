// KOSPI/KOSDAQ 히트맵 — TradingView scanner 데이터를 squarified 트리맵으로 렌더.
//   섹터로 그룹핑 → 종목 타일(크기=시총/거래량, 색=등락률 한국식 빨강+/파랑−).
//   scanner.tradingview.com 이 워커 화이트리스트에 없으면(403) 안내 + 원본 링크 폴백.
import { useState, useRef, useLayoutEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrHeatmap, heatmapTradingViewUrl, ProxyHostError,
  HEATMAP_SOURCE_LABEL, type HeatmapSource, type HeatmapItem,
} from "../lib/api";
import { squarify } from "../lib/treemap";

const SOURCES: HeatmapSource[] = ["kospi200", "kospi", "kosdaq150", "kosdaq", "all"];
type SizeMode = "marketCap" | "volume";

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

export function HeatmapTab() {
  const [source, setSource] = useState<HeatmapSource>("kospi200");
  const [sizeMode, setSizeMode] = useState<SizeMode>("marketCap");
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

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
            {h.sec}
          </div>
        ))}

        {/* 종목 타일 */}
        {layout.stocks.map(t => {
          const showLabel = t.w > 34 && t.h > 22;
          const small = t.w < 60 || t.h < 40;
          return (
            <div key={`${t.it.code}`}
                 title={`${t.it.name} (${t.it.code}) ${fmtPct(t.it.changePct)}`}
                 className="absolute flex flex-col items-center justify-center overflow-hidden text-white"
                 style={{
                   left: t.x + 0.5, top: t.y + 0.5,
                   width: Math.max(0, t.w - 1), height: Math.max(0, t.h - 1),
                   background: heatColor(t.it.changePct),
                 }}>
              {showLabel && (
                <>
                  <span className={`font-semibold leading-none truncate max-w-full px-0.5 ${small ? "text-[8px]" : "text-[11px]"}`}>
                    {t.it.code}
                  </span>
                  <span className={`leading-none ${small ? "text-[7px]" : "text-[10px]"}`}>{fmtPct(t.it.changePct)}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HeatmapTab;
