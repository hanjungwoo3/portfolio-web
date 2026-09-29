// 눌림목 스크리너 — "상승추세 중 과매도" 종목 찾기. (lib/stockScreener.ts 의 조건 정의를 그대로 쓴다)
//
// 화면이 반드시 보여줘야 하는 것은 **퍼널**이다. 조건 5개를 걸어 놓고 결과만 보여주면
//   "조건이 좋아서 0종" 인지 "문턱이 빡세서 0종" 인지 구분이 안 된다. 어디서 무너지는지
//   단계별 남은 수를 같이 띄워야 문턱을 어디서 풀지 판단이 된다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  ProxyHostError, fetchTossPrices, fetchKrRegularPrices, fetchKrPriceHistory,
  fetchInvestorHistory, fetchInvestorHistorySafe, fetchNaverInfoLight, fetchWarning,
  type KrRegularPrice, type PricePoint,
} from "../lib/api";
import { signColor } from "../lib/format";
import { loadKrNameDict, getRuntimeNames, fetchMissingKrNames } from "../lib/krStockNames";
import { StockCard } from "./StockCard";
import { BacktestPanel } from "./BacktestPanel";
import type { Consensus, Investor, Price } from "../types";
import {
  fetchScreenerUniverse, loadCachedScreen, funnel, passCount, CONDS,
  DEFAULT_CRITERIA, type ScreenCriteria, type ScreenRow, type ScreenSnapshot,
} from "../lib/stockScreener";

interface Props {
  // 포트폴리오 추가 버튼은 두지 않는다 — 카드의 📊(기업가치) 안에서 추가할 수 있다.
  onOpenValuation?: (ticker: string) => void;
}

// 한 번에 그리는 결과 카드 수. 카드 하나가 종목당 4콜(차트·수급·컨센서스·시장조치)이라
//   조건을 느슨하게 풀어 200종이 걸리면 그대로 800콜이 된다. 페이지로 끊고,
//   그 안에서도 **화면에 들어온 카드만** 실제로 부른다(아래 ResultCard 의 IntersectionObserver).
const PAGE = 12;

type SortKey = "rsi" | "vt" | "dd" | "sma";
const SORTS: [SortKey, string][] = [
  ["rsi", "RSI 낮은 순"], ["vt", "거래대금"], ["dd", "낙폭 큰 순"], ["sma", "200일선 이격"],
];

