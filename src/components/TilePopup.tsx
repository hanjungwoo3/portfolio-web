// 종목 묶음 타일 팝업 — 업종 한눈에의 칸 이름(기판·전공정…)을 누르면 그 칸 종목만 타일로(사용자 2026-11-10 "기판을 클릭하면 관련 종목만 히트맵의 타일 보기로").
//   openTilePopup(lib 이벤트) → App·Mobile 최상위의 TilePopupHost 하나가 연다.
//   시세: 국내 = 토스(카드와 같은 기준), 미국 = 토스(심볼), 로고·시총 = TradingView. 그 밖(일본 등)은 넘겨받은 등락률.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTossPrices, fetchTossUsPricesBySymbol, fetchHeatmapForTickers } from "../lib/api";
import { dayChangePct } from "../lib/format";
import { useEscClose } from "../lib/useEscClose";
import { HeatTiles, TileSortToggle, type TileSort } from "./HeatTiles";
import { OPEN_TILE_POPUP, type TilePopupReq } from "../lib/tilePopupNav";


const krCode = (sym: string) => (/^[\dA-Za-z]{6}\.(KS|KQ)$/.test(sym) ? sym.slice(0, 6) : /^[\dA-Za-z]{6}$/.test(sym) && /\d/.test(sym) ? sym : null);
const usSym = (sym: string) => (/^[A-Z][A-Z.]{0,6}$/.test(sym) ? sym : null);

function TilePopup({ req, onClose }: { req: TilePopupReq; onClose: () => void }) {
  useEscClose(true, onClose);
  const [sort, setSort] = useState<TileSort>("cap");
  const kr = req.items.map(i => krCode(i.sym)).filter((x): x is string => !!x);
  const us = req.items.map(i => usSym(i.sym)).filter((x): x is string => !!x);
  const krQ = useQuery({ queryKey: ["tile-pop-kr", kr.join(",")], queryFn: () => fetchTossPrices(kr), enabled: kr.length > 0, staleTime: 20_000, refetchInterval: 60_000 });
  const usQ = useQuery({ queryKey: ["tile-pop-us", us.join(",")], queryFn: () => fetchTossUsPricesBySymbol(us), enabled: us.length > 0, staleTime: 20_000, refetchInterval: 60_000 });
  const tvQ = useQuery({ queryKey: ["holdings-heat-tv", [...kr, ...us].join(",")], queryFn: () => fetchHeatmapForTickers([...kr, ...us]), enabled: kr.length + us.length > 0, staleTime: 5 * 60_000, retry: 1 });
  const krBy = new Map((krQ.data ?? []).map(p => [p.ticker, p]));
  const usBy = new Map((usQ.data ?? []).map(p => [p.ticker, p]));
  const tiles = req.items.map(i => {
    const k = krCode(i.sym), u = usSym(i.sym), code = k ?? u ?? i.sym;
    const p = k ? krBy.get(k) : u ? usBy.get(u) : undefined;
    const tv = tvQ.data?.get(code);
    // 정규장·장외를 업종 표가 넘겨줬으면 그것(카드 배지와 같은 꼴), 아니면 지금 시세
    const hasReg = i.reg != null;
    // dim = 업종 표와 같은 흐림 판정(막대 회색)
    return { code, name: i.name, kr: !!k, lead: !k, dim: !!i.dim, ext: hasReg ? (i.aft ?? null) : null, extLabel: i.ses,
             pct: hasReg ? i.reg! : p ? (dayChangePct(p) ?? i.pct ?? null) : (i.pct ?? null), price: p?.price ?? null, cap: tv ? (tv.marketCap || tv.aum) : undefined, logoid: tv?.logoid };
  });
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white shadow-xl w-full max-w-4xl rounded-t-xl sm:rounded-lg max-h-[90vh] flex flex-col overflow-hidden">
        <header className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2">
          <b className="text-[15px] text-gray-800">🧩 {req.title}</b>
          <span className="text-xs text-gray-500">{req.items.length}종목 · 타일</span>
          <span className="ml-auto"><TileSortToggle sort={sort} onSort={setSort} /></span>
          <button onClick={onClose} className="ml-2 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </header>
        <div className="p-3 overflow-y-auto">
          <HeatTiles tiles={tiles} sort={sort} cols="grid-cols-2 sm:grid-cols-3 md:grid-cols-4" />
        </div>
      </div>
    </div>
  );
}

export function TilePopupHost() {
  const [req, setReq] = useState<(TilePopupReq & { n: number }) | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<TilePopupReq>).detail; if (d) setReq(r => ({ ...d, n: (r?.n ?? 0) + 1 })); };
    window.addEventListener(OPEN_TILE_POPUP, h);
    return () => window.removeEventListener(OPEN_TILE_POPUP, h);
  }, []);
  return req ? <TilePopup key={req.n} req={req} onClose={() => setReq(null)} /> : null;
}
