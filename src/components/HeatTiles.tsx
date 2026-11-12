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
  ext?: number | null;         // 정규장 뒤(프리·애프터·NXT) 정규장 종가 대비 % — 있으면 등락률 아래 꼬리표
  extLabel?: string;           // 그 구간 이름(애프터·프리·데이…)
  lead?: boolean;              // 해외 대장주 — 따로 묶고 보라 테두리(업종 카드와 같은 표시, 사용자 2026-11-10 "해외는 별도로, 테두리")
}

const capText = (v: number | undefined, kr: boolean) => !v ? "" : kr
  ? (v >= 1e12 ? `${(v / 1e12).toFixed(v >= 1e14 ? 0 : 1)}조` : `${Math.round(v / 1e8).toLocaleString()}억`)
  : (v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : `$${Math.round(v / 1e9)}B`);

export type TileSort = "cap" | "pct";
/** 크게 보이는 값 — 장외(프리·애프터) 값이 있으면 그것(업종 한눈에 줄과 같은 규칙) */
const shownPct = (t: Tile) => t.ext ?? t.pct;
/** 시총순 | 등락순 단추 — HeatTiles 안쪽 또는 팝업 머리에서 같은 모양으로 */
export function TileSortToggle({ sort, onSort }: { sort: TileSort; onSort: (s: TileSort) => void }) {
  return (
    <span className="inline-flex rounded border border-gray-300 overflow-hidden text-[11px] font-bold">
      {(["cap", "pct"] as const).map(k => (
        <button key={k} onClick={() => onSort(k)} className={`px-2 py-0.5 ${sort === k ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>{k === "cap" ? "시총순" : "등락순"}</button>
      ))}
    </span>
  );
}

export function HeatTiles({ tiles, limit, cols = "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10", onOpen, sort: props_sort }: {
  tiles: Tile[];
  limit?: number;              // 많을 때 앞에서부터만(내려가면 더 — 부모가 늘린다)
  cols?: string;
  onOpen?: (t: Tile) => void;  // 기본 = 국내 종목정보 · 해외 토스
  sort?: TileSort;             // 바깥(팝업 머리)에서 정렬 단추를 들 때 — 주면 안쪽 단추를 숨긴다(사용자 2026-11-10 "시총순 등락순은 위로")
}) {
  const [sortIn, setSort] = useState<TileSort>("pct")   // 등락순 기본(사용자 2026-11-12);
  const outer = props_sort !== undefined;
  const sort = props_sort ?? sortIn;
  const sorted = useMemo(() => [...tiles].sort((a, b) => sort === "cap" ? (b.cap ?? 0) - (a.cap ?? 0) : (shownPct(b) ?? -1e9) - (shownPct(a) ?? -1e9)), [tiles, sort]);
  const hasLead = tiles.some(t => t.lead);
  // 오른·내린 종목 수 막대 — 해외 대장주가 섞이면 해외·국내 따로(사용자 2026-11-10 "상승 하락도 해외 국내 따로")
  //   길이 = 많은 쪽 종목 수를 100% 로(해외 1 · 국내 15 면 해외 막대는 1/15)(사용자 2026-11-10)
  const bar = (ts: Tile[], label?: string, tone = "text-gray-600", scale = 1) => {
    // 흐린 종목은 회색으로만 센다 — 업종 표 막대와 같은 기준(사용자 2026-11-12 "색이 안 맞는데")
    const live = ts.filter(t => !t.dim);
    const up = live.filter(t => (t.pct ?? 0) > 0).length, dn = live.filter(t => (t.pct ?? 0) < 0).length, fl = ts.length - up - dn, tot = Math.max(1, ts.length);
    return (
      <div className="flex items-center gap-2 text-[12px] font-bold tabular-nums">
        {/* 이름·▲ 칸 폭 고정 — 해외·국내 막대 시작점을 맞춘다(사용자 2026-11-10) */}
        {label && <span className={`shrink-0 w-[3.4em] text-[11px] ${tone}`}>{label} {ts.length}</span>}
        <span className="shrink-0 w-[2.8em] text-rose-600">{up > 0 ? `▲ ${up}` : ""}</span>
        <div className="flex-1 min-w-0 flex items-center gap-2">
        <div className="h-2 rounded-full overflow-hidden flex bg-gray-200" style={{ width: `${Math.max(3, scale * 100)}%` }} title={`오른 종목 ${up} · 그대로 ${fl} · 내린 종목 ${dn}`}>
          <div className="bg-rose-300" style={{ width: `${(up / tot) * 100}%` }} />
          <div className="bg-gray-200" style={{ width: `${(fl / tot) * 100}%` }} />
          <div className="bg-blue-300" style={{ width: `${(dn / tot) * 100}%` }} />
        </div>
        {dn > 0 && <span className="shrink-0 text-blue-600">▼ {dn}</span>}
        </div>
      </div>
    );
  };
  const open = onOpen ?? ((t: Tile) => (t.kr ? openStockInfo(t.code, t.name) : openTossStock(t.code)));
  const tile = (t: Tile) => <TileCard key={t.code} t={t} onOpen={open} />;

  return (
    <div>
      {(!hasLead || !outer) && (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex-1 min-w-0">{!hasLead && bar(tiles)}</div>
          {!outer && <TileSortToggle sort={sort} onSort={setSort} />}
        </div>
      )}
      {(() => {
        const leads = sorted.filter(t => t.lead), rest = sorted.filter(t => !t.lead);
        const grid = (ts: Tile[]) => (
          <div className={`grid ${cols} gap-1.5`}>
            {ts.slice(0, limit ?? ts.length).map(tile)}
          </div>
        );
        if (!leads.length) return grid(rest);
        return (<>
          <div className="mb-1">{bar(leads, "해외", "text-violet-700", leads.length / Math.max(leads.length, rest.length))}</div>
          {grid(leads)}
          {rest.length > 0 && <div className="mt-2.5 mb-1">{bar(rest, "국내", "text-gray-600", rest.length / Math.max(leads.length, rest.length))}</div>}
          {rest.length > 0 && grid(rest)}
        </>);
      })()}
    </div>
  );
}

/** 타일 한 장 — 판(HeatTiles) 밖에서도 같은 모양으로(최신공시 왼쪽 등, 사용자 2026-11-10 "여기도 종목 카드 말고 타일로") */
export function TileCard({ t, onOpen, className = "" }: { t: Tile; onOpen?: (t: Tile) => void; className?: string }) {
  const open = onOpen ?? ((x: Tile) => (x.kr ? openStockInfo(x.code, x.name) : openTossStock(x.code)));

    // 장외(프리·애프터·NXT)면 업종 한눈에처럼 — 위에 '정규 x%' 작게, 아래 그 구간 % 크게(사용자 2026-11-12 "정규장에 배경을… 이렇게 하던지")
    const pct = shownPct(t), reg = t.ext != null ? t.pct : null;
    const tone = (v: number | null) => v == null ? "text-gray-300" : v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500";
    const f = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
    const bg = pct == null ? "bg-gray-50 border-gray-200" : pct >= 3 ? "bg-rose-100 border-rose-300" : pct > 0 ? "bg-rose-50 border-rose-200" : pct <= -3 ? "bg-blue-100 border-blue-300" : pct < 0 ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200";
    return (
      <button type="button" title={`${t.name}${reg != null ? ` 정규 ${f(reg)} · ${t.extLabel ?? "장외"} ${f(t.ext!)}(정규장 종가 대비)` : pct != null ? ` ${f(pct)}` : ""} · 누르면 ${t.kr ? "종목정보" : "토스"}`}
              onClick={() => open(t)}
              className={`${className} pg-card text-left rounded-md border px-1.5 py-1 hover:brightness-95 ${bg} ${t.lead ? "ring-2 ring-violet-400 ring-inset" : ""} ${t.dim ? "opacity-50" : ""}`}>
        <div className="flex items-center gap-1 min-w-0">
          {t.logoid && <img src={heatmapLogoUrl(t.logoid)} alt="" loading="lazy" className="w-4 h-4 rounded-full bg-white object-contain shrink-0" />}
          <b className="truncate text-[12px] text-gray-900">{t.name}</b>
          <span className="ml-auto shrink-0 text-right leading-tight tabular-nums">
            {reg != null && <span className={`block text-[9.5px] opacity-70 ${tone(reg)}`}>정규 {f(reg)}</span>}
            <span className="block text-[12px] font-bold">
              <span className={tone(pct)}>{pct == null ? "—" : f(pct)}</span>
            </span>
          </span>
        </div>
        <div className="flex items-baseline justify-between text-[10.5px] text-gray-500 tabular-nums">
          <span>{t.price == null || !(t.price > 0) ? "" : t.kr ? t.price.toLocaleString() : `$${t.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</span>
          <span>{capText(t.cap, t.kr)}</span>
        </div>
      </button>
    );
  }
