// 카드의 공시 종류 꼬리표(실적·계약·합병·분할…, 최근 5거래일) — 누르면 그 종목 공시 목록 창(계약은 금액·매출 대비).
//   지수 탭 카드·내 종목 카드(PC·모바일)·시세 카드가 같이 쓴다(사용자 2026-11-03). 자료 = lib/recentDisclosures(전 종목 한 번).
import { useEffect, useState } from "react";
import { useHoverLayer, layerStyle } from "../lib/useHoverLayer";
import { createPortal } from "react-dom";
import { useQueries } from "@tanstack/react-query";
import { useRecentDisc, type DiscRow } from "../lib/recentDisclosures";
import { DISC_CAT_TONE } from "../lib/disclosureFilter";
import { fetchDartBody, parseContract } from "../lib/dartDisclosures";
import { openExternal } from "../lib/toss";
import { openGoogleAi, discAiQuery } from "../lib/googleAi";

export function DiscTags({ code, name, size = "xs", max = 3 }: { code: string | null | undefined; name?: string; size?: "xs" | "sm"; max?: number }) {
  const map = useRecentDisc(!!code);
  const k = (code ?? "").replace(/^A/, "").replace(/\.(KS|KQ)$/, "");
  const rows = k ? map.get(k) ?? [] : [];
  const hl = useHoverLayer();   // 마우스를 올리면 목록(사용자 2026-11-03), 누르기도 그대로
  // 꼬리표마다 그 종류 공시만(사용자 2026-11-07 "합병분할·증자CB 를 각각 내용만") — 마지막으로 올린 꼬리표의 종류
  const [cat, setCat] = useState<string | null>(null);
  if (!rows.length) return null;
  const cats = [...new Set(rows.map(r => r.cat))].slice(0, max);
  const fs = size === "xs" ? "text-[9px]" : "text-[10px]";
  return (
    <>
      {cats.map(c => (
        <button key={c} type="button" data-disc-popup
                onClick={e => { e.preventDefault(); e.stopPropagation(); setCat(c); if (hl.pos && cat === c) hl.close(); else hl.enter(e); }}
                onMouseEnter={e => { setCat(c); hl.enter(e); }} onMouseLeave={hl.leave}
                className={`px-1 py-0 rounded border font-bold leading-tight whitespace-nowrap hover:brightness-95 ${fs} ${DISC_CAT_TONE[c].tag}`}>
          {c}
        </button>
      ))}
      {/* 카드 안(쌓임 맥락·transform)에 그리면 옆 카드 책갈피가 창을 덮는다 → body 로 */}
      {hl.pos && createPortal(<DiscPopup rows={cat ? rows.filter(r => r.cat === cat) : rows} name={`${name ?? rows[0].corp}${cat ? ` · ${cat}` : ""}`} style={layerStyle(hl.pos, 340, 250)} onClose={hl.close} onEnter={hl.keep} onLeave={hl.leave} />, document.body)}
    </>
  );
}

function DiscPopup({ rows, name, style, onClose, onEnter, onLeave }: { rows: DiscRow[]; name: string; style: { left: number; top?: number; bottom?: number; width: number; maxHeight?: number }; onClose: () => void; onEnter: () => void; onLeave: () => void }) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.("[data-disc-popup]")) onClose(); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const contracts = rows.filter(r => r.cat === "계약");
  const qs = useQueries({ queries: contracts.map(r => ({ queryKey: ["dart-contract", r.rcpNo], queryFn: async () => parseContract(await fetchDartBody(r.date, r.rcpNo)), staleTime: 24 * 3600_000, retry: 0 })) });
  const info = new Map(contracts.map((r, i) => [r.rcpNo, qs[i]?.data ?? null]));
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  return (
    <div data-disc-popup className="fixed z-[1000] rounded-lg border border-gray-300 bg-white shadow-xl p-2 text-[11px] max-h-[250px] overflow-y-auto pg-card"
         style={style} onClick={e => e.stopPropagation()} onMouseEnter={onEnter} onMouseLeave={onLeave}>
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
            <button onClick={() => openGoogleAi(discAiQuery(r.corp, r.code, r.title, `${r.date} ${r.time}`, r.url))}
                    title="구글 AI에 이 공시 요약 요청"
                    className="shrink-0 px-1 rounded border border-blue-300/70 bg-blue-50 text-blue-700 text-[9px] font-bold leading-[14px] hover:bg-blue-100">AI</button>
          </div>
        );
      })}
    </div>
  );
}
