// 컨센서스 탭 '📋 최신공시' — 보유 국내 종목 전체의 공시를 한 목록으로(종목별로 들어가 보지 않게, 사용자 요청 2026-10-28).
//   출처 = 네이버 종목 공시(종목당 1콜, 최근 10건). 화면에 이 탭이 열려 있을 때만·10분마다·동시 4종목씩 받는다(호출 절약).
//   검색(종목명·코드·제목) + 그룹·기간·종류 필터, '중요만'(기본 켬)은 lib/disclosureFilter 의 잡음 규칙으로 거른다.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNaverRecentDisclosures, fetchTossPrices, type RecentDisclosure } from "../lib/api";
import { KrDaySparkline } from "./KrDaySparkline";
import { openStockInfo } from "../lib/tickPopup";
import { STOCK_ANALYSIS_PROMPT, aiNowStamp } from "../lib/googleAi";
import { classifyDisclosure, DISC_CATS, DISC_CAT_TONE, type DiscCat } from "../lib/disclosureFilter";
import { openGoogleAi, discAiQuery } from "../lib/googleAi";
import type { ConsensusItem } from "./ConsensusTab";

type Row = RecentDisclosure & { ticker: string; name: string; groups: string[]; t: number; cat: DiscCat; noise: boolean; corrected: boolean };
type Period = "today" | "1w" | "1m";
const PER_STOCK = 10, POOL = 4, NEW_MIN = 60;

