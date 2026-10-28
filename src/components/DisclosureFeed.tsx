// 📋 최신공시 — 종목찾기 메뉴 컨센서스 바로 아래 페이지. 보유 국내 종목의 공시를 한 곳에서(종목별로 들어가 보지 않게, 사용자 요청 2026-10-28).
//   출처 = DART 오늘의 공시(유가·코스닥, lib/dartDisclosures) — 날짜 하나씩(기본 오늘, ◀ ▶). 사용자 결정 "오늘의 공시로 바꿔서 이것만".
//   종목 수와 무관하게 하루 몇 콜(예전 네이버 종목별 1콜씩보다 가볍다). 오늘은 10분마다, 지난 날짜는 한 번만.
//   회사명 → 종목코드는 크롤러의 KIND 상장사 표(없으면 보유 종목 이름으로 맞춤). 검색·그룹·종류·'중요만'(lib/disclosureFilter).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTossPrices } from "../lib/api";
import { fetchDartDayPreferServer, fetchDartCounts, fetchDartBody, loadListedCorps, normCorp, type DartRow } from "../lib/dartDisclosures";
import { KrDaySparkline } from "./KrDaySparkline";
import { openStockInfo } from "../lib/tickPopup";
import { STOCK_ANALYSIS_PROMPT, aiNowStamp } from "../lib/googleAi";
import { classifyDisclosure, DISC_CATS, DISC_CAT_TONE, DEFAULT_DISC_CATS, loadDiscCats, saveDiscCats, type DiscCat } from "../lib/disclosureFilter";
import { openGoogleAi, openGoogleAiLater, discAiQuery } from "../lib/googleAi";
import type { ConsensusItem } from "./ConsensusTab";

type Row = DartRow & { code?: string; name: string; groups: string[]; held: boolean; cat: DiscCat; noise: boolean; corrected: boolean };
const NEW_MIN = 60;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const shiftDay = (ymd: string, d: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + d * 86400_000).toISOString().slice(0, 10);

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

// 종목 묶음 — 마지막 공시가 늦은 종목 먼저, 종목 안은 시간 역순
function byStock(rows: Row[]): { key: string; code?: string; name: string; groups: string[]; rows: Row[] }[] {
  const m = new Map<string, { key: string; code?: string; name: string; groups: string[]; rows: Row[] }>();
  for (const r of rows) {
    const key = r.code ?? r.corp;
    const g = m.get(key) ?? { key, code: r.code, name: r.name, groups: r.groups, rows: [] }; m.set(key, g);
    g.rows.push(r);
  }
  return [...m.values()];
}

