// 🏷️ 밸류업 명단 — 거래소 KIND 의 저PBR기업·고배당기업·밸류업 우수기업 목록(사용자 2026-11-02 "투자도구에 저PBR·고배당 목록").
//   명단은 크롤러가 매일 06:00 에 받아 둔 valueup-tags.json(꼬리표와 같은 파일, 추가 호출 0) + 현재가는 토스 배치(200종목/콜).
//   종목명을 누르면 📊종목정보 창. PC·모바일이 같은 컴포넌트를 쓴다.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTossPrices } from "../lib/api";
import { KIND_VALUEUP_URL, useValueupFile, type ValueupFile } from "../lib/valueupTags";
import { openStockInfo } from "../lib/tickPopup";

type Kind = "lowpbr" | "highdiv" | "excellent";
const KINDS: { key: Kind; label: string; note: string }[] = [
  { key: "lowpbr", label: "저PBR", note: "3년 누적 PBR 이 시장·업종 하위권(유가 25%·코스닥 10%)인데 개선계획을 내지 않은 기업 — 거래소가 매년 5월·11월 공표" },
  { key: "highdiv", label: "고배당", note: "기업가치 제고 계획 공시의 '고배당기업 여부'가 해당(조세특례제한법 104조의27 — 배당소득 분리과세 대상)" },
  { key: "excellent", label: "밸류업 우수", note: "거래소·금융위 밸류업 우수기업 시상" },
];
type SortKey = "name" | "pct" | "pbr" | "price";

interface Row { code: string; name: string; pbr?: number; sector?: string; base?: string; year?: string; awards?: string; also: string[] }

function rowsOf(f: ValueupFile | undefined, kind: Kind): Row[] {
  if (!f) return [];
  const also = (code: string) => [
    kind !== "lowpbr" && f.lowpbr?.[code] ? `저PBR ${f.lowpbr[code].pbr ?? ""}`.trim() : "",
    kind !== "highdiv" && f.highdiv?.[code] ? "고배당" : "",
    kind !== "excellent" && f.excellent?.[code] ? "밸류업★" : "",
  ].filter(Boolean);
  if (kind === "lowpbr") return Object.entries(f.lowpbr ?? {}).map(([code, v]) => ({ code, name: v.name, pbr: v.pbr, sector: v.sector, base: v.base, also: also(code) }));
  if (kind === "highdiv") return Object.entries(f.highdiv ?? {}).map(([code, v]) => ({ code, name: v.name, year: v.year, also: also(code) }));
  return Object.entries(f.excellent ?? {}).map(([code, v]) => ({ code, name: v.name, awards: v.awards.map(a => `${a.year} ${a.award}`).join(", "), also: also(code) }));
}