async function loadAll(items: ConsensusItem[]): Promise<Row[]> {
  const out: Row[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++];
      try {
        const ds = await fetchNaverRecentDisclosures(it.ticker, PER_STOCK);
        for (const d of ds) {
          const t = Date.parse(`${d.datetime}+09:00`);
          if (Number.isFinite(t)) out.push({ ...d, ticker: it.ticker, name: it.name, groups: it.groups ?? [], t, ...classifyDisclosure(d.title) });
        }
      } catch { /* 한 종목 실패는 건너뛴다 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, worker));
  return out.sort((a, b) => b.t - a.t);
}

// 왼쪽 시세 카드 — 지수 탭 종목 카드와 같은 모양(24시간 그래프 배경 + 현재가·등락률 + 종목정보·AI), 사용자 요청 2026-10-28
function MiniQuoteCard({ code, name, px }: { code: string; name: string; px?: { price: number; pct: number } }) {
  const pct = px?.pct;
  const tone = pct == null ? "bg-gray-50 border-gray-200" : pct > 0 ? "bg-rose-50/70 border-rose-200" : pct < 0 ? "bg-blue-50/70 border-blue-200" : "bg-gray-50 border-gray-200";
  const col = pct == null ? "text-gray-700" : pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-600";
  return (
    <div className={`relative overflow-hidden rounded-lg border ${tone} w-[132px] sm:w-[176px] h-[88px] shrink-0`}>
      <KrDaySparkline code={code} fallback={[]} live={px?.price} width={300} height={80} className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />
      <div className="relative h-full flex flex-col px-2 py-1">
        <button type="button" onClick={() => openStockInfo(code, name)} title="종목정보"
                className={`text-left truncate font-bold text-[13px] ${col} hover:underline`}>{name}</button>
        <div className="mt-auto flex items-baseline justify-between gap-1 tabular-nums">
          <span className={`text-[12px] ${col}`}>{px ? Math.round(px.price).toLocaleString() : "—"}</span>
          <span className={`font-bold text-[16px] sm:text-[18px] ${col}`}>{pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}</span>
        </div>
        <div className="flex justify-end gap-0.5 -mb-0.5">
          <button type="button" onClick={() => openStockInfo(code, name)}
                  className="px-1 rounded border border-amber-300/70 bg-amber-50 text-amber-800 text-[9.5px] font-bold leading-[15px]">📊종목정보</button>
          <button type="button" title="구글 AI에 현재상태 분석 요청"
                  onClick={() => openGoogleAi(`${STOCK_ANALYSIS_PROMPT}\n\n[기준시각] ${aiNowStamp()}\n[분석 대상] ${name}(${code})${px ? `, 현재가 ${Math.round(px.price).toLocaleString()}원 (${pct! >= 0 ? "+" : ""}${pct!.toFixed(2)}%)` : ""}`)}
                  className="px-1 rounded border border-blue-300/70 bg-blue-50 text-blue-700 text-[9.5px] font-bold leading-[15px]">🔍AI</button>
        </div>
      </div>
    </div>
  );
}

// 날짜(KST) → 종목 묶음. 날짜는 최신 먼저, 한 날 안에서는 마지막 공시가 늦은 종목 먼저, 종목 안은 시간 역순
function byDay(rows: Row[]): { date: string; stocks: { ticker: string; name: string; groups: string[]; rows: Row[] }[] }[] {
  const days = new Map<string, Map<string, { ticker: string; name: string; groups: string[]; rows: Row[] }>>();
  for (const r of rows) {
    const d = new Date(r.t + 9 * 3600_000).toISOString().slice(0, 10);
    const m = days.get(d) ?? new Map(); days.set(d, m);
    const g = m.get(r.ticker) ?? { ticker: r.ticker, name: r.name, groups: r.groups, rows: [] }; m.set(r.ticker, g);
    g.rows.push(r);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, m]) => ({ date, stocks: [...m.values()].sort((a, b) => b.rows[0].t - a.rows[0].t) }));
}

export function DisclosureFeed({ items, onSelectGroup }: { items: ConsensusItem[]; onSelectGroup?: (g: string) => void }) {
  const kr = useMemo(() => items.filter(it => /^[\dA-Za-z]{6}$/.test(it.ticker) && /\d/.test(it.ticker)), [items]);
  const key = useMemo(() => kr.map(x => x.ticker).sort().join(","), [kr]);
  const { data = [], isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["disc-feed", key], queryFn: () => loadAll(kr), enabled: kr.length > 0,
    staleTime: 10 * 60_000, refetchInterval: 10 * 60_000, refetchOnWindowFocus: false,
  });
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [period, setPeriod] = useState<Period>("today");   // 기본 = 오늘(사용자 요청 2026-10-28)
  const [cats, setCats] = useState<Set<DiscCat>>(new Set());
  const [importantOnly, setImportantOnly] = useState(true);

  const groups = useMemo(() => [...new Set(kr.flatMap(x => x.groups ?? []))].sort((a, b) => a.localeCompare(b, "ko")), [kr]);
  const now = Date.now();
  const todayKst = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
  const since = period === "today" ? Date.parse(`${todayKst}T00:00:00+09:00`) : now - (period === "1w" ? 7 : 31) * 86400_000;
  const needle = q.trim().toLowerCase();
  const base = data.filter(r => r.t >= since && (!group || r.groups.includes(group))
    && (!needle || r.name.toLowerCase().includes(needle) || r.ticker.includes(needle) || r.title.toLowerCase().includes(needle)));
  const hidden = importantOnly ? base.filter(r => r.noise).length : 0;
  const rows = base.filter(r => (!importantOnly || !r.noise) && (!cats.size || cats.has(r.cat)));
  // 화면에 보이는 종목 시세 — 토스 한 번에 묶어(200종목까지 1콜), 30초마다
  const shownCodes = useMemo(() => [...new Set(rows.slice(0, 400).map(r => r.ticker))].sort(), [rows]);
  const { data: pxList } = useQuery({
    queryKey: ["disc-feed-px", shownCodes.join(",")], queryFn: () => fetchTossPrices(shownCodes),
    enabled: shownCodes.length > 0, refetchInterval: 30_000, staleTime: 15_000,
  });
  const pxOf = (code: string) => {
    const t = pxList?.find(p => p.ticker === code);
    return t && t.prevClose > 0 ? { price: t.price, pct: ((t.price - t.prevClose) / t.prevClose) * 100 } : undefined;
  };
  const catCount = (c: DiscCat) => base.filter(r => (!importantOnly || !r.noise) && r.cat === c).length;
  const when = (t: number) => {
    const d = new Date(t + 9 * 3600_000).toISOString();
    return d.slice(0, 10) === todayKst ? d.slice(11, 16) : `${+d.slice(5, 7)}/${+d.slice(8, 10)} ${d.slice(11, 16)}`;
  };
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full text-[11px] font-bold border transition ${on ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`;
  const toggleCat = (c: DiscCat) => setCats(prev => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="종목명·코드·공시 제목 검색"
               className="border border-gray-300 rounded px-2 py-1 text-xs w-56 max-w-full focus:outline-none focus:border-blue-400" />
        {groups.length > 0 && (
          <select value={group} onChange={e => setGroup(e.target.value)} aria-label="그룹"
                  className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white text-gray-700 focus:outline-none focus:border-blue-400">
            <option value="">전체 그룹</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        {(["today", "1w", "1m"] as const).map(p => (
          <button key={p} className={chip(period === p)} onClick={() => setPeriod(p)}>{p === "today" ? "오늘" : p === "1w" ? "일주일" : "한달"}</button>
        ))}
        <label className="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer select-none ml-1"
               title="ETF 안내·집합투자규약·주식선물 가격제한폭·임원 소유 보고·정기보고서 같은 반복 공시를 숨깁니다">
          <input type="checkbox" checked={importantOnly} onChange={e => setImportantOnly(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
          중요만{hidden > 0 && <span className="text-gray-400">(숨김 {hidden})</span>}
        </label>
        <span className="ml-auto text-[10px] text-gray-400">
          {kr.length}종목 · 종목당 최근 {PER_STOCK}건 · 10분마다{dataUpdatedAt ? ` · ${new Date(dataUpdatedAt + 9 * 3600_000).toISOString().slice(11, 16)}` : ""}
          <button onClick={() => void refetch()} disabled={isFetching} className="ml-1 text-blue-600 hover:underline disabled:opacity-40">{isFetching ? "받는 중…" : "새로고침"}</button>
        </span>
      </div>
      <div className="flex flex-wrap gap-1 px-1">
        {DISC_CATS.map(c => { const n = catCount(c); return n > 0 || cats.has(c) ? (
          <button key={c} onClick={() => toggleCat(c)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold border transition ${cats.has(c) ? DISC_CAT_TONE[c].on : `${DISC_CAT_TONE[c].tag} hover:brightness-95`}`}>
            {c} <span className="opacity-70">{n}</span>
          </button>
        ) : null; })}
        {cats.size > 0 && <button className="text-[11px] text-gray-400 hover:underline" onClick={() => setCats(new Set())}>종류 해제</button>}
      </div>
      <div>
        {isLoading ? <div className="p-3 text-xs text-gray-400">공시 불러오는 중… ({kr.length}종목)</div>
          : !rows.length ? <div className="p-3 text-xs text-gray-400">조건에 맞는 공시가 없습니다</div>
          : byDay(rows.slice(0, 400)).map(day => (
            <div key={day.date}>
              <div className="px-1 pt-2 pb-1 text-[12px] font-bold text-gray-700">
                {day.date === todayKst ? "오늘" : `${+day.date.slice(5, 7)}월 ${+day.date.slice(8, 10)}일`}
                <span className="ml-1 font-normal text-gray-400">{day.stocks.length}종목 · {day.stocks.reduce((n, x) => n + x.rows.length, 0)}건</span>
              </div>
              {/* 같은 날 같은 종목 = 카드 한 장(사용자 요청 2026-10-28 "일별로 같은 종목은 묶자", "카드로 묶으면 — 좌우가 넓어").
                  화면 폭에 따라 1~3열 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2 items-start">   {/* 한 줄에 3장(넓은 화면, 사용자 요청 2026-10-28) */}
              {day.stocks.map(st => (
                <div key={st.ticker} className="pg-card rounded-lg border border-gray-200 bg-white p-1.5 flex gap-2">
                  {/* 왼쪽 = 시세 카드, 오른쪽 = 그날 공시 목록(사용자 요청 2026-10-28) */}
                  <MiniQuoteCard code={st.ticker} name={st.name} px={pxOf(st.ticker)} />
                  <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1 min-w-0 mb-0.5">
                    <span className="text-[10px] text-gray-400 shrink-0">{st.rows.length}건</span>
                    {st.groups.length > 0 && onSelectGroup && (
                      <div className="ml-auto flex gap-0.5 min-w-0 overflow-hidden">
                        {st.groups.slice(0, 3).map(g => (
                          <button key={g} type="button" onClick={() => onSelectGroup(g)}
                                  className="shrink-0 px-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 text-[9.5px]">{g}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    {st.rows.map(r => {
                      const isNew = now - r.t < NEW_MIN * 60_000;
                      return (
                        <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer"
                           className={`flex items-start gap-1.5 py-0.5 rounded hover:bg-gray-50 text-[12px] ${r.noise ? "opacity-60" : ""}`}>
                          <span className="w-[34px] shrink-0 text-[10.5px] text-gray-400 tabular-nums pt-px">{when(r.t).slice(-5)}</span>
                          <span className={`shrink-0 px-1 rounded border text-[10px] font-bold leading-[16px] ${DISC_CAT_TONE[r.cat].tag}`}>{r.cat}</span>
                          <span className={`min-w-0 flex-1 leading-snug ${isNew ? "font-bold text-gray-900" : "text-gray-800"}`}>
                            {isNew && <span className="mr-1 px-1 rounded bg-rose-500 text-white text-[9px] align-middle">NEW</span>}
                            {r.title}
                          </span>
                          <button type="button" title="이 공시를 구글 AI 로 요약"
                                  onClick={e => { e.preventDefault(); e.stopPropagation(); openGoogleAi(discAiQuery(r.name, r.ticker, r.title, when(r.t), r.url)); }}
                                  className="shrink-0 px-1 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold leading-[18px]">
                            🔍AI
                          </button>
                        </a>
                      );
                    })}
                  </div>
                  </div>
                </div>
              ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
