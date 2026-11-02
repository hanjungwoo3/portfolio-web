// 지수(소부장) — 단계별 4칸(기판 / 전공정 / 후공정 / 소재·부품)을 **한 화면에**(사용자 2026-11-02 "한 줄씩 하지 말고 화면을 4등분").
//   칸마다 해외 대장주(테두리 굵게, 미국은 간밤·일본은 지금 장중) ➜ 국내 종목. 카드는 최신공시·히트맵과 같은 QuoteCard(24시간·3개월 설정 따름).
//   칸 제목 옆 = 국내 종목 평균 등락률(동일가중) — 오늘 어느 단계가 강한지. PC 2×2, 모바일 세로로 한 칸씩.
//   + 수주·공급계약 공시(최근 5거래일, DART — 최신공시와 같은 서버 파일) · 칸별 외국인·기관(금융투자 제외) 5·20일 순매수
//     (크롤러 investor-flows.json — 수급 매집 탭과 같은 파일, 추가 호출 0). 사용자 2026-11-02 "1, 2번 진행".
import { useQuery } from "@tanstack/react-query";
import { US_PAIRS } from "../lib/usMarketData";
import { fetchDartCounts, fetchDartDayPreferServer, loadListedCorps, normCorp, type DartRow } from "../lib/dartDisclosures";
import { classifyDisclosure } from "../lib/disclosureFilter";
import { loadInvestorFlows, type FlowStock } from "../lib/investorFlows";
import { openExternal } from "../lib/toss";
import { QuoteCard } from "./QuoteCard";

const NAME = new Map(US_PAIRS.map(p => [p.symbol, p.name]));

// 최근 5거래일 수주·계약 공시(이 페이지 국내 종목만) — 날짜별 서버 파일. 0건 날(주말·휴장)은 건너뛴다
async function loadContracts(codes: Set<string>): Promise<DartRow[]> {
  const counts = await fetchDartCounts();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const days = Object.keys(counts).filter(d => d <= today && counts[d] > 0).sort().slice(-5);
  if (!days.includes(today)) days.push(today);
  const [lists, corps] = await Promise.all([
    Promise.all(days.map(d => fetchDartDayPreferServer(d).then(x => x.rows).catch(() => [] as DartRow[]))),
    loadListedCorps().catch(() => new Map<string, string>()),
  ]);
  const out: DartRow[] = [];
  for (const r of lists.flat()) {
    const code = r.code ?? corps.get(normCorp(r.corp));
    if (!code || !codes.has(code)) continue;
    const c = classifyDisclosure(r.title);
    if (c.cat !== "계약" || c.noise) continue;
    out.push({ ...r, code });
  }
  return out.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}