export function ValueupTab() {
  const file = useValueupFile();
  const [kind, setKind] = useState<Kind>("lowpbr");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "pbr", dir: 1 });
  const all = useMemo(() => rowsOf(file, kind), [file, kind]);
  const codes = useMemo(() => all.map(r => r.code), [all]);
  const pxQ = useQuery({
    queryKey: ["valueup-px", kind, codes.length],
    queryFn: () => fetchTossPrices(codes),
    enabled: codes.length > 0, staleTime: 30_000, refetchInterval: 60_000,
  });
  const px = useMemo(() => new Map((pxQ.data ?? []).map(p => [p.ticker, p])), [pxQ.data]);
  const pctOf = (code: string) => { const p = px.get(code); return p && p.prevClose > 0 ? (p.price / p.prevClose - 1) * 100 : null; };
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const list = k ? all.filter(r => r.name.toLowerCase().includes(k) || r.code.includes(k) || (r.sector ?? "").toLowerCase().includes(k)) : all.slice();
    const val = (r: Row): number | string | null =>
      sort.key === "name" ? r.name : sort.key === "pct" ? pctOf(r.code) : sort.key === "price" ? (px.get(r.code)?.price ?? null) : (r.pbr ?? null);
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, sort, px]);
  const onSort = (key: SortKey) => setSort(s => s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "pbr" || key === "name" ? 1 : -1 });
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={`px-1.5 py-1 font-semibold cursor-pointer select-none hover:text-gray-900 ${cls}`} onClick={() => onSort(key)}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  const meta = KINDS.find(k => k.key === kind)!;
  const count = (k: Kind) => Object.keys(file?.[k] ?? {}).length;
  const upCnt = rows.filter(r => (pctOf(r.code) ?? 0) > 0).length, dnCnt = rows.filter(r => (pctOf(r.code) ?? 0) < 0).length;

  return (
    <div className="space-y-2 max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm font-bold">
          {KINDS.map(k => (
            <button key={k.key} onClick={() => { setKind(k.key); setSort(k.key === "lowpbr" ? { key: "pbr", dir: 1 } : { key: "pct", dir: -1 }); }}
                    className={`px-3 py-1 ${kind === k.key ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {k.label} <span className="text-[11px] font-normal opacity-80">{count(k.key)}</span>
            </button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="종목명·코드·업종"
               className="px-2 py-1 text-sm border border-gray-300 rounded-lg w-40" />
        {pxQ.data && <span className="text-[11px] text-gray-500">오늘 <b className="text-rose-600">▲{upCnt}</b> · <b className="text-blue-600">▼{dnCnt}</b></span>}
        <a href={KIND_VALUEUP_URL[kind]} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-blue-600 underline">거래소 KIND 원본 ↗</a>
      </div>
      <div className="text-[11px] text-gray-500 leading-snug">
        {meta.note}. 명단은 매일 06:00 갱신{file?.meta?.builtAt ? ` (받은 시각 ${new Date(file.meta.builtAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })})` : ""} · 현재가 토스 1분마다 · 종목명을 누르면 종목정보.
      </div>
      {!file ? <div className="text-sm text-gray-400 py-6 text-center">명단을 불러오는 중…</div> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-1.5 py-1 w-8 text-right">#</th>
                {th("name", "종목")}
                {th("price", "현재가", "text-right")}
                {th("pct", "오늘", "text-right")}
                {kind === "lowpbr" && th("pbr", "PBR", "text-right")}
                {kind === "lowpbr" && <th className="px-1.5 py-1 font-semibold hidden sm:table-cell">업종</th>}
                {kind === "highdiv" && <th className="px-1.5 py-1 font-semibold text-right">사업연도</th>}
                {kind === "excellent" && <th className="px-1.5 py-1 font-semibold">수상</th>}
                <th className="px-1.5 py-1 font-semibold hidden sm:table-cell">함께 해당</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const p = px.get(r.code), pct = pctOf(r.code);
                const col = pct == null ? "text-gray-500" : pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-700";
                return (
                  <tr key={r.code} className="border-t border-gray-100 hover:bg-indigo-50/40">
                    <td className="px-1.5 py-1 text-right text-gray-400">{i + 1}</td>
                    <td className="px-1.5 py-1">
                      <button onClick={() => openStockInfo(r.code, r.name)} title={`${r.name}(${r.code}) — 종목정보`}
                              className="font-medium text-gray-800 hover:text-indigo-700 hover:underline text-left">{r.name}</button>
                      <span className="ml-1 text-[10px] text-gray-400">{r.code}</span>
                    </td>
                    <td className={`px-1.5 py-1 text-right ${col}`}>{p ? Math.round(p.price).toLocaleString() : ""}</td>
                    <td className={`px-1.5 py-1 text-right font-bold ${col}`}>{pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}</td>
                    {kind === "lowpbr" && <td className="px-1.5 py-1 text-right font-semibold text-slate-700" title={r.base ? `${r.base} 기준` : undefined}>{r.pbr ?? "—"}</td>}
                    {kind === "lowpbr" && <td className="px-1.5 py-1 text-gray-500 hidden sm:table-cell">{r.sector ?? ""}</td>}
                    {kind === "highdiv" && <td className="px-1.5 py-1 text-right text-gray-500">{r.year ?? ""}</td>}
                    {kind === "excellent" && <td className="px-1.5 py-1 text-gray-600">{r.awards}</td>}
                    <td className="px-1.5 py-1 hidden sm:table-cell">
                      <span className="flex gap-0.5">{r.also.map(t => (
                        <span key={t} className={`px-1 rounded border text-[10px] font-bold ${t.startsWith("저PBR") ? "border-slate-400 bg-slate-100 text-slate-700" : t === "고배당" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>{t}</span>
                      ))}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="text-sm text-gray-400 py-6 text-center">해당 종목이 없습니다</div>}
        </div>
      )}
    </div>
  );
}
