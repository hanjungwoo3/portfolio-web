// 타일 보기 — 작은 칸에 로고·이름·등락률·값·시총(kospimap 증시 전광판처럼). 히트맵 탭·그룹 히트맵 팝업·업종 칸 팝업이 **한 벌**을 쓴다
//   (사용자 2026-11-10 "그룹의 히트맵도 타일 보기를 기본으로", "기판을 클릭하면 관련 종목만 히트맵의 타일 보기로").
//   맨 위 = 오른·내린 종목 수 막대 + [시총순 | 등락순]. 누르면 국내는 종목정보, 해외는 토스.
import { useMemo, useState } from "react";
import { heatmapLogoUrl } from "../lib/api";
import { openStockInfo } from "../lib/tickPopup";
import { openTossStock } from "../lib/toss";

export interface Tile {
  code: string; name: string;
  pct: number | null;          // 등락률(%) — 모르면 null
  price?: number | null;       // 현재가(국내 원·해외 달러)
  kr: boolean;                 // 국내 종목인가(값·시총 단위, 누르면 종목정보)
  cap?: number;                // 시총(국내 원 · 해외 달러)
  logoid?: string;             // TradingView 로고
  dim?: boolean;               // 흐림(장 안 열림·체결 멈춤)
}

const capText = (v: number | undefined, kr: boolean) => !v ? "" : kr
  ? (v >= 1e12 ? `${(v / 1e12).toFixed(v >= 1e14 ? 0 : 1)}조` : `${Math.round(v / 1e8).toLocaleString()}억`)
  : (v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : `$${Math.round(v / 1e9)}B`);

export function HeatTiles({ tiles, limit, cols = "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10", onOpen }: {
  tiles: Tile[];
  limit?: number;              // 많을 때 앞에서부터만(내려가면 더 — 부모가 늘린다)
  cols?: string;
  onOpen?: (t: Tile) => void;  // 기본 = 국내 종목정보 · 해외 토스
}) {
  const [sort, setSort] = useState<"cap" | "pct">("cap");
  const sorted = useMemo(() => [...tiles].sort((a, b) => sort === "cap" ? (b.cap ?? 0) - (a.cap ?? 0) : (b.pct ?? -1e9) - (a.pct ?? -1e9)), [tiles, sort]);
  const up = tiles.filter(t => (t.pct ?? 0) > 0).length, dn = tiles.filter(t => (t.pct ?? 0) < 0).length, fl = tiles.length - up - dn;
  const tot = Math.max(1, tiles.length);
  const open = onOpen ?? ((t: Tile) => (t.kr ? openStockInfo(t.code, t.name) : openTossStock(t.code)));
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 text-[12px] font-bold tabular-nums">
        <span className="text-rose-600">▲ {up}</span>
        <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-gray-200" title={`오른 종목 ${up} · 그대로 ${fl} · 내린 종목 ${dn}`}>
          <div className="bg-rose-400" style={{ width: `${(up / tot) * 100}%` }} />
          <div className="bg-gray-300" style={{ width: `${(fl / tot) * 100}%` }} />
          <div className="bg-blue-400" style={{ width: `${(dn / tot) * 100}%` }} />
        </div>
        <span className="text-blue-600">▼ {dn}</span>
        <span className="inline-flex rounded border border-gray-300 overflow-hidden text-[11px]">
          {(["cap", "pct"] as const).map(k => (
            <button key={k} onClick={() => setSort(k)} className={`px-2 py-0.5 ${sort === k ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>{k === "cap" ? "시총순" : "등락순"}</button>
          ))}
        </span>
      </div>
      <div className={`grid ${cols} gap-1.5`}>
        {sorted.slice(0, limit ?? sorted.length).map(t => {
          const pct = t.pct;
          const bg = pct == null ? "bg-gray-50 border-gray-200" : pct >= 3 ? "bg-rose-100 border-rose-300" : pct > 0 ? "bg-rose-50 border-rose-200" : pct <= -3 ? "bg-blue-100 border-blue-300" : pct < 0 ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200";
          return (
            <button key={t.code} type="button" title={`${t.name}${pct != null ? ` ${pct > 0 ? "+" : ""}${pct.toFixed(2)}%` : ""} · 누르면 ${t.kr ? "종목정보" : "토스"}`}
                    onClick={() => open(t)}
                    className={`pg-card text-left rounded-md border px-1.5 py-1 hover:brightness-95 ${bg} ${t.dim ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-1 min-w-0">
                {t.logoid && <img src={heatmapLogoUrl(t.logoid)} alt="" loading="lazy" className="w-4 h-4 rounded-full bg-white object-contain shrink-0" />}
                <b className="truncate text-[12px] text-gray-900">{t.name}</b>
                <span className={`ml-auto shrink-0 text-[12px] font-bold tabular-nums ${pct == null ? "text-gray-300" : pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-500"}`}>
                  {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-[10.5px] text-gray-500 tabular-nums">
                <span>{t.price == null || !(t.price > 0) ? "" : t.kr ? t.price.toLocaleString() : `$${t.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</span>
                <span>{capText(t.cap, t.kr)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