export function DisclosureFeed({ items, onSelectGroup }: { items: ConsensusItem[]; onSelectGroup?: (g: string) => void }) {
  const today = kstToday();
  const [day, setDay] = useState(today);   // 기본 = 오늘(사용자 요청 2026-10-28)
  const isToday = day === today;
  const minDay = shiftDay(today, -40);   // 서버(크롤러)가 최근 40일만 보관 — 그 앞은 고를 수 없게
  // 0건 날(주말·휴장일)은 ◀ ▶ 로 건너뛴다 — 서버 날짜 목록의 건수, 없으면 토·일만(사용자 요청 2026-10-28)
  const { data: counts = {} } = useQuery({ queryKey: ["dart-counts"], queryFn: fetchDartCounts, staleTime: 10 * 60_000 });
  const emptyDay = (d: string) => d !== today && (d in counts ? counts[d] === 0 : [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const step = (from: string, dir: -1 | 1) => {
    let d = shiftDay(from, dir);
    while (d > minDay && d < today && emptyDay(d)) d = shiftDay(d, dir);
    return d < minDay ? minDay : d > today ? today : d;
  };
  const { data: dartDay, isLoading, isFetching, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["dart-day", day], queryFn: () => fetchDartDayPreferServer(day),
    staleTime: isToday ? 5 * 60_000 : Infinity, refetchInterval: isToday ? 10 * 60_000 : false, refetchOnWindowFocus: false,
    retry: 1,   // 실패하면 길게 붙잡지 말고 바로 이유를 보여 준다(프록시마다 돌고 3번 재시도하면 몇 분 '불러오는 중'이었다)
  });
  const dart = dartDay?.rows ?? [];
  // 상장사 표는 직접 받을 때만 필요(서버 파일엔 종목코드가 이미 있다)
  const { data: corps } = useQuery({ queryKey: ["listed-corps"], queryFn: loadListedCorps, staleTime: 12 * 3600_000, retry: 1, enabled: dartDay?.source === "live" });
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [cats, setCatsRaw] = useState<Set<DiscCat>>(loadDiscCats);   // 기본 = 중요한 종류만, 바꾸면 기억
  const setCats = (next: Set<DiscCat> | ((p: Set<DiscCat>) => Set<DiscCat>)) =>
    setCatsRaw(prev => { const n = typeof next === "function" ? next(prev) : next; saveDiscCats(n); return n; });
  const [importantOnly, setImportantOnly] = useState(true);
  const [heldOnly, setHeldOnly] = useState(false);   // 기본 = 상장사 전체(사용자 요청 2026-10-28 "보유 종목만은 기본 체크 안 하게")

  const kr = useMemo(() => items.filter(it => /^[\dA-Za-z]{6}$/.test(it.ticker) && /\d/.test(it.ticker)), [items]);
  const byCode = useMemo(() => new Map(kr.map(it => [it.ticker, it])), [kr]);
  const byName = useMemo(() => new Map(kr.map(it => [normCorp(it.name), it])), [kr]);
  const groups = useMemo(() => [...new Set(kr.flatMap(x => x.groups ?? []))].sort((a, b) => a.localeCompare(b, "ko")), [kr]);
  const all: Row[] = useMemo(() => dart.map(d => {
    const n = normCorp(d.corp);
    const code = d.code ?? corps?.get(n) ?? byName.get(n)?.ticker;   // 서버 파일 코드 → 상장사 표 → 보유 종목 이름
    const it = code ? byCode.get(code) : undefined;
    return { ...d, code, name: it?.name ?? d.corp, groups: it?.groups ?? [], held: !!it, ...classifyDisclosure(d.title) };
  }), [dart, corps, byName, byCode]);

  const now = Date.now();
  const needle = q.trim().toLowerCase();
  const base = all.filter(r => (!heldOnly || r.held) && (!group || r.groups.includes(group))
    && (!needle || r.name.toLowerCase().includes(needle) || r.corp.toLowerCase().includes(needle) || (r.code ?? "").includes(needle) || r.title.toLowerCase().includes(needle)));
  const hidden = importantOnly ? base.filter(r => r.noise).length : 0;
  const rows = base.filter(r => (!importantOnly || !r.noise) && cats.has(r.cat));
  const catCount = (c: DiscCat) => base.filter(r => (!importantOnly || !r.noise) && r.cat === c).length;
  const stocks = byStock(rows.slice(0, 600));
  // 화면 종목 시세 — 토스 한 번에 묶어(200종목까지 1콜), 30초마다
  const shownCodes = useMemo(() => [...new Set(stocks.flatMap(s => s.code ? [s.code] : []))].sort().slice(0, 200), [stocks.map(s => s.key).join(",")]);
  const { data: pxList } = useQuery({
    queryKey: ["disc-feed-px", shownCodes.join(",")], queryFn: () => fetchTossPrices(shownCodes),
    enabled: shownCodes.length > 0, refetchInterval: 30_000, staleTime: 15_000,
  });
  const pxOf = (code?: string) => {
    const t = code ? pxList?.find(p => p.ticker === code) : undefined;
    return t && t.prevClose > 0 ? { price: t.price, pct: ((t.price - t.prevClose) / t.prevClose) * 100 } : undefined;
  };
  const isNewRow = (r: Row) => isToday && now - Date.parse(`${r.date}T${r.time}:00+09:00`) < NEW_MIN * 60_000;
  const toggleCat = (c: DiscCat) => setCats(prev => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const navBtn = "px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 text-xs disabled:opacity-30";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        {/* 날짜 하나씩 — 기본 오늘 */}
        <button className={navBtn} onClick={() => setDay(d => step(d, -1))} disabled={day <= minDay} title="전 거래일">◀</button>
        <input type="date" value={day} min={minDay} max={today} onChange={e => e.target.value && e.target.value >= minDay && setDay(e.target.value)} aria-label="날짜"
               className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white text-gray-700 focus:outline-none focus:border-blue-400" />
        <button className={navBtn} onClick={() => setDay(d => step(d, 1))} disabled={isToday} title="다음 거래일">▶</button>
        {!isToday && <button className={navBtn} onClick={() => setDay(today)}>오늘</button>}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="종목명·코드·공시 제목 검색"
               className="border border-gray-300 rounded px-2 py-1 text-xs w-52 max-w-full focus:outline-none focus:border-blue-400" />
        {groups.length > 0 && (
          <select value={group} onChange={e => setGroup(e.target.value)} aria-label="그룹"
                  className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white text-gray-700 focus:outline-none focus:border-blue-400">
            <option value="">전체 그룹</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={heldOnly} onChange={e => setHeldOnly(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
          보유 종목만
        </label>
        <label className="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer select-none"
               title="감사·사업보고서, 일괄신고·파생결합사채, ETF 안내, 임원 소유 보고 같은 반복 공시를 숨깁니다">
          <input type="checkbox" checked={importantOnly} onChange={e => setImportantOnly(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
          중요만{hidden > 0 && <span className="text-gray-400">(숨김 {hidden})</span>}
        </label>
        <span className="ml-auto text-[10px] text-gray-400">
          DART 유가·코스닥 {dart.length}건{isToday ? " · 10분마다" : ""}
          {dartDay?.source === "server" && dartDay.builtAt ? ` · 서버 ${new Date(Date.parse(dartDay.builtAt) + 9 * 3600_000).toISOString().slice(11, 16)} 갱신`
            : dataUpdatedAt ? ` · 직접 ${new Date(dataUpdatedAt + 9 * 3600_000).toISOString().slice(11, 16)}` : ""}
          <button onClick={() => void refetch()} disabled={isFetching} className="ml-1 text-blue-600 hover:underline disabled:opacity-40">{isFetching ? "받는 중…" : "새로고침"}</button>
        </span>
      </div>
      <div className="flex flex-wrap gap-1 px-1">
        {DISC_CATS.map(c => { const n = catCount(c); return (
          <button key={c} onClick={() => toggleCat(c)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold border transition ${cats.has(c) ? `${DISC_CAT_TONE[c].on} opacity-80` : "bg-gray-50 text-gray-300 border-gray-200 hover:text-gray-500"}`}>
            {c} <span className="opacity-70">{n}</span>
          </button>
        ); })}
        {/* 전체 보기 ↔ 선택 해제 — 해제한 뒤 하나만 누르면 그 종류만(사용자 요청 2026-10-28 "하나만 볼려니 다 꺼야 하는데") */}
        <button className="text-[11px] text-gray-500 hover:underline ml-1"
                onClick={() => setCats(cats.size === DISC_CATS.length ? new Set() : new Set(DISC_CATS))}>
          {cats.size === DISC_CATS.length ? "선택 해제" : "전체 보기"}
        </button>
        <button className="text-[11px] text-gray-500 hover:underline" onClick={() => setCats(new Set(DEFAULT_DISC_CATS))}>기본값</button>
      </div>
      {isLoading ? <div className="p-3 text-xs text-gray-400">DART 공시 불러오는 중…</div>
        : error && !dart.length ? <div className="p-3 text-xs text-rose-600">⚠️ {(error as Error).message}</div>
        : !dart.length && !isToday ? <div className="p-3 text-xs text-gray-400">휴장일이거나 공시가 없는 날입니다 — ◀ ▶ 는 이런 날을 건너뜁니다</div>
        : !cats.size ? <div className="p-3 text-xs text-gray-400">위에서 공시 종류를 하나 이상 고르세요</div>
        : !stocks.length ? <div className="p-3 text-xs text-gray-400">{heldOnly ? "보유 종목의 공시가 없습니다" : "조건에 맞는 공시가 없습니다"}</div>
        : (
        // 종목 = 카드 한 장(왼쪽 시세 · 오른쪽 그날 공시), 넓은 화면 한 줄 3장
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2 items-start">
          {stocks.map(st => (
            <div key={st.key} className="pg-card rounded-lg border border-gray-200 bg-white p-1.5 flex gap-2">
              {st.code ? <MiniQuoteCard code={st.code} name={st.name} px={pxOf(st.code)} />
                : <div className="w-[132px] sm:w-[176px] shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[13px] font-bold text-gray-700 truncate">{st.name}</div>}
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
                {st.rows.map(r => {
                  const isNew = isNewRow(r);
                  return (
                    <a key={r.rcpNo} href={r.url} target="_blank" rel="noopener noreferrer"
                       title={r.submitter && r.submitter !== r.corp ? `제출인 ${r.submitter}` : undefined}
                       className={`flex items-start gap-1.5 py-0.5 rounded hover:bg-gray-50 text-[12px] ${r.noise ? "opacity-60" : ""}`}>
                      <span className="w-[34px] shrink-0 text-[10.5px] text-gray-400 tabular-nums pt-px">{r.time}</span>
                      <span className={`shrink-0 px-1 rounded border text-[10px] font-bold leading-[16px] ${DISC_CAT_TONE[r.cat].tag}`}>{r.cat}</span>
                      <span className={`min-w-0 flex-1 leading-snug ${isNew ? "font-bold text-gray-900" : "text-gray-800"}`}>
                        {isNew && <span className="mr-1 px-1 rounded bg-rose-500 text-white text-[9px] align-middle">NEW</span>}
                        {r.title}
                        {r.submitter && r.submitter !== r.corp && <span className="ml-1 text-[10px] text-gray-400">· {r.submitter}</span>}
                      </span>
                      <button type="button" title="이 공시를 구글 AI 로 요약"
                              onClick={e => {
                                e.preventDefault(); e.stopPropagation();
                                // 본문을 넣어 묻는다(서버 파일 → 없으면 직접). 4초 넘게 걸리면 본문 없이
                                void openGoogleAiLater(async () => {
                                  const body = await Promise.race([fetchDartBody(r.date, r.rcpNo), new Promise<string>(res => setTimeout(() => res(""), 4000))]);
                                  return discAiQuery(r.name, r.code ?? r.corp, r.title, `${r.date} ${r.time}`, r.url, body);
                                });
                              }}
                              className="shrink-0 px-1 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold leading-[18px]">
                        🔍AI
                      </button>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
