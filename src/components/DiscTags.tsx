// 카드의 공시 종류 꼬리표(실적·계약·합병·분할…, 최근 5거래일) — 누르면 그 종목 공시 목록 창(계약은 금액·매출 대비).
//   지수 탭 카드·내 종목 카드(PC·모바일)·시세 카드가 같이 쓴다(사용자 2026-11-03). 자료 = lib/recentDisclosures(전 종목 한 번).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueries } from "@tanstack/react-query";
import { useRecentDisc, type DiscRow } from "../lib/recentDisclosures";
import { DISC_CAT_TONE } from "../lib/disclosureFilter";
import { fetchDartBody, parseContract } from "../lib/dartDisclosures";
import { openExternal } from "../lib/toss";
import { openGoogleAi, aiNowStamp } from "../lib/googleAi";

export function DiscTags({ code, name, size = "xs", max = 3 }: { code: string | null | undefined; name?: string; size?: "xs" | "sm"; max?: number }) {
  const map = useRecentDisc(!!code);
  const k = (code ?? "").replace(/^A/, "").replace(/\.(KS|KQ)$/, "");
  const rows = k ? map.get(k) ?? [] : [];
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!rows.length) return null;
  const cats = [...new Set(rows.map(r => r.cat))].slice(0, max);
  const fs = size === "xs" ? "text-[9px]" : "text-[10px]";
  return (
    <>
      {cats.map(c => (
        <button key={c} type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPos(p => (p ? null : { x: r.left, y: r.bottom + 4 })); }}
                title={`최근 5거래일 공시 — ${rows.filter(r => r.cat === c).map(r => r.title.replace(/\s+/g, " ")).slice(0, 3).join(" / ")}`}
                className={`px-1 py-0 rounded border font-bold leading-tight whitespace-nowrap hover:brightness-95 ${fs} ${DISC_CAT_TONE[c].tag}`}>
          {c}
        </button>
      ))}
      {/* 카드 안(쌓임 맥락·transform)에 그리면 옆 카드 책갈피가 창을 덮는다 → body 로 */}
      {pos && createPortal(<DiscPopup rows={rows} name={name ?? rows[0].corp} x={pos.x} y={pos.y} onClose={() => setPos(null)} />, document.body)}
    </>
  );
}

function DiscPopup({ rows, name, x, y, onClose }: { rows: DiscRow[]; name: string; x: number; y: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.("[data-disc-popup]")) onClose(); };
    const onScroll = (e: Event) => { if (e.target === document || e.target === document.documentElement) onClose(); };
    window.addEventListener("keydown", onKey); window.addEventListener("mousedown", onDown); window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onScroll, true); };
  }, [onClose]);
  const contracts = rows.filter(r => r.cat === "계약");
  const qs = useQueries({ queries: contracts.map(r => ({ queryKey: ["dart-contract", r.rcpNo], queryFn: async () => parseContract(await fetchDartBody(r.date, r.rcpNo)), staleTime: 24 * 3600_000, retry: 0 })) });
  const info = new Map(contracts.map((r, i) => [r.rcpNo, qs[i]?.data ?? null]));
  const W = 340;
  const left = Math.max(8, Math.min(x, window.innerWidth - W - 8));
  const top = y + 260 > window.innerHeight ? Math.max(8, y - 270) : y;
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  return (
    <div data-disc-popup className="fixed z-[1000] rounded-lg border border-gray-300 bg-white shadow-xl p-2 text-[11px] max-h-[250px] overflow-y-auto pg-card"
         style={{ left, top, width: W }} onClick={e => e.stopPropagation()}>
      <div className="flex items-center mb-1">
        <span className="font-bold text-[12px] text-gray-800">{name} · 공시 <span className="font-normal text-gray-400">5거래일 {rows.length}건</span></span>
        <button onClick={onClose} className="ml-auto px-1 text-gray-400 hover:text-gray-700" title="닫기 (Esc)">✕</button>
      </div>
      {rows.map(r => {
        const c = info.get(r.rcpNo);
        return (
          <div key={r.rcpNo} className="flex items-baseline gap-1 leading-[18px] min-w-0">
            <span className="text-gray-400 tabular-nums shrink-0">{md(r.date)} {r.time}</span>
            <span className={`shrink-0 px-0.5 rounded text-[9.5px] font-bold ${DISC_CAT_TONE[r.cat].tag}`}>{r.cat}</span>
            <button onClick={() => openExternal(r.url)} title={`${r.title}${c?.party ? ` · 상대 ${c.party}` : ""} — DART 원문`} className="truncate text-gray-700 hover:underline text-left min-w-0">
              {c?.amountEok != null ? <b className="text-violet-800">{Math.round(c.amountEok).toLocaleString()}억{c.ratio != null ? `(${c.ratio}%)` : ""} </b> : null}
              {c?.name ?? r.title.replace(/\s+/g, " ")}
            </button>
            <button onClick={() => openGoogleAi(`${aiNowStamp()} 기준. ${r.corp} ${r.date} 공시 "${r.title}" 의 핵심 내용과 주가에 미칠 영향을 요약해 줘. 원문: ${r.url}`)}
                    title="구글 AI에 이 공시 요약 요청"
                    className="shrink-0 px-1 rounded border border-blue-300/70 bg-blue-50 text-blue-700 text-[9px] font-bold leading-[14px] hover:bg-blue-100">AI</button>
          </div>
        );
      })}
    </div>
  );
}
