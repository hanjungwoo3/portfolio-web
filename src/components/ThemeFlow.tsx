// 섹터 흐름 — 지수 탭. "오늘 어느 테마가 강세인가" 한 가지만 답한다.
//
// 카드 = 네이버 테마 종목 바스켓(themeFlow.ts 주석 참조). ETF 랭킹 탭의 섹터 카드와는
//   다른 축이다 — 저쪽은 ETF 를 나누고, 여기는 종목을 나눈다.
//
// ★ 데이터는 '스냅샷' 이다. 419종 시세 = 약 3 프록시 콜이라 폴링에 못 태운다.
//   지수 탭의 다른 카드가 실시간인 것과 달리 여기는 '기준 시각' 이 붙는다.

import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTossKrCandles } from "../lib/api";
import { signColor, isKrHoldingClosed } from "../lib/format";
import type { ThemeStat, ThemeStock, GroupSource } from "../lib/themeFlow";
import { GROUP_SOURCE_LABEL } from "../lib/themeFlow";
import { SimplePriceCard } from "./SimplePriceCard";
import { useEscClose } from "../lib/useEscClose";
import { getDimSleepingEnabled } from "../lib/proxyConfig";

// 카드가 53(테마)·43(업종)·177(네이버 테마)개다. 전부 깔면 화면이 목록이 되므로
//   기본은 **상·하위 15개씩 30개**만 보여주고 필요할 때 펼친다. 정렬이 중앙값 등락률
//   내림차순이라 위는 오늘 강한 섹터, 아래는 약한 섹터가 된다 — 한쪽만 보면 반쪽이다.
const TOP_FOLD = 15;

// 시총 하한 문구 — 스냅샷에 실린 값을 그대로 쓴다. 숫자를 코드에 박으면 하한을 바꿨을 때
//   12시간짜리 캐시가 옛 파일을 물고 있어 문구와 목록이 어긋난다(실제로 그랬다).
function capFloor(eok: number): string {
  if (!(eok > 0)) return "";
  return eok >= 10000 ? `${eok / 10000}조` : `${eok / 1000}천억`;
}

