// 수급 매집 — 외국인 · 기관(금투 제외) · 연기금이 기간 동안 얼마나 사 모았나(시총 대비).
//   데이터는 크롤러가 매일 06:00 KST 에 계산한 JSON(lib/investorFlows) — 화면은 0콜.
//   백테스트상 의미 있던 건 '셋 다 같이, 크게' 뿐이라 그걸 기본 화면·강조로 둔다.

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTossPrices } from "../lib/api";
import {
  loadInvestorFlows, rankFlows, FLOW_BACKTEST, INVESTOR_LABEL,
  type FlowInvestor, type FlowWindow, type RankedFlow,
} from "../lib/investorFlows";

// 주체 색 — 미니 차트 선과 표 머리를 같은 색으로
const INV_COLOR: Record<FlowInvestor, string> = { fo: "#0ea5e9", in: "#f59e0b", pe: "#10b981" };
const INV_TEXT: Record<FlowInvestor, string> = { fo: "text-sky-600", in: "text-amber-600", pe: "text-emerald-600" };

// 정렬 가능한 머리 — 누를 때마다 큰 순 → 작은 순 → 기본 순위
function SortTh({ k, sort, onSort, children, className = "", title }: {
  k: SortKey; sort: { key: SortKey; dir: 1 | -1 } | null; onSort: (k: SortKey) => void;
  children: ReactNode; className?: string; title?: string;
}) {
  return (
    <th className={`font-normal px-1.5 ${className}`} title={title}>
      <button onClick={() => onSort(k)} className={`hover:text-gray-900 ${sort?.key === k ? "text-gray-900 font-bold" : ""}`}>
        {children}{sort?.key === k ? (sort.dir === 1 ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );
}

/** 60일 미니 선 — 한 선에 한 가지만(주가 / 외국인 / 기관 / 연기금 각각 따로, 각자 눈금).
 *  zero=true 면 0 선(점선)을 긋는다(누적 순매수용). 오른쪽 음영 = 지금 보는 기간. */
function MiniLine({ data, color, win, zero = false, w = 64, h = 22 }: {
  data: number[]; color: string; win: FlowWindow; zero?: boolean; w?: number; h?: number;
}) {
  if (data.length < 5) return <span className="text-[10px] text-gray-300">—</span>;
  const n = data.length;
  const lo = zero ? Math.min(0, ...data) : Math.min(...data);
  const hi = zero ? Math.max(0, ...data) : Math.max(...data);
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (v: number) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
  const shadeX = x(Math.max(0, n - win));
  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <rect x={shadeX} y={0} width={w - shadeX} height={h} fill="#f3f4f6" />
      {zero && <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeDasharray="2 2" />}
      <polyline points={data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
                fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  );
}
const cumsum = (a: number[]) => { let t = 0; return a.map(v => (t += v)); };

interface Props {
  onOpenValuation?: (ticker: string, name?: string) => void;
}

const WHO: [FlowInvestor | "all", string][] = [["all", "셋 다 공통"], ["fo", "외국인"], ["in", "기관(금투 제외)"], ["pe", "연기금"]];
const WINS: FlowWindow[] = [5, 20, 60];
const MKTS = ["전체", "코스피", "코스닥"] as const;
const PAGE = 40;
type SortKey = "today" | "cap" | "fo" | "in" | "pe" | "r5" | "r20" | "r60" | "dots" | "fr" | "streak";

const sgn = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");
const eok = (v: number) => (Math.abs(v) >= 10000 ? `${sgn(v / 10000, 1)}조` : `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString()}억`);
const capTxt = (e: number) => (e >= 10000 ? `${(e / 10000).toFixed(1)}조` : `${Math.round(e).toLocaleString()}억`);

export function AccumTab({ onOpenValuation }: Props) {
  const q = useQuery({ queryKey: ["investor-flows"], queryFn: loadInvestorFlows, staleTime: 30 * 60_000, refetchOnWindowFocus: false });
  const [who, setWho] = useState<FlowInvestor | "all">("all");
  const [win, setWin] = useState<FlowWindow>(20);
  const [mkt, setMkt] = useState<(typeof MKTS)[number]>("전체");
  const [onlyTop, setOnlyTop] = useState(true);
  const [shown, setShown] = useState(PAGE);
  // 머리를 누르면 그 열로 정렬(다시 누르면 방향 반대). null = 기본 순위.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const ranked = useMemo(() => {
    if (!q.data) return [] as RankedFlow[];
    let r = rankFlows(q.data.stocks, win, who);
    if (mkt !== "전체") r = r.filter(x => x.s.market === mkt);
    if (who === "all" && onlyTop) r = r.filter(x => x.all3Top30);
    return r;
  }, [q.data, win, who, mkt, onlyTop]);

  // 오늘 현재가·등락 — 기준일 데이터는 어제라 보이는 행만 실시간으로 붙인다(200종까지 1콜)
  // '오늘' 열로도 정렬할 수 있게 걸린 종목 전체 가격을 받는다(200종당 1콜). 호출 수 때문에 2분 간격.
  const visCodes = useMemo(() => ranked.map(r => r.s.code), [ranked]);
  const pxQ = useQuery({
    queryKey: ["accum-px", visCodes.join(",")],
    queryFn: () => fetchTossPrices(visCodes),
    enabled: visCodes.length > 0, staleTime: 60_000, refetchInterval: 120_000,
  });
  const px = useMemo(() => new Map((pxQ.data ?? []).map(p => [p.ticker, p])), [pxQ.data]);
  const todayChg = (code: string) => {
    const p = px.get(code);
    return p && p.prevClose > 0 ? (p.price / p.prevClose - 1) * 100 : null;
  };
  const rows = useMemo(() => {
    if (!sort) return ranked;
    const val = (r: RankedFlow): number | null => {
      const w = (n: number) => r.s.w[String(n) as "5" | "20" | "60"];
      switch (sort.key) {
        case "today": return todayChg(r.s.code);
        case "cap": return r.s.capEok;
        case "fo": return r.win.foR;
        case "in": return r.win.inR;
        case "pe": return r.win.peR;
        case "r5": return w(5)?.ret ?? null;
        case "r20": return w(20)?.ret ?? null;
        case "r60": return w(60)?.ret ?? null;
        case "dots": return WINS.filter(n => { const x = w(n); return x && x.fo > 0 && x.in > 0 && x.pe > 0; }).length;
        case "fr": return r.s.fr ? r.s.fr[0] - r.s.fr[1] : null;
        case "streak": return Math.max(r.s.streak.fo, r.s.streak.in, r.s.streak.pe);
      }
    };
    // 값 없는 행은 방향과 상관없이 맨 뒤
    return [...ranked].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null) return y == null ? 0 : 1;
      if (y == null) return -1;
      return (y - x) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, sort, px]);
  const sortBy = (key: SortKey) => {
    setShown(PAGE);
    setSort(cur => (cur?.key === key ? (cur.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  };
  const sp = { sort, onSort: sortBy };

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md border text-[12px] font-bold ${on ? "border-gray-800 bg-gray-800 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-300 bg-white p-3 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-base font-bold text-gray-800">🧲 수급 매집</span>
          <span className="text-[12px] text-gray-500">외국인 · 기관(금투 제외) · 연기금이 기간 동안 사 모은 양 (시총 대비)</span>
          {q.data && (
            <span className="ml-auto text-[11px] text-gray-400">
              기준일 {q.data.meta.asOf} · 시총 {q.data.meta.minCapEok.toLocaleString()}억+ {q.data.meta.count.toLocaleString()}종 · 매일 아침 갱신
            </span>
          )}
        </div>
        <div className="text-[11px] text-gray-500 leading-relaxed">
          과거에 의미가 있던 건 <b>셋이 같이, 크게</b> 사 모은 종목뿐이었어요(아래 표).
          한 주체만 사거나, 며칠 연속 샀다는 것만으로는 오히려 나빴고, <b>사 모았는데 주가가 안 오른 종목</b>이 가장 나빴습니다.
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {WHO.map(([k, l]) => <button key={k} className={chip(who === k)} onClick={() => { setWho(k); setShown(PAGE); }}>{l}</button>)}
          <span className="mx-1 text-gray-300">|</span>
          {WINS.map(w => <button key={w} className={chip(win === w)} onClick={() => { setWin(w); setShown(PAGE); }}>{w}일</button>)}
          <span className="mx-1 text-gray-300">|</span>
          {MKTS.map(m => <button key={m} className={chip(mkt === m)} onClick={() => { setMkt(m); setShown(PAGE); }}>{m}</button>)}
          {who === "all" && (
            <label className="ml-1 inline-flex items-center gap-1 text-[12px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={onlyTop} onChange={e => { setOnlyTop(e.target.checked); setShown(PAGE); }} />
              셋 다 상위 30%만
            </label>
          )}
        </div>
      </div>

      {q.isError && <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[12px] text-rose-700">데이터를 못 가져왔습니다 — {(q.error as Error)?.message}</div>}
      {q.isLoading && <div className="text-[12px] text-gray-400 px-1">불러오는 중…</div>}

      {q.data && (
        <div className="rounded-xl border border-gray-300 bg-white p-2">
          <div className="px-1 pb-1.5 text-[11px] text-gray-500">
            {ranked.length.toLocaleString()}종 · 정렬: {sort ? "열 머리 기준 (한 번 더 누르면 반대, 세 번째는 기본 순위)" : who === "all" ? "셋 중 가장 약한 쪽의 순위(셋이 고르게 많이 산 순)" : `${INVESTOR_LABEL[who]} 순매수 ÷ 시총`}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums whitespace-nowrap">
              <thead className="text-[11px] text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="text-left font-normal px-1.5 py-1">종목</th>
                  <SortTh {...sp} k="today" className="text-right">오늘</SortTh>
                  <SortTh {...sp} k="cap" className="text-right">시총</SortTh>
                  {(["fo", "in", "pe"] as FlowInvestor[]).map(k => (
                    <SortTh key={k} {...sp} k={k} className={`text-right ${INV_TEXT[k]}`} title={`${win}일 순매수 ÷ 시총 순`}>
                      {INVESTOR_LABEL[k]} <span className="text-gray-400">(시총 % · 60일 누적)</span>
                    </SortTh>
                  ))}
                  <SortTh {...sp} k="r5" className="text-right">5일 주가</SortTh>
                  <SortTh {...sp} k="r20" className="text-right">20일</SortTh>
                  <SortTh {...sp} k="r60" className="text-right">60일</SortTh>
                  <SortTh {...sp} k="dots" title="기간마다 외·기·연 셋 다 순매수였나 — 길게 꾸준히 사는지, 최근에만 샀는지">셋 다 5·20·60</SortTh>
                  <SortTh {...sp} k="fr" className="text-right" title="외국인 지분율 — 지금 (60일 변화). 정렬은 변화 순">외인 지분</SortTh>
                  <th className="text-left font-normal px-1.5" title="60일 주가 — 음영 = 보는 기간. 주체별 누적 순매수 선은 각 열 안에 따로 그렸다">60일 주가</th>
                  <SortTh {...sp} k="streak" className="text-left" title="정렬은 셋 중 가장 긴 연속 매수일 순">연속 매수일</SortTh>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map(r => {
                  const accum = who === "all" ? true : r.win[who] > 0;
                  const notUp = accum && r.win.ret <= 0;
                  return (
                    <tr key={r.s.code} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-1.5 py-1">
                        <button onClick={() => onOpenValuation?.(r.s.code, r.s.name)} className="font-bold text-gray-800 hover:underline">{r.s.name}</button>
                        <span className="ml-1 text-[10px] text-gray-400">{r.s.code}</span>
                        {r.s.ind && <span className="ml-1 text-[10px] text-gray-500">· {r.s.ind}</span>}
                        {/* '셋 다 공통' 화면에선 모두 해당이라 생략 — 한 주체로 볼 때만 '셋 다' 인 종목을 표시 */}
                        {r.all3Top30 && who !== "all" && <span className="ml-1 px-1 rounded bg-amber-100 text-amber-800 text-[10px] font-bold" title="외·기·연 셋 다 매집 상위 30% — 백테스트에서 유일하게 일관되게 좋았던 조합">★ 셋 다</span>}
                        {notUp && <span className="ml-1 px-1 rounded bg-gray-100 text-gray-500 text-[10px]" title="사 모았는데 주가가 안 올랐다 — 과거엔 이 경우가 가장 나빴다">주가 반응 없음</span>}
                      </td>
                      <td className="text-right px-1.5">
                        {(() => {
                          const p = px.get(r.s.code);
                          if (!p || !(p.prevClose > 0)) return <span className="text-gray-300">—</span>;
                          const chg = (p.price / p.prevClose - 1) * 100;
                          return <><span className="text-gray-700">{p.price.toLocaleString()}</span> <span className={tone(chg)}>{sgn(chg, 1)}%</span></>;
                        })()}
                      </td>
                      <td className="text-right px-1.5 text-gray-500">{capTxt(r.s.capEok)}</td>
                      {(["fo", "in", "pe"] as FlowInvestor[]).map(k => (
                        <td key={k} className={`text-right px-1.5 ${who === k ? "bg-gray-50" : ""}`}>
                          <div className="inline-flex items-center gap-1.5">
                            <span>
                              <span className={tone(r.win[k])}>{eok(r.win[k])}</span>
                              <span className="ml-1 text-[10px] text-gray-400">({sgn(r.win[`${k}R` as const], 2)}%)</span>
                            </span>
                            {r.s.s && <MiniLine data={cumsum(r.s.s[k])} color={INV_COLOR[k]} win={win} zero />}
                          </div>
                        </td>
                      ))}
                      {WINS.map(n => {
                        const w = r.s.w[String(n) as "5" | "20" | "60"];
                        return <td key={n} className={`text-right px-1.5 ${w ? tone(w.ret) : "text-gray-300"} ${n === win ? "font-bold" : ""}`}>{w ? `${sgn(w.ret, 1)}%` : "—"}</td>;
                      })}
                      <td className="px-1.5 text-center tracking-wider">
                        {WINS.map(n => {
                          const w = r.s.w[String(n) as "5" | "20" | "60"];
                          const all = !!w && w.fo > 0 && w.in > 0 && w.pe > 0;
                          return <span key={n} title={`${n}일: ${all ? "셋 다 순매수" : "셋 다는 아님"}`} className={all ? "text-amber-500" : "text-gray-300"}>{all ? "●" : "○"}</span>;
                        })}
                      </td>
                      <td className="text-right px-1.5">
                        {r.s.fr ? <>
                          <span className="text-gray-700">{r.s.fr[0].toFixed(1)}%</span>
                          <span className={`ml-1 text-[10px] ${tone(r.s.fr[0] - r.s.fr[1])}`}>{sgn(r.s.fr[0] - r.s.fr[1], 1)}p</span>
                        </> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-1.5 py-0.5">{r.s.s ? <MiniLine data={r.s.s.c} color="#6b7280" win={win} w={90} /> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-1.5 text-[11px] text-gray-500">
                        {(["fo", "in", "pe"] as FlowInvestor[]).map(k => r.s.streak[k] > 0 && (
                          <span key={k} className="mr-1.5">{INVESTOR_LABEL[k]} {r.s.streak[k]}</span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ranked.length === 0 && <div className="text-[12px] text-gray-400 p-2">조건에 맞는 종목이 없습니다.</div>}
          {shown < ranked.length && (
            <button onClick={() => setShown(s => s + PAGE)} className="mt-2 w-full py-1.5 rounded-md border border-gray-200 text-[12px] text-gray-600 hover:bg-gray-50">
              더 보기 ({(ranked.length - shown).toLocaleString()}종 남음)
            </button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-300 bg-white p-3 space-y-2">
        <div className="text-[12px] font-bold text-gray-700">백테스트 — 매집 신호 뒤 N일, 같은 날 전체 종목 평균 대비(%p)</div>
        <div className="overflow-x-auto">
          <table className="text-[11px] tabular-nums whitespace-nowrap">
            <thead className="text-gray-500">
              <tr><th className="text-left pr-3 font-normal">조건</th><th className="px-2 font-normal">건수</th><th className="px-2 font-normal">5일</th><th className="px-2 font-normal">10일</th><th className="px-2 font-normal">20일</th><th className="px-2 font-normal">20일 앞/뒤 절반</th></tr>
            </thead>
            <tbody>
              {FLOW_BACKTEST.map(b => (
                <tr key={b.label} className={`border-t border-gray-100 ${b.good ? "" : "text-gray-500"}`}>
                  <td className={`pr-3 py-1 ${b.good ? "font-bold text-gray-800" : ""}`}>{b.good ? "✅ " : "⚠️ "}{b.label}</td>
                  <td className="px-2 text-center">{b.n.toLocaleString()}</td>
                  <td className={`px-2 text-center ${tone(b.d5)}`}>{sgn(b.d5)}</td>
                  <td className={`px-2 text-center ${tone(b.d10)}`}>{sgn(b.d10)}</td>
                  <td className={`px-2 text-center ${tone(b.d20)}`}>{sgn(b.d20)}</td>
                  <td className="px-2 text-center">{b.halves}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="text-[11px] text-gray-500 space-y-0.5 list-disc pl-4 leading-relaxed">
          <li>기간 2026-01 ~ 2026-09(160거래일) — 토스 수급 이력이 200일까지라 짧습니다. 방향은 일관됐지만 크기는 달라질 수 있어요.</li>
          <li>매집 크기 = 기간 누적 순매수 금액 ÷ <b>그 기간 시작일 시총</b>. 종목 크기와 상관없이 비교됩니다.</li>
          <li>기관은 <b>금융투자를 뺐습니다</b> — ETF 설정·차익·헤지 물량이 섞여 방향이 흐려집니다.</li>
          <li>수급은 장 마감 뒤 확정돼 <b>다음 날 아침</b>에 반영됩니다. 오늘 장중 매매는 들어 있지 않아요.</li>
        </ul>
      </div>
    </div>
  );
}
