// 지수(소부장) — 단계별 4칸(기판 / 전공정 / 후공정 / 소재·부품)을 **한 화면에**(사용자 2026-11-02 "한 줄씩 하지 말고 화면을 4등분").
//   칸마다 해외 대장주(테두리 굵게, 미국은 간밤·일본은 지금 장중) ➜ 국내 종목. 카드는 최신공시·히트맵과 같은 QuoteCard(24시간·3개월 설정 따름).
//   칸 제목 옆 = 국내 종목 평균 등락률(동일가중) — 오늘 어느 단계가 강한지. PC 2×2, 모바일 세로로 한 칸씩.
//   + 수주·공급계약 공시(최근 5거래일, DART — 최신공시와 같은 서버 파일) · 칸별 외국인·기관(금융투자 제외) 5·20일 순매수
//     (크롤러 investor-flows.json — 수급 매집 탭과 같은 파일, 추가 호출 0). 사용자 2026-11-02 "1, 2번 진행".
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { US_PAIRS } from "../lib/usMarketData";
import { fetchDartBody, fetchDartCounts, fetchDartDayPreferServer, loadListedCorps, normCorp, parseContract, type DartRow } from "../lib/dartDisclosures";
import { classifyDisclosure, DEFAULT_DISC_CATS, DISC_CAT_TONE, type DiscCat } from "../lib/disclosureFilter";
import { openStockInfo } from "../lib/tickPopup";
import { loadInvestorFlows, type FlowStock } from "../lib/investorFlows";
import { openExternal } from "../lib/toss";
import { QuoteCard } from "./QuoteCard";

const NAME = new Map(US_PAIRS.map(p => [p.symbol, p.name]));