// 테마 한 칸. 막대는 '오른 종목 비율' — 중앙값이 같아도 고르게 간 테마와
//   한두 개가 끈 테마를 가른다.
function ThemeCard({ t, onClick }: { t: ThemeStat; onClick: () => void }) {
  return (
    <button onClick={onClick}
            title={`${t.label} — 편입 ${t.total}종 중 ${t.count}종 체결\n최고 ${t.best.name} ${t.best.pct.toFixed(2)}%`}
            className="w-full mb-2 break-inside-avoid text-left px-2.5 py-2 rounded-lg border
                       border-gray-200 bg-white hover:bg-gray-50 transition-colors">
      <span className="flex items-baseline gap-1.5">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{t.label}</span>
        {/* 표본이 8종 미만인 카드는 중앙값이 한두 종목에 좌우된다 — 숫자를 눈에 띄게 해 경고.
            프리장엔 편입 종목 중 일부만 체결되므로 'n/전체' 로 커버리지도 같이 보인다 */}
        <span className={`shrink-0 text-[10px] tabular-nums ${
                t.count < 8 ? "text-amber-600 font-bold" : "text-gray-400"}`}>
          {t.count < t.total ? `${t.count}/${t.total}` : t.count}
        </span>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${signColor(t.median)}`}>
          {t.median > 0 ? "+" : ""}{t.median.toFixed(2)}%
        </span>
      </span>
      <span className="block mt-1 h-1 rounded bg-gray-200 overflow-hidden">
        <span className="block h-full bg-rose-400" style={{ width: `${Math.round(t.upRatio * 100)}%` }} />
      </span>
      <span className="mt-1 flex items-baseline gap-1 text-[11px]">
        <span className="flex-1 min-w-0 truncate text-gray-500">{t.best.name}</span>
        <span className={`shrink-0 tabular-nums ${signColor(t.best.pct)}`}>
          {t.best.pct > 0 ? "+" : ""}{t.best.pct.toFixed(2)}%
        </span>
      </span>
    </button>
  );
}

export function ThemeFlow({ themes, onPick, fetchedAt, minCap, tradeDate,
                            scanned, total, onRefresh, refreshing,
                            source, onSource }: {
  themes: ThemeStat[];
  onPick: (t: ThemeStat) => void;
  fetchedAt?: number;
  minCap?: number;             // 스냅샷에 적용된 시총 하한(억원)
  tradeDate?: string;          // 데이터의 기준 거래일 (KST YYYY-MM-DD)
  scanned?: number;            // 이번 세션에 체결된 종목 수
  total?: number;              // 편입 종목 수
  onRefresh?: () => void;
  refreshing?: boolean;
  source?: GroupSource;                    // 카드 묶음 출처 (우리 카드 / 업종 / 네이버 테마)
  onSource?: (s: GroupSource) => void;
}) {
  // 업종·네이버 테마는 카드가 수십~수백 개다. 전부 깔면 화면이 목록이 되어버리니
  //   기본은 상·하위만 보여주고 필요할 때 펼친다.
  const [expanded, setExpanded] = useState(false);
  const many = themes.length > TOP_FOLD * 2;
  const shown = !many || expanded
    ? themes
    : [...themes.slice(0, TOP_FOLD), ...themes.slice(-TOP_FOLD)];
  if (themes.length === 0) return null;
  const stamp = fetchedAt
    ? new Date(fetchedAt + 9 * 3600_000).toISOString().slice(11, 16)   // KST HH:MM
    : null;
  // 장 시작 전(08~09시)·주말에 받으면 데이터가 직전 거래일 것이다. 조회 시각만 보여주면
  //   오늘 흐름으로 오해한다 — 기준일이 조회한 날과 다르면 날짜를 밝힌다.
  //   ★ 지금(Date.now)이 아니라 '받은 시점' 과 비교한다. 렌더 중 현재시각을 읽으면 안 되고
  //     (순수하지 않다), 캐시된 스냅샷을 다음날 볼 때도 받은 날 기준이 맞다.
  const fetchedDayKst = fetchedAt
    ? new Date(fetchedAt + 9 * 3600_000).toISOString().slice(0, 10)
    : null;
  const stale = !!tradeDate && !!fetchedDayKst && tradeDate !== fetchedDayKst;
  // 프리장(08:00~08:50 NXT)엔 편입 종목 중 일부만 체결된다 — 어제 값은 아예 뺐으므로
  //   표본이 얼마나 얇은지 밝혀야 카드를 믿을지 판단할 수 있다.
  const partial = !!scanned && !!total && scanned < total * 0.9;
  return (
    <>
      {/* 출처 전환 — 분류만 네이버에서 빌리고 계산(시총 하한·중앙값·세션)은 셋 다 같다 */}
      {source && onSource && (
        <div className="flex items-center gap-1 mb-1 flex-wrap">
          {(Object.keys(GROUP_SOURCE_LABEL) as GroupSource[]).map(k => (
            <button key={k} onClick={() => onSource(k)}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                      source === k ? "bg-gray-800 text-white border-gray-800"
                                   : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
              {GROUP_SOURCE_LABEL[k]}
            </button>
          ))}
          <span className="text-[10px] text-gray-400 ml-1">
            분류만 다르고 계산 기준은 같습니다
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 -mt-0.5 mb-1 flex-wrap">
        <span>
          {minCap ? `시총 ${capFloor(minCap)}↑ 중 ` : ""}거래대금 상위 20종의 중앙값 등락률 순 ·{" "}
          <span className="text-gray-400">
            {stamp ? `기준 ${stamp} · ` : ""}누르면 종목 목록
          </span>
        </span>
        {/* 휴장·주말이면 데이터가 직전 거래일 것이다 — 오늘 흐름이 아니라고 못박는다 */}
        {stale && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
            {tradeDate!.slice(5).replace("-", "/")} 종가 기준
          </span>
        )}
        {/* 프리장처럼 일부만 체결된 상태 — 어제 값은 뺐고, 남은 표본이 얇다는 뜻 */}
        {!stale && partial && (
          <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium">
            체결 {scanned}/{total}종 · 미체결 제외
          </span>
        )}
        {/* 이 블록만 스냅샷이라(1,835종 약 10콜) 자동 갱신하지 않는다 — 여기서 직접 받는다 */}
        {onRefresh && (
          <button onClick={onRefresh} disabled={refreshing}
                  title="테마 종목 시세를 다시 조회합니다 (프록시 약 3콜)"
                  className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                             hover:bg-gray-100 disabled:opacity-50">
            {refreshing ? "조회 중…" : "🔄 새로고침"}
          </button>
        )}
      </div>
      <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-6 gap-2">
        {shown.map(t => <ThemeCard key={t.key} t={t} onClick={() => onPick(t)} />)}
      </div>
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

// 테마 종목 팝업 — 등락률 순. 추가 조회 없이 스냅샷에서 그린다.
// 스파크라인은 종목당 1콜(일봉)이라 팝업을 열자마자 전부 받으면 100콜이 넘는 카드가 있다.
//   화면에 들어온 카드만 받는다 — 앱의 StockCard 가 표시용 쿼리를 켜는 방식과 같다.
//   react-query 가 캐시하므로 다시 스크롤해 돌아와도 추가 호출이 없다.
function ThemeStockCell({ r, rank, closedDim, onOpenStock }: {
  r: ThemeStock; rank: number; closedDim: boolean;
  onOpenStock?: (code: string, name: string) => void;
}) {
  const [seen, setSeen] = useState(false);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || seen) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "120px" });
    io.observe(el);
  }, [seen]);

  const { data: candles } = useQuery({
    queryKey: ["toss-candles", r.code, "day"],   // 기업가치 팝업과 같은 키 — 캐시를 함께 쓴다
    queryFn: () => fetchTossKrCandles(r.code, "day", 60),
    enabled: seen,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const chart = (candles ?? []).map(c => c.close).filter(v => v > 0);

  return (
    <div ref={ref} className="min-w-0">
      <SimplePriceCard
        ticker={r.code} name={r.name}
        price={r.price} base={r.base} high={r.high} low={r.low}
        chart={chart}
        // 흐림은 두 가지다 — ① 장 마감(기본 카드와 같은 판정) ② 이번 세션 미체결.
        //   ②만 보면 장이 닫힌 뒤엔 전 종목이 '체결됨' 으로 잡혀 아무것도 안 흐려진다.
        dimmed={closedDim || !r.fresh}
        badge={
          <span className="text-[10px] tabular-nums text-gray-400 shrink-0">
            #{rank}{!r.fresh && <span className="ml-0.5 text-gray-400">·미체결</span>}
          </span>
        }
        actions={onOpenStock
          ? <button onClick={() => onOpenStock(r.code, r.name)}
                    title={`${r.name} 기업가치 보기`}
                    className="text-[11px] leading-none opacity-70 hover:opacity-100">📊</button>
          : null}
      />
    </div>
  );
}

export function ThemeDialog({ theme, minCap, onClose, onOpenStock }: {
  theme: ThemeStat;
  minCap?: number;
  onClose: () => void;
  onOpenStock?: (code: string, name: string) => void;
}) {
  // 체결된 것부터, 그 안에서 등락률 순. 미체결(값이 어제 것)은 뒤로 몰아 흐리게 보여준다.
  const rows: ThemeStock[] = [...theme.rows].sort((a, b) =>
    (a.fresh === b.fresh ? b.pct - a.pct : a.fresh ? -1 : 1));
  // 장 마감 흐림 — 기본 종목 카드와 같은 규칙(설정으로 끌 수 있다).
  const closedDim = getDimSleepingEnabled() && isKrHoldingClosed();
  // 배경 클릭 판정 — 목록에서 드래그하다 배경에서 손을 떼도 닫히면 안 된다.
  const downOnBackdropRef = useRef(false);

  // 공용 훅을 쓴다 — 위에 기업가치 모달이 떠 있으면 Esc 가 그쪽만 닫는다.
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
          <h2 className="text-base font-bold text-gray-800">{theme.label}</h2>
          <span className="text-[11px] text-gray-500">
            체결 {theme.count}/{theme.total}종 · 상위 20 중앙값{" "}
            <span className={`font-bold tabular-nums ${signColor(theme.median)}`}>
              {theme.median > 0 ? "+" : ""}{theme.median.toFixed(2)}%
            </span>
          </span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </header>

        {/* 앱의 '심플 보기' 와 같은 현재가 박스를 쓴다 — 한 화면에서 카드 모양이 두 가지면
            같은 숫자를 다르게 읽게 된다. 순위·시총·거래대금은 badge 로 얹는다. */}
        <div className="overflow-y-auto overscroll-contain px-3 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-2 gap-y-3.5 items-stretch">
            {rows.map((r, i) => (
              <ThemeStockCell key={r.code} r={r} rank={i + 1}
                              closedDim={closedDim} onOpenStock={onOpenStock} />
            ))}
          </div>
        </div>

        <p className="px-3 py-2 text-[10px] text-gray-400 border-t leading-relaxed">
          {theme.rows.length}종 전체 · 거래대금 많은 순, 체결분 먼저 (조회 시점 기준).
          흐린 종목은 이번 세션 미체결이라 카드의 중앙값 계산에서 빠집니다.
          종목명을 누르면 토스, 📊 를 누르면 기업가치가 열립니다.
          배경 차트는 최근 60거래일 종가이며, 화면에 들어온 카드만 받아옵니다.
          {minCap ? ` 시가총액 ${minCap.toLocaleString()}억 미만은 목록에서 제외됩니다.` : ""}
          {" "}카드의 중앙값은 이 중 거래대금 상위 20종으로 계산합니다.
        </p>
      </div>
    </div>
  );
}