const eok = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(1)}억`;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");

export function SobuGrid({ rows, labels, leadByRow, quote }: {
  rows: string[][]; labels: string[]; leadByRow: number[];
  quote: (sym: string) => { price: number; pct: number } | undefined;
}) {
  // 다섯 단계 → 네 칸: 소재·부품을 한 칸으로
  const boxes: { label: string; lead: string[]; kr: string[] }[] = [];
  rows.forEach((r, i) => {
    const n = leadByRow[i] ?? 1;
    const lead = r.slice(0, n), kr = r.slice(n);
    if (i >= 4 && boxes[3]) { boxes[3].label = `${boxes[3].label}·${labels[i]}`; boxes[3].lead.push(...lead); boxes[3].kr.push(...kr); }
    else boxes.push({ label: labels[i], lead: [...lead], kr: [...kr] });
  });
  const krCodes = new Set(rows.flat().filter(s => /\.KS$/.test(s)).map(s => s.slice(0, 6)));
  const contracts = useQuery({
    queryKey: ["sobu-contracts", [...krCodes].sort().join(",")], queryFn: () => loadContracts(krCodes),
    staleTime: 5 * 60_000, refetchInterval: 10 * 60_000, retry: 1,
  });
  const flows = useQuery({ queryKey: ["investor-flows"], queryFn: loadInvestorFlows, staleTime: 3 * 3600_000, retry: 1 });
  const flowBy = new Map<string, FlowStock>((flows.data?.stocks ?? []).map(x => [x.code, x]));
  const lastContract = new Map<string, DartRow>();
  for (const r of contracts.data ?? []) if (r.code && !lastContract.has(r.code)) lastContract.set(r.code, r);
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const card = (sym: string, lead: boolean) => {
    const kr = /\.KS$/.test(sym);
    const code = kr ? sym.slice(0, 6) : sym;
    const q = quote(sym);
    const ct = kr ? lastContract.get(code) : undefined;
    return (
      <div key={sym} className={`relative ${lead ? "rounded-lg ring-2 ring-indigo-400" : ""}`}>
        <QuoteCard code={code} name={NAME.get(sym) ?? sym} px={q && q.price > 0 ? q : undefined} className="w-full h-[84px]" />
        {ct && (
          <button onClick={() => openExternal(ct.url)} title={`${ct.date} ${ct.time} ${ct.title} — 눌러서 DART 원문`}
                  className="absolute -top-1.5 right-1 z-10 px-1 rounded border border-violet-300 bg-violet-50 text-violet-700 text-[9px] font-bold leading-tight hover:bg-violet-100">
            📑수주 {md(ct.date)}
          </button>
        )}
      </div>
    );
  };
  const recent = contracts.data ?? [];
  return (
    <div className="space-y-2">
    {/* 최근 수주·공급계약 공시 — 장비주는 수주 공시가 주가를 가장 크게 움직인다 */}
    <div className="flex items-start gap-2 text-[11.5px]">
      <span className="shrink-0 font-bold text-violet-700">📑 수주·계약 공시 (최근 5거래일)</span>
      {contracts.isLoading ? <span className="text-gray-400">불러오는 중…</span>
        : !recent.length ? <span className="text-gray-400">없음</span>
        : <span className="flex flex-wrap gap-x-3 gap-y-0.5">{recent.slice(0, 12).map(r => (
            <button key={r.rcpNo} onClick={() => openExternal(r.url)} title={`${r.title} — 눌러서 DART 원문`}
                    className="text-left hover:underline">
              <span className="text-gray-400 tabular-nums">{md(r.date)} </span><b className="text-gray-800">{r.corp}</b>
              <span className="text-gray-600"> {r.title.replace(/\s+/g, " ").slice(0, 26)}</span>
            </button>
          ))}</span>}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      {boxes.map(b => {
        const ps = b.kr.map(s => quote(s)?.pct).filter((v): v is number => v != null && Number.isFinite(v));
        const avg = ps.length ? ps.reduce((a, v) => a + v, 0) / ps.length : null;
        const up = ps.filter(v => v > 0).length;
        // 칸 수급 — 국내 종목 외국인·기관(금융투자 제외) 누적 순매수 합(억원). 크롤러 기준일(전 거래일)까지
        const fsum = (w: "5" | "20", k: "fo" | "in") => b.kr.reduce((a, s) => a + (flowBy.get(s.slice(0, 6))?.w[w]?.[k] ?? 0), 0);
        const hasFlow = b.kr.some(s => flowBy.has(s.slice(0, 6)));
        return (
          <div key={b.label} className="rounded-lg border border-gray-200 bg-gray-50/50 pg-row p-2">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-bold text-gray-800">{b.label}</span>
              {avg != null && (
                <span className={`text-sm font-bold tabular-nums ${avg > 0 ? "text-rose-600" : avg < 0 ? "text-blue-600" : "text-gray-600"}`}
                      title="국내 종목 평균 등락률(동일가중)">
                  평균 {avg > 0 ? "+" : ""}{avg.toFixed(2)}%
                </span>
              )}
              {ps.length > 0 && <span className="text-[11px] text-gray-500">▲{up} · ▼{ps.length - up}</span>}
              <span className="ml-auto text-[10px] text-gray-400">테두리 = 해외 대장주</span>
            </div>
            {hasFlow && (
              <div className="flex flex-wrap gap-x-3 text-[11px] tabular-nums -mt-1 mb-1.5"
                   title={`국내 종목 누적 순매수 합 — 기관은 금융투자 제외(ETF·차익거래가 섞여 방향이 흐려진다). ${flows.data?.meta.asOf ?? ""} 기준`}>
                {(["5", "20"] as const).map(w => (
                  <span key={w}><span className="text-gray-400">{w}일</span>{" "}
                    외국인 <b className={tone(fsum(w, "fo"))}>{eok(fsum(w, "fo"))}</b>{" · "}
                    기관 <b className={tone(fsum(w, "in"))}>{eok(fsum(w, "in"))}</b>
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {b.lead.map(s => card(s, true))}
              {b.kr.map(s => card(s, false))}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
