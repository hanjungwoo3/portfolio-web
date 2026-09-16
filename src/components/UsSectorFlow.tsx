// 미국 섹터 흐름 — 지수 탭. 한국 섹터(ThemeFlow)와 같은 모양·같은 공식이다.
//   다른 건 데이터 출처(TradingView scanner 1콜)와 세션 표기(프리/정규/애프터)뿐이다.
//   카드를 누르면 그 묶음의 종목 목록이 열린다 — 스냅샷에 다 들어 있어 추가 조회가 없다.

import { useRef, useState } from "react";
import { signColor } from "../lib/format";
import { useEscClose } from "../lib/useEscClose";
import { US_BASIS_LABEL, US_GROUP_LABEL, US_UNIVERSE_DESC, US_UNIVERSE_LABEL } from "../lib/usSectorFlow";
import type { UsScanUniverse } from "../lib/api";
import type { UsBasis, UsGroupSource, UsSectorFlow as UsFlow, UsSectorStat, UsSectorStock } from "../lib/usSectorFlow";

// 한국 카드와 같은 접기 기준 — 산업은 100개라 전부 깔면 화면이 목록이 된다.
const TOP_FOLD = 15;

// 달러 큰 수 — 시총/거래대금용. 조 단위는 T, 십억은 B.
function fmtUsd(v: number): string {
  if (!(v > 0)) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${Math.round(v / 1e6).toLocaleString()}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

function tvUrl(s: UsSectorStock): string {
  return s.exchange
    ? `https://kr.tradingview.com/symbols/${s.exchange}-${s.ticker}/`
    : `https://kr.tradingview.com/symbols/${s.ticker}/`;
}

function UsSectorCard({ t, onClick }: { t: UsSectorStat; onClick: () => void }) {
  return (
    <button onClick={onClick}
            title={`${t.label} (${t.enName}) — ${t.total}종\n최고 ${t.best.name} ${t.best.pct.toFixed(2)}%`}
            className="w-full mb-2 break-inside-avoid text-left px-2.5 py-2 rounded-lg border
                       border-gray-200 bg-white hover:bg-gray-50 transition-colors">
      <span className="flex items-baseline gap-1.5">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{t.label}</span>
        {/* 표본이 8종 미만이면 중앙값이 한두 종목에 좌우된다 — 한국 카드와 같은 경고 */}
        <span className={`shrink-0 text-[10px] tabular-nums ${
                t.count < 8 ? "text-amber-600 font-bold" : "text-gray-400"}`}>
          {t.count}
        </span>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${signColor(t.median)}`}>
          {t.median > 0 ? "+" : ""}{t.median.toFixed(2)}%
        </span>
      </span>
      <span className="block mt-1 h-1 rounded bg-gray-200 overflow-hidden">
        <span className="block h-full bg-rose-400" style={{ width: `${Math.round(t.upRatio * 100)}%` }} />
      </span>
      <span className="mt-1 flex items-baseline gap-1 text-[11px]">
        <span className="flex-1 min-w-0 truncate text-gray-500">{t.best.ticker}</span>
        <span className={`shrink-0 tabular-nums ${signColor(t.best.pct)}`}>
          {t.best.pct > 0 ? "+" : ""}{t.best.pct.toFixed(2)}%
        </span>
      </span>
    </button>
  );
}

export function UsSectorFlow({ flow, onPick, onRefresh, refreshing, error,
                               source, onSource, universe, onUniverse }: {
  flow: UsFlow | null;
  onPick: (t: UsSectorStat) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  error?: Error | null;
  source: UsGroupSource;
  onSource: (s: UsGroupSource) => void;
  universe: UsScanUniverse;
  onUniverse: (u: UsScanUniverse) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const themes = flow?.themes ?? [];
  const many = themes.length > TOP_FOLD * 2;
  const shown = !many || expanded
    ? themes
    : [...themes.slice(0, TOP_FOLD), ...themes.slice(-TOP_FOLD)];
  const stamp = flow?.fetchedAt
    ? new Date(flow.fetchedAt + 9 * 3600_000).toISOString().slice(11, 16)   // KST HH:MM
    : null;

  return (
    <>
      {/* 묶음 기준 — 분류는 TradingView 것을 빌리고, 중앙값 계산은 한국 카드와 같은 공식이다 */}
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        {(Object.keys(US_GROUP_LABEL) as UsGroupSource[]).map(k => (
          <button key={k} onClick={() => onSource(k)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                    source === k ? "bg-gray-800 text-white border-gray-800"
                                 : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {US_GROUP_LABEL[k]}
          </button>
        ))}
        <span className="text-gray-300 mx-0.5">|</span>
        {/* 스캔 범위 — 넓힐수록 산업당 표본이 늘어 중앙값이 안정되고, 대신 응답이 무거워진다 */}
        {(Object.keys(US_UNIVERSE_LABEL) as UsScanUniverse[]).map(u => (
          <button key={u} onClick={() => onUniverse(u)} title={US_UNIVERSE_DESC[u]}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                    universe === u ? "bg-indigo-600 text-white border-indigo-600"
                                   : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {US_UNIVERSE_LABEL[u]}
          </button>
        ))}
        <span className="text-[10px] text-gray-400 ml-1">
          분류만 다르고 계산 기준은 한국 섹터와 같습니다
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 -mt-0.5 mb-1 flex-wrap">
        <span>
          {US_UNIVERSE_LABEL[universe]} · 거래대금 상위 20종의 중앙값 등락률 순 ·{" "}
          <span className="text-gray-400">
            {stamp ? `기준 ${stamp} · ` : ""}누르면 종목 목록
          </span>
        </span>
        {/* 프리/애프터면 그 세션 등락률이다 — 밝히지 않으면 정규장 수치로 오해한다 */}
        {flow && (
          <span className={`px-1.5 py-0.5 rounded font-medium ${
                  flow.basis === "regular" ? "bg-emerald-100 text-emerald-800"
                  : flow.basis === "closed" ? "bg-gray-100 text-gray-600"
                  : "bg-sky-100 text-sky-800"}`}>
            {US_BASIS_LABEL[flow.basis]} 기준 · {flow.scanned}종
          </span>
        )}
        {onRefresh && (
          <button onClick={onRefresh} disabled={refreshing}
                  title={`${US_UNIVERSE_DESC[universe]} — 다시 조회합니다 (프록시 1콜)`}
                  className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                             hover:bg-gray-100 disabled:opacity-50">
            {refreshing ? "조회 중…" : "🔄 새로고침"}
          </button>
        )}
      </div>

      {themes.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-gray-400">
          {refreshing ? "불러오는 중…"
            : error ? `데이터를 가져오지 못했습니다 — ${error.message}`
            : "데이터가 없습니다. 새로고침을 눌러 주세요."}
        </div>
      ) : (
        <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-6 gap-2">
          {shown.map(t => <UsSectorCard key={t.key} t={t} onClick={() => onPick(t)} />)}
        </div>
      )}

      {many && (
        <button onClick={() => setExpanded(v => !v)}
                className="mt-1 w-full py-1 rounded border border-gray-300 bg-white text-[11px]
                           text-gray-600 hover:bg-gray-50">
          {expanded
            ? `접기 (상·하위 ${TOP_FOLD}개씩)`
            : `전체 ${themes.length}개 보기 (지금은 상·하위 ${TOP_FOLD}개씩 ${TOP_FOLD * 2}개)`}
        </button>
      )}
    </>
  );
}

export function UsSectorDialog({ stat, basis, trimmed, onClose }: {
  stat: UsSectorStat;
  basis: UsBasis;
  /** 캐시 용량 때문에 종목 목록이 잘린 스냅샷인가 */
  trimmed?: boolean;
  onClose: () => void;
}) {
  // 등락률 순. 스냅샷에 다 있으므로 추가 조회가 없다(한국 팝업은 종목당 일봉을 받는다).
  const rows = [...stat.rows].sort((a, b) => b.pct - a.pct);
  const downOnBackdropRef = useRef(false);
  useEscClose(true, onClose);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) downOnBackdropRef.current = true; }}
         onMouseUp={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
           downOnBackdropRef.current = false;
         }}>
      <div className="w-full sm:max-w-5xl max-h-[85vh] overflow-hidden flex flex-col
                      rounded-t-xl sm:rounded-xl bg-white shadow-xl"
           onMouseDown={e => e.stopPropagation()}>
        <header className="px-4 py-3 border-b bg-gray-50 flex items-baseline gap-2">
          <h2 className="text-base font-bold text-gray-800">{stat.label}</h2>
          {stat.enName !== stat.label && (
            <span className="text-[11px] text-gray-400">{stat.enName}</span>
          )}
          <span className="text-[11px] text-gray-500">
            {stat.total}종 · 상위 20 중앙값{" "}
            <span className={`font-bold tabular-nums ${signColor(stat.median)}`}>
              {stat.median > 0 ? "+" : ""}{stat.median.toFixed(2)}%
            </span>
            {" · "}{US_BASIS_LABEL[basis]} 기준
            {trimmed && (
              <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-amber-800">
                캐시본 — 상위 {stat.rows.length}종만
              </span>
            )}
          </span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </header>

        <div className="overflow-y-auto overscroll-contain px-3 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {rows.map((r, i) => (
              <a key={r.ticker} href={tvUrl(r)} target="_blank" rel="noreferrer"
                 className="min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 bg-white
                            hover:bg-gray-50 transition-colors">
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] tabular-nums text-gray-400 w-5 shrink-0">#{i + 1}</span>
                  {r.logoid && (
                    <img src={`https://s3-symbol-logo.tradingview.com/${r.logoid}.svg`} alt=""
                         loading="lazy" className="w-4 h-4 rounded-full shrink-0 bg-gray-100" />
                  )}
                  <span className="flex-1 min-w-0 truncate text-xs font-bold text-gray-800">{r.ticker}</span>
                  <span className={`shrink-0 text-xs font-bold tabular-nums ${signColor(r.pct)}`}>
                    {r.pct > 0 ? "+" : ""}{r.pct.toFixed(2)}%
                  </span>
                </span>
                <span className="block mt-0.5 truncate text-[10px] text-gray-500">{r.name}</span>
                <span className="mt-0.5 flex items-baseline gap-1.5 text-[10px] tabular-nums text-gray-400">
                  <span className="text-gray-700">${r.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  <span title="시가총액">{fmtUsd(r.cap)}</span>
                  <span className="ml-auto" title="거래대금">{fmtUsd(r.value)}</span>
                </span>
              </a>
            ))}
          </div>
        </div>

        <p className="px-3 py-2 text-[10px] text-gray-400 border-t leading-relaxed">
          {stat.rows.length}종 전체 · 등락률 순. 분류(섹터·산업)는 TradingView 기준이며 이름만 우리말로 옮겼습니다.
          카드의 중앙값은 이 중 <b>거래대금 상위 20종</b>으로 계산합니다 — 한국 섹터 카드와 같은 공식입니다.
          종목을 누르면 TradingView 가 열립니다. 숫자는 각각 현재가 · 시가총액 · 거래대금입니다.
        </p>
      </div>
    </div>
  );
}