function fmtStamp(ms: number): string {
  const d = new Date(ms + 9 * 3600_000);
  return `${String(d.getUTCMonth() + 1)}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// 숫자 조건 한 칸 — 라벨 + 입력 + 단위.
function NumField({ label, value, onChange, step = 1, unit, title }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string; title?: string;
}) {
  return (
    <label title={title} className="inline-flex items-center gap-1 text-[11px]">
      <span className="text-gray-600">{label}</span>
      <input type="number" value={value} step={step}
             onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }}
             className="w-16 border border-gray-300 rounded px-1 py-0.5 text-[11px] tabular-nums
                        focus:outline-none focus:border-gray-500" />
      {unit && <span className="text-gray-400">{unit}</span>}
    </label>
  );
}

// 결과 카드 한 장 — **보유 종목 카드와 똑같은 카드**(StockCard)를 쓴다.
//   차트·고저·목표가·수급·변동성이 전부 거기 이미 들어 있다. 스크리너용으로 따로 만들면
//   같은 종목이 화면마다 다르게 보인다.
//
// 종목당 4콜(일봉·수급·컨센서스·시장조치)이라 **뷰포트에 들어온 카드만** 부른다.
//   가격·정규장 정보는 부모가 페이지 단위로 한 번에 받아 내려준다(배치 2콜).
function ResultCard({ row, name, price, krReg, criteria, onOpenValuation }: {
  row: ScreenRow; name: string; price?: Price; krReg?: KrRegularPrice;
  criteria: ScreenCriteria;
  onOpenValuation?: (ticker: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const t = row.code;
  const qs = useQueries({
    queries: [
      { queryKey: ["price-history", t, "3mo"], queryFn: () => fetchKrPriceHistory(t, "3mo"),
        enabled: inView, staleTime: 60 * 60_000, refetchOnWindowFocus: false },
      { queryKey: ["investor-history", t, 60], queryFn: () => fetchInvestorHistory(t, 60),
        enabled: inView, staleTime: 30 * 60_000, refetchOnWindowFocus: false },
      { queryKey: ["naver-info", t], queryFn: () => fetchNaverInfoLight(t),
        enabled: inView, staleTime: 60 * 60_000, refetchOnWindowFocus: false },
      { queryKey: ["warning", t], queryFn: () => fetchWarning(t),
        enabled: inView, staleTime: 60 * 60_000, refetchOnWindowFocus: false },
    ],
  });
  // 수급 그리드 행에 마우스를 올렸을 때 뜨는 통합 표(5/20/60/120/200일 누적)는 200일 히스토리가
  //   있어야 그려진다. 종목당 ~270KB 라 처음부터 받지 않고 **첫 호버 때** 받는다(App 과 같은 키·같은 캐시).
  const [primed, setPrimed] = useState(false);
  const longQ = useQuery({
    queryKey: ["investor-history-long", t],
    queryFn: () => fetchInvestorHistorySafe(t, [200, 120, 60]),
    enabled: primed, staleTime: 60 * 60_000, refetchOnWindowFocus: false,
  });
  // 같은 일봉 응답 하나로 둘을 쓴다 — 배경 스파크라인(종가 배열)과
  //   가격 박스 호버 툴팁의 1개월 캔들차트(OHLC 원본).
  const hist = qs[0].data as PricePoint[] | undefined;
  const investorHistory = qs[1].data as Investor[] | undefined;
  const info = qs[2].data as { sector: string; consensus: Consensus | null } | undefined;
  const warning = qs[3].data as string | undefined;

  // 스캐너 값으로 만든 최소 Price — 배치 시세가 도착하면 그쪽(고·저·체결시각 포함)이 이긴다.
  const fallbackBase = row.changePct > -100 ? row.close / (1 + row.changePct / 100) : row.close;
  const px: Price = price ?? {
    ticker: t, price: row.close, base: fallbackBase, prevClose: fallbackBase,
    open: 0, volume: row.volume, trade_date: "",
  };

  return (
    <div ref={ref} className="h-full flex flex-col">
      {/* 왜 이 종목이 걸렸는지 — 조건별 실측값. 카드보다 **위**에 둔다(이게 이 화면의 본문이다).
          못 넘은 조건은 흐리게 — 한 조건 모자란 종목에서 어디가 빠졌는지 바로 보인다. */}
      <div className="shrink-0 mb-1 mx-1 flex flex-wrap items-center gap-x-3 gap-y-0.5
                      rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1
                      text-[11px] tabular-nums shadow-sm">
        {/* 색은 앱 공통 규칙(빨강=+ / 파랑=−). RSI 는 부호가 없으니 50 을 기준으로 —
            낮으면(과매도) 파랑, 높으면 빨강. 거래대금은 방향이 없어 검정 그대로 둔다. */}
        {([
          ["RSI", row.rsi.toFixed(1), row.rsi < criteria.rsiMax, row.rsi - 50],
          ["볼린저", `${row.bbGap >= 0 ? "+" : ""}${row.bbGap.toFixed(1)}%`, row.bbGap <= criteria.bbGapMax, row.bbGap],
          ["200일선", `${row.smaGap >= 0 ? "+" : ""}${row.smaGap.toFixed(1)}%`, row.smaGap > criteria.smaGapMin, row.smaGap],
          ["고가대비", `${row.ddFromHigh.toFixed(1)}%`, criteria.ddMax === 0 || row.ddFromHigh <= criteria.ddMax, row.ddFromHigh],
          ["거래대금", `${Math.round(row.valueTraded / 1e8).toLocaleString()}억`,
           row.valueTraded >= criteria.minValueTradedEok * 1e8, null],
          ["순이익", `${row.netIncome >= 0 ? "+" : "−"}${Math.abs(Math.round(row.netIncome / 1e8)).toLocaleString()}억`,
           !criteria.profitOnly || row.netIncome > 0, row.netIncome],
        ] as [string, string, boolean, number | null][]).map(([lbl, v, ok, sign]) => (
          <span key={lbl} className={ok ? "" : "opacity-25"}>
            <span className="text-indigo-400 mr-0.5">{lbl}</span>
            <span className={`font-bold ${sign == null ? "text-gray-800" : signColor(sign)}`}>{v}</span>
          </span>
        ))}
      </div>
      <StockCard
        stock={{ ticker: t, name, shares: 0, avg_price: 0, market: row.market === "코스피" ? "KOSPI" : "KOSDAQ" }}
        price={px} krReg={krReg}
        chart={(hist ?? []).map(p => p.close)}
        priceHistory={hist}
        investorHistory={investorHistory ?? null}
        investor={investorHistory?.[investorHistory.length - 1] ?? null}
        consensus={info?.consensus ?? null}
        sector={info?.sector}
        market={row.market === "코스피" ? "KOSPI" : "KOSDAQ"}
        warning={warning}
        hideStats
        longHistory={longQ.data ?? null}
        onNeedLongHistory={() => setPrimed(true)}
        onOpenValuation={onOpenValuation}
      />
    </div>
  );
}

export function ScreenerTab({ onOpenValuation }: Props) {
  const [snap, setSnap] = useState<ScreenSnapshot | null>(() => loadCachedScreen());
  const [loading, setLoading] = useState(snap === null);
  const [err, setErr] = useState<string | null>(null);
  const [hostErr, setHostErr] = useState(false);
  const [c, setC] = useState<ScreenCriteria>(DEFAULT_CRITERIA);
  const [sort, setSort] = useState<SortKey>("rsi");
  const [showNear, setShowNear] = useState(false);   // 한 조건 모자란 종목도 보기
  const set = (patch: Partial<ScreenCriteria>) => setC(v => ({ ...v, ...patch }));

  const run = (alive: () => boolean) =>
    fetchScreenerUniverse()
      .then(s => { if (alive()) { setSnap(s); setLoading(false); setErr(null); setHostErr(false); } })
      .catch((e: unknown) => {
        if (!alive()) return;
        setLoading(false);
        if (e instanceof ProxyHostError) { setHostErr(true); setErr(null); }
        else setErr(e instanceof Error ? e.message : "조회 실패");
      });

  // 캐시가 없을 때만 마운트 직후 1회 자동 조회. 이후엔 새로고침 버튼으로만(스캐너 2콜).
  useEffect(() => {
    if (!loading) return;
    let alive = true;
    void run(() => alive);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => snap?.rows ?? [], [snap]);
  const steps = useMemo(() => funnel(rows, c), [rows, c]);
  const hit = useMemo(() => rows.filter(r => CONDS.every(cd => cd.pass(r, c))), [rows, c]);
  // 한 조건만 모자란 종목 — "부분 일치를 추천으로 둔갑" 시키지 않으려고 기본은 숨긴다.
  const near = useMemo(
    () => (showNear ? rows.filter(r => passCount(r, c) === CONDS.length - 1) : []),
    [rows, c, showNear]);

  const cmp = useCallback((a: ScreenRow, b: ScreenRow): number =>
    sort === "rsi" ? a.rsi - b.rsi
    : sort === "vt" ? b.valueTraded - a.valueTraded
    : sort === "dd" ? a.ddFromHigh - b.ddFromHigh
    : a.smaGap - b.smaGap, [sort]);
  const sortedHit = useMemo(() => [...hit].sort(cmp), [hit, cmp]);
  const sortedNear = useMemo(() => [...near].sort(cmp), [near, cmp]);
  // 조건·정렬을 바꾸면 목록이 통째로 달라진다 — 페이지도 처음으로 되돌린다.
  //   effect 로 setState 하면 한 박자 늦게(추가 렌더로) 되돌아간다. 키를 같이 들고 있다가
  //   키가 다르면 그냥 1 로 읽는 쪽이 정확하고 렌더도 한 번이다.
  const pageKey = `${JSON.stringify(c)}|${sort}|${showNear}`;
  const [pageState, setPageState] = useState({ key: pageKey, n: 1 });
  const page = pageState.key === pageKey ? pageState.n : 1;
  const shown = useMemo(() => sortedHit.slice(0, page * PAGE), [sortedHit, page]);
  const shownNear = useMemo(() => sortedNear.slice(0, page * PAGE), [sortedNear, page]);

  // 지금 그리는 카드들의 시세·정규장 정보 — 배치 2콜(카드마다 부르면 장 수만큼 늘어난다).
  const pageCodes = useMemo(() => [...shown, ...shownNear].map(r => r.code), [shown, shownNear]);
  const pxQ = useQuery({
    queryKey: ["screener-prices", pageCodes],
    queryFn: () => fetchTossPrices(pageCodes),
    enabled: pageCodes.length > 0, staleTime: 30_000,
  });
  const priceMap = useMemo(() => new Map((pxQ.data ?? []).map(p => [p.ticker, p])), [pxQ.data]);
  const regQ = useQuery({
    queryKey: ["screener-krreg", pageCodes],
    queryFn: () => fetchKrRegularPrices(pageCodes),
    enabled: pageCodes.length > 0, staleTime: 60_000,
  });

  // 한글 종목명 — 결과로 걸린 몇 종목만. 사전에 없으면 네이버 폴백(히트맵과 같은 경로).
  const dictQ = useQuery({ queryKey: ["kr-name-dict"], queryFn: loadKrNameDict, staleTime: Infinity });
  const codes = useMemo(() => [...shown, ...shownNear].map(r => r.code), [shown, shownNear]);
  const missCodes = useMemo(() => {
    const dict = dictQ.data ?? {}; const rt = getRuntimeNames();
    return codes.filter(x => !dict[x] && !rt[x]);
  }, [codes, dictQ.data]);
  const missQ = useQuery({
    queryKey: ["kr-name-miss", missCodes.join(",")],
    queryFn: () => fetchMissingKrNames(missCodes),
    enabled: missCodes.length > 0, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const krName = (r: ScreenRow) =>
    dictQ.data?.[r.code] ?? getRuntimeNames()[r.code] ?? missQ.data?.[r.code] ?? r.name;

  const refresh = () => { setLoading(true); setErr(null); void run(() => true); };
  const maxLeft = Math.max(1, rows.length);

  return (
    <div className="space-y-3">
      {/* 헤더 — 새로고침 + 기준 + 정렬 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-300 bg-white p-2.5">
        <button onClick={refresh} disabled={loading}
                title="코스피·코스닥 전 종목 지표를 다시 조회합니다 (스캐너 2콜)"
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300
                           bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50">
          {loading ? "조회 중…" : "🔄 새로고침"}
        </button>
        <span className="inline-flex items-center gap-0.5">
          <span className="text-gray-400 text-[11px] mr-1">정렬</span>
          {SORTS.map(([k, label]) => (
            <button key={k} onClick={() => setSort(k)}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold border transition
                                ${sort === k ? "bg-gray-700 text-white border-gray-700"
                                             : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"}`}>
              {label}
            </button>
          ))}
        </span>
        <button onClick={() => setC(DEFAULT_CRITERIA)}
                className="px-2 py-1 text-[11px] rounded border border-gray-300 bg-white
                           text-gray-600 hover:bg-gray-100">기본값</button>
        <div className="ml-auto text-[11px] text-gray-500 leading-tight text-right">
          {snap ? (
            <>
              <div>기준 {fmtStamp(snap.fetchedAt)}</div>
              <div>{rows.length.toLocaleString()}종 스캔</div>
            </>
          ) : loading ? <div>전 종목 지표 조회 중…</div> : null}
        </div>
      </div>

      {hostErr && (
        <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
          ⚠️ 프록시가 <b>scanner.tradingview.com</b> 을 막고 있습니다 — 워커 화이트리스트에 추가해야 합니다.
        </div>
      )}
      {err && (
        <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
          ⚠️ 조회 실패 — {err}
          <button onClick={refresh} className="ml-2 underline font-bold">다시 시도</button>
        </div>
      )}

      {/* 조건 + 퍼널 — 조건을 바꾸면 남는 수가 즉시 움직인다(재조회 없음) */}
      <div className="rounded-xl border border-gray-300 bg-white p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <NumField label="RSI <" value={c.rsiMax} onChange={v => set({ rsiMax: v })}
                    title="14일 RSI. 낮을수록 과매도" />
          <NumField label="볼린저 하단 +" value={c.bbGapMax} unit="% 이내" step={0.5}
                    onChange={v => set({ bbGapMax: v })}
                    title="0 이면 '하단 이하'(하단을 뚫은 것만). 실전에선 하단에 닿기만 해도 눌림으로 본다." />
          <NumField label="200일선" value={c.smaGapMin} unit="% 이상" step={5}
                    onChange={v => set({ smaGapMin: v })}
                    title="0 이면 '200일선 위'. 장기 추세가 살아 있는지" />
          <NumField label="52주 고가 대비" value={c.ddMax} unit="% 이하" step={5}
                    onChange={v => set({ ddMax: v })}
                    title="0 이면 제한 없음. -20 이면 고가에서 20% 이상 빠진 것만" />
          <NumField label="거래대금" value={c.minValueTradedEok} unit="억+" step={5}
                    onChange={v => set({ minValueTradedEok: v })}
                    title="원 조건엔 없지만 이게 없으면 못 파는 종목이 걸린다" />
          <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer select-none"
                 title="스캐너 최신 보고 순이익 > 0">
            <input type="checkbox" checked={c.profitOnly}
                   onChange={e => set({ profitOnly: e.target.checked })} />
            <span className="text-gray-600">흑자만</span>
          </label>
        </div>
        {/* 퍼널 */}
        {rows.length > 0 && (
          <div className="space-y-0.5 pt-1 border-t border-gray-100">
            <div className="flex items-baseline justify-between text-[11px] text-gray-400">
              <span>조건을 위에서부터 하나씩 더할 때 남는 종목</span>
              <span className="tabular-nums">전체 {rows.length.toLocaleString()}종</span>
            </div>
            {steps.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-44 shrink-0 text-gray-600 truncate">{`${i + 1}. ${s.label}`}</span>
                <span className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                  <span className={`block h-full rounded ${s.left === 0 ? "bg-rose-300" : "bg-indigo-400"}`}
                        style={{ width: `${Math.max(s.left / maxLeft * 100, s.left > 0 ? 1 : 0)}%` }} />
                </span>
                <span className={`w-12 shrink-0 text-right tabular-nums font-bold
                                  ${s.left === 0 ? "text-rose-600" : "text-gray-700"}`}>
                  {s.left.toLocaleString()}종
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 이 조건이 과거에 먹혔는지 — 접어 둔다(일봉 200콜). 결과보다 위에 둬서 눈에 걸리게. */}
      <BacktestPanel criteria={c} />

      {!snap && loading && (
        <div className="py-16 text-center text-gray-500 text-sm">
          코스피·코스닥 전 종목 지표를 받고 있습니다…
        </div>
      )}

      {snap && shown.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-500 space-y-1">
          <div>조건을 모두 만족하는 종목이 <b className="text-rose-600">없습니다</b>.</div>
          <div className="text-[11px] text-gray-400">
            위 퍼널에서 <b>붉은 줄</b>이 병목입니다. 그 조건의 문턱을 먼저 푸세요.
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <>
          <div className="px-1 text-[11px] text-gray-500">
            조건 {CONDS.length}개 <b className="text-gray-800">전부</b> 만족 —
            <b className="text-gray-800"> {shown.length}</b>종
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 items-stretch">
            {shown.map(r => (
              <ResultCard key={r.code} row={r} name={krName(r)} criteria={c}
                          price={priceMap.get(r.code)} krReg={regQ.data?.get(r.code)}
                          onOpenValuation={onOpenValuation} />
            ))}
          </div>
          {sortedHit.length > shown.length && (
            <button onClick={() => setPageState({ key: pageKey, n: page + 1 })}
                    className="w-full py-2 text-sm font-medium text-gray-600 rounded-lg
                               border border-gray-300 bg-white hover:bg-gray-50">
              더보기 ({shown.length} / {sortedHit.length}종)
            </button>
          )}
        </>
      )}

      {/* 한 조건 모자란 종목 — 기본 숨김. 부분 일치를 추천처럼 늘어놓지 않기 위해서다. */}
      {snap && (
        <button onClick={() => setShowNear(v => !v)}
                className="w-full py-2 text-sm font-medium text-gray-600 rounded-lg
                           border border-gray-300 bg-white hover:bg-gray-50">
          {showNear ? "한 조건 모자란 종목 접기" : `한 조건 모자란 종목도 보기 (${CONDS.length - 1}/${CONDS.length})`}
        </button>
      )}
      {showNear && (
        shownNear.length === 0
          ? <div className="py-6 text-center text-[11px] text-gray-400">{CONDS.length - 1}개를 만족하는 종목도 없습니다.</div>
          : (
            <>
              <div className="px-1 text-[11px] text-amber-700">
                ⚠️ 아래는 <b>조건 하나가 빠진</b> 종목입니다 — 통과가 아닙니다.
                카드 오른쪽 지표에서 <span className="text-gray-300">흐린 줄</span>이 못 넘은 조건입니다.
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 items-stretch opacity-80">
                {shownNear.map(r => (
                  <ResultCard key={r.code} row={r} name={krName(r)} criteria={c}
                              price={priceMap.get(r.code)} krReg={regQ.data?.get(r.code)}
                              onOpenValuation={onOpenValuation} />
                ))}
              </div>
            </>
          )
      )}

      <p className="text-[11px] text-gray-500 leading-relaxed">
        <b>단타가 아닙니다.</b> 이 조건 묶음은 <b>상승추세 눌림목 역추세</b> 셋업입니다 —
        강한 추세(200일선 위) 안에서 단기 과매도(RSI·볼린저 하단)에 들어온 흑자 기업을 찾습니다.
        보유 기간은 수일~수주를 가정합니다.
        지표는 TradingView 스캐너(일봉 기준, RSI 14 · 볼린저 20일 2σ · SMA 200)에서 한 번에 받습니다.
        <b className="text-gray-700"> 조건이 그럴듯한 것과 돈이 되는 것은 다른 문제입니다</b> —
        이 화면은 "지금 무엇이 걸리는가" 만 보여줄 뿐, 걸린 뒤의 성과는 검증하지 않았습니다.
      </p>
    </div>
  );
}