// 최근 5거래일 공시(이 페이지 국내 종목만, 잡음 뺀 주요 종류) — 날짜별 서버 파일. 0건 날(주말·휴장)은 건너뛴다
type DiscRow = DartRow & { cat: DiscCat };
async function loadRecentDisc(codes: Set<string>): Promise<DiscRow[]> {
  const counts = await fetchDartCounts();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const days = Object.keys(counts).filter(d => d <= today && counts[d] > 0).sort().slice(-5);
  if (!days.includes(today)) days.push(today);
  const [lists, corps] = await Promise.all([
    Promise.all(days.map(d => fetchDartDayPreferServer(d).then(x => x.rows).catch(() => [] as DartRow[]))),
    loadListedCorps().catch(() => new Map<string, string>()),
  ]);
  const out: DiscRow[] = [];
  const keep = new Set<DiscCat>(DEFAULT_DISC_CATS);
  for (const r of lists.flat()) {
    const code = r.code ?? corps.get(normCorp(r.corp));
    if (!code || !codes.has(code)) continue;
    const c = classifyDisclosure(r.title);
    if (c.noise || !keep.has(c.cat)) continue;
    out.push({ ...r, code, cat: c.cat });
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
  const disc = useQuery({
    queryKey: ["sobu-disc", [...krCodes].sort().join(",")], queryFn: () => loadRecentDisc(krCodes),
    staleTime: 5 * 60_000, refetchInterval: 10 * 60_000, retry: 1,
  });
  const contractRows = (disc.data ?? []).filter(r => r.cat === "계약");
  // 계약 공시 본문 → 금액·매출액 대비·상대(오늘·어제치는 서버 파일, 그 전은 직접 — 웹에선 프록시가 막으면 빈칸)
  const bodyQs = useQueries({
    queries: contractRows.map(r => ({
      queryKey: ["dart-contract", r.rcpNo], queryFn: async () => parseContract(await fetchDartBody(r.date, r.rcpNo)),
      staleTime: 24 * 3600_000, retry: 0,
    })),
  });
  const info = new Map(contractRows.map((r, i) => [r.rcpNo, bodyQs[i]?.data ?? null]));
  const [onlyContract, setOnlyContract] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const flows = useQuery({ queryKey: ["investor-flows"], queryFn: loadInvestorFlows, staleTime: 3 * 3600_000, retry: 1 });
  const flowBy = new Map<string, FlowStock>((flows.data?.stocks ?? []).map(x => [x.code, x]));
  const lastContract = new Map<string, DartRow>();
  for (const r of contractRows) if (r.code && !lastContract.has(r.code)) lastContract.set(r.code, r);
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
          <button onClick={() => openExternal(ct.url)} title={`${ct.date} ${ct.time} ${ct.title}${info.get(ct.rcpNo)?.amountEok ? ` — ${Math.round(info.get(ct.rcpNo)!.amountEok!).toLocaleString()}억` : ""} — 눌러서 DART 원문`}
                  className="absolute -top-1.5 right-1 z-10 px-1 rounded border border-violet-300 bg-violet-50 text-violet-700 text-[9px] font-bold leading-tight hover:bg-violet-100">
            📑수주 {md(ct.date)}
          </button>
        )}
      </div>
    );
  };
  const recent = (disc.data ?? []).filter(r => !onlyContract || r.cat === "계약");
  const shown = showAll ? recent : recent.slice(0, 10);
  return (
    <div className="space-y-2">
    {/* 최근 공시 한눈에 — 이 페이지 국내 종목, 5거래일. 계약은 금액·매출액 대비·상대까지(사용자 2026-11-02 "최근 계약이나 공시를 한눈에") */}
    <div className="rounded-lg border border-violet-200 bg-violet-50/30 p-2">
      <div className="flex items-center gap-2 mb-1 text-[12px]">
        <span className="font-bold text-violet-800">📑 최근 공시 · 이 페이지 종목 (5거래일)</span>
        <span className="inline-flex rounded border border-violet-300 overflow-hidden text-[11px]">
          {([false, true] as const).map(v => (
            <button key={String(v)} onClick={() => setOnlyContract(v)}
                    className={`px-1.5 ${onlyContract === v ? "bg-violet-600 text-white" : "bg-white text-gray-600 hover:bg-violet-100"}`}>
              {v ? `계약만 ${contractRows.length}` : `전체 ${(disc.data ?? []).length}`}
            </button>
          ))}
        </span>
        <span className="ml-auto text-[10px] text-gray-400">제목 = DART 원문 · 종목 = 종목정보</span>
      </div>
      {disc.isLoading ? <div className="text-[11px] text-gray-400">불러오는 중…</div>
        : !recent.length ? <div className="text-[11px] text-gray-400">없음</div>
        : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4">
            {shown.map(r => {
              const c = r.cat === "계약" ? info.get(r.rcpNo) : null;
              return (
                <div key={r.rcpNo} className="flex items-baseline gap-1.5 text-[11.5px] leading-5 min-w-0">
                  <span className="text-gray-400 tabular-nums shrink-0">{md(r.date)} {r.time}</span>
                  <button onClick={() => openStockInfo(r.code!, r.corp)} className="font-bold text-gray-800 hover:underline shrink-0">{r.corp}</button>
                  <span className={`shrink-0 px-1 rounded text-[10px] font-bold ${DISC_CAT_TONE[r.cat].tag}`}>{r.cat}</span>
                  <button onClick={() => openExternal(r.url)} title={r.title} className="truncate text-gray-600 hover:underline text-left min-w-0">
                    {c?.name ?? r.title.replace(/\s+/g, " ")}
                  </button>
                  {c?.amountEok != null && (
                    <span className="shrink-0 tabular-nums text-violet-800 font-bold"
                          title={[c.party && `상대 ${c.party}`, c.from && `기간 ${c.from} ~ ${c.to ?? ""}`].filter(Boolean).join(" · ")}>
                      {Math.round(c.amountEok).toLocaleString()}억{c.ratio != null ? <span className="font-normal text-gray-500"> (매출 {c.ratio}%)</span> : null}
                      {c.party && <span className="font-normal text-gray-500"> · {c.party.slice(0, 12)}</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {recent.length > 10 && (
        <button onClick={() => setShowAll(v => !v)} className="mt-0.5 text-[11px] text-violet-700 hover:underline">
          {showAll ? "접기" : `더 보기 (${recent.length - 10}건)`}
        </button>
      )}
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
