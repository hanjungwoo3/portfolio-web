// 한·미 섹터 한 판 — 좌 🇰🇷 / 우 🇺🇸, 각 한 줄에 3개씩.
//
// 토스 TICS 는 한국과 미국에 **같은 한글 분류**를 쓴다(공통 53개 — 실측). 그래서 좌우로 놓으면
//   "미국에서 오른 분류가 한국엔 뭐가 있나" 를 이름으로 바로 맞출 수 있다.
//   카드를 누르면 반대쪽의 같은 분류로 스크롤해 강조한다(매매동향에서 종목을 고르면 다른 투자자
//   목록이 같이 움직이는 것과 같은 조작). 이미 고른 카드를 한 번 더 누르면 종목 목록이 열린다.
//
// 기간·정렬은 **양쪽 공통**이다. 한쪽만 1주, 한쪽만 1일이면 비교 자체가 성립하지 않는다.
//
// ⚠️ 등락률은 토스 기준이다(계산식 비공개 — 실측 양자컴퓨터: 토스 +6.58% vs 중앙값 +6.24%).
//   막대는 '오른 종목 비율' 이 아니라 **그 시장 1위 대비 거래대금 비중**이다.

import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTossTicsRanking, fetchTossMarketSessions,
  type TicsCategory, type TicsDuration, type TicsNation, type TicsSort,
} from "../lib/api";
import { TicsCard, DURATIONS, SORTS } from "./TicsFlow";

// 접힌 상태에서 보여줄 장 수 — **상위 9장만**(3열 기준 3줄). 하위는 접힘에서 뺀다.
//   이 화면은 "어디가 가고 있나" 를 보는 곳이라 급락 쪽은 전체 보기에서 확인하면 된다.
//   FOLD_BOTTOM 을 0 으로 둘 수 있게 slice(-0) 을 쓰지 않는다 — slice(-0) 은 전체를 준다(함정).
const FOLD_TOP = 9, FOLD_BOTTOM = 0;
import { TicsStockDialog } from "./TicsStockDialog";

// 그 시장의 **데이터 기준일**. 토스 랭킹 응답에는 거래일이 없다(basedAt = 조회 시각) —
//   실측 2026-09-18 00:13 조회 시 basedAt 도 00:13 이었다. 그래서 시계로 정한다.
//   · 국내: KST 날짜. 단 자정~08:30 은 아직 전 거래일 종가다.
//   · 미국: 정규장이 KST 22:30~05:00 로 날짜를 걸치므로 **뉴욕 날짜**로 말해야 한다.
//   주말·휴장이면 날짜 대신 '직전 거래일' 이라고만 한다 — 며칠 전인지는 이 응답으로 알 수 없다.
function basisDateLabel(nation: TicsNation, closed: boolean, holiday: boolean): string {
  const tz = nation === "KR" ? "Asia/Seoul" : "America/New_York";
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  const weekend = p.weekday === "Sat" || p.weekday === "Sun";
  if (weekend || holiday) return "직전 거래일 종가";
  const mins = Number(p.hour === "24" ? "0" : p.hour) * 60 + Number(p.minute);
  // 국내는 개장(09:00) 전이면 아직 어제 종가다. 미국은 프리마켓부터 당일로 친다.
  const d = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  if (nation === "KR" && mins < 8 * 60 + 30) d.setUTCDate(d.getUTCDate() - 1);
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return closed ? `${md} 종가` : `${md} 장중`;
}

function Panel({ nation, items, selected, onPick, onOpen, bothOnly, common, expanded, onExpand, session }: {
  nation: TicsNation;
  items: TicsCategory[];
  selected: string | null;
  /** 카드 클릭 — 선택/해제 토글 */
  onPick: (name: string) => void;
  onOpen: (cat: TicsCategory) => void;
  bothOnly: boolean;
  common: Set<string>;
  expanded: boolean;
  onExpand: () => void;
  /** 토스가 알려주는 그 시장의 현재 구간 — 기준일 문구와 배지에 쓴다 */
  session?: { open: boolean; phase: string; isHoliday: boolean };
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // 반대쪽에서 고른 분류가 이 판에선 스크롤 밖일 수 있다 → 보이는 곳까지.
  //   block:"nearest" 라 이미 보이면 안 움직인다(화면이 덜 흔들린다).
  useEffect(() => {
    if (!selected) return;
    const el = boxRef.current?.querySelector<HTMLElement>(`[data-tics="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const filtered = bothOnly ? items.filter(c => common.has(c.name)) : items;
  const many = filtered.length > FOLD_TOP + FOLD_BOTTOM;
  // ★ 고른 분류는 접혀 있어도 반드시 끼워 넣는다.
  //   접힘이 상위 10 + 하위 5 라 중간 순위(예: 41위)는 DOM 에 아예 없다 → 반대쪽에서 골라도
  //   스크롤할 대상이 없어 아무 일도 안 일어난다. 그게 이 화면의 핵심 조작을 죽인다.
  //   끼워 넣는 자리는 상위 덩어리 끝 — 접힌 구간에서 끌어온 것이라 원래 순위 자리는 없다.
  const folded = many && !expanded;
  const foldBottom = FOLD_BOTTOM > 0 ? filtered.slice(-FOLD_BOTTOM) : [];
  let shown = folded ? [...filtered.slice(0, FOLD_TOP), ...foldBottom] : filtered;
  const pulled = folded && selected && !shown.some(c => c.name === selected)
    ? filtered.find(c => c.name === selected)
    : undefined;
  const pulledRank = pulled ? filtered.findIndex(c => c.name === pulled.name) + 1 : 0;
  if (pulled) {
    shown = [...filtered.slice(0, FOLD_TOP), pulled, ...foldBottom];
  }
  // 접힘으로 가려진 구간 — 경계를 안 그리면 상위 10 다음에 하위 5 가 바로 붙어
  //   "3.77% 다음이 0.60%" 로 보여 정렬이 깨진 것처럼 읽힌다(실제로 그렇게 물어봤다).
  const hiddenFrom = FOLD_TOP + 1;
  const hiddenTo = filtered.length - FOLD_BOTTOM;   // 하위를 안 보이면 끝까지가 숨김 구간이다
  const hiddenCount = folded ? Math.max(0, hiddenTo - FOLD_TOP) : 0;

  // 반대쪽에서 고른 분류가 이 시장엔 아예 없을 수도 있다(한쪽만 있는 분류) → 그렇다고 말해 준다.
  const missing = !!selected && !items.some(c => c.name === selected);
  const hiddenByFilter = !!selected && !missing && !filtered.some(c => c.name === selected);
  const maxAmount = items.reduce((m, c) => Math.max(m, c.tradingAmountKrw), 0);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 border-b border-gray-200 pb-1 mb-1.5">
        <span className={`text-xs font-bold ${nation === "KR" ? "text-blue-800" : "text-emerald-800"}`}>
          {nation === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"}
        </span>
        <span className="text-[10px] text-gray-400">{filtered.length}개 분류</span>
        {missing && (
          <span className="text-[10px] text-gray-500">· <b className="text-gray-700">{selected}</b> 없음</span>
        )}
        {hiddenByFilter && (
          <span className="text-[10px] text-gray-500">· <b className="text-gray-700">{selected}</b> 공통만에서 제외</span>
        )}
        {/* ★ 기준일 — 이게 없으면 새벽·주말에 본 숫자가 언제 것인지 알 수 없다 */}
        <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${
                session?.open ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {basisDateLabel(nation, !session?.open, !!session?.isHoliday)}
          {session?.phase && <span className="ml-1 opacity-70">· {session.phase}</span>}
        </span>
      </div>
      {/* 접힘(상위 12 + 하위 6 + 경계 줄 + 끌어온 카드 1)이 **스크롤 없이** 들어가는 높이.
          3열 기준 최대 7줄 + 경계 줄이라 720px 면 충분하다. 펼치면(97개) 그때만 스크롤된다. */}
      <div ref={boxRef} className="max-h-[720px] overflow-y-auto pr-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-stretch">
          {shown.map((c, i) => (
            <Fragment key={c.ticsId}>
              {/* 상위 덩어리와 하위 덩어리 사이 — 여기서 순위가 건너뛴다는 걸 밝힌다 */}
              {folded && hiddenCount > 0 && i === shown.length - FOLD_BOTTOM && FOLD_BOTTOM > 0 && (
                <button onClick={onExpand}
                        className="col-span-full my-0.5 py-1 rounded border border-dashed border-gray-300
                                   bg-gray-50 text-[10px] text-gray-500 hover:bg-gray-100">
                  ⋯ {hiddenFrom}~{hiddenTo}위 {hiddenCount}개 숨김 — 누르면 전체 보기
                </button>
              )}
            <div data-tics={c.name} className="min-w-0 h-full">
              <TicsCard c={c} maxAmount={maxAmount}
                        selected={selected === c.name}
                        pulledRank={pulled && c.name === pulled.name ? pulledRank : undefined}
                        onClick={() => onPick(c.name)}
                        onOpen={() => onOpen(c)} />
            </div>
            </Fragment>
          ))}
          {/* 하위 덩어리를 안 보여줄 때는 경계 줄이 목록 끝에 온다 */}
          {folded && hiddenCount > 0 && FOLD_BOTTOM === 0 && (
            <button onClick={onExpand}
                    className="col-span-full my-0.5 py-1 rounded border border-dashed border-gray-300
                               bg-gray-50 text-[10px] text-gray-500 hover:bg-gray-100">
              ⋯ {hiddenFrom}~{hiddenTo}위 {hiddenCount}개 숨김 — 누르면 전체 보기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TicsSectorBoard({ onOpenValuation, krClosed = false }: {
  onOpenValuation?: (ticker: string, name: string) => void;
  /** 한국 정규장이 닫혔는가 — 좌우 순서를 정한다. 섹션 위치(낮=한국 시장 아래 / 밤=미국 지수 아래)와
   *  **같은 신호**를 써야 화면이 따로 놀지 않는다. */
  krClosed?: boolean;
}) {
  const [duration, setDuration] = useState<TicsDuration>("1d");
  const [sortBy, setSortBy] = useState<TicsSort>("FLUCTUATION_RATE");
  const [selected, setSelected] = useState<string | null>(null);
  const [bothOnly, setBothOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dlg, setDlg] = useState<{ cat: TicsCategory; nation: TicsNation } | null>(null);

  // 장 구간 — 토스가 직접 준다(휴장일 포함). 기준일 문구가 여기에 달린다.
  const { data: sessions } = useQuery({
    queryKey: ["toss-market-sessions"],
    queryFn: fetchTossMarketSessions,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // 한·미를 한 번에 받는다(각 1콜) — 기간·정렬이 공통이라 캐시도 한 키로 묶인다.
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["tics-board", duration, sortBy],
    queryFn: async () => {
      const [kr, us] = await Promise.all([
        fetchTossTicsRanking("KR", duration, sortBy),
        fetchTossTicsRanking("US", duration, sortBy),
      ]);
      return { kr, us };
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const krItems = data?.kr.items ?? [];
  const usItems = data?.us.items ?? [];
  const common = new Set(
    usItems.filter(u => krItems.some(k => k.name === u.name)).map(u => u.name),
  );
  const stamp = data?.kr.basedAt
    ? new Date(new Date(data.kr.basedAt).getTime() + 9 * 3600_000).toISOString().slice(11, 16)
    : null;

  return (
    <>
      {/* 컨트롤 — 기간·정렬은 양쪽 공통이다 */}
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        {SORTS.map(x => (
          <button key={x.key} onClick={() => setSortBy(x.key)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                    sortBy === x.key ? "bg-gray-800 text-white border-gray-800"
                                     : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {x.label}
          </button>
        ))}
        <span className="text-gray-300 mx-0.5">|</span>
        {DURATIONS.map(x => (
          <button key={x.key} onClick={() => setDuration(x.key)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                    duration === x.key ? "bg-indigo-600 text-white border-indigo-600"
                                       : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
            {x.label}
          </button>
        ))}
        <span className="text-gray-300 mx-0.5">|</span>
        <button onClick={() => setBothOnly(v => !v)}
                title="한국·미국 양쪽에 다 있는 분류만 남깁니다"
                className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                  bothOnly ? "bg-gray-800 text-white border-gray-800"
                           : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
          🔗 공통만
        </button>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 px-0.5 mb-1.5 flex-wrap">
        <span>
          공통 분류 {common.size}개 · 막대는 거래대금 비중 ·{" "}
          <span className="text-amber-600" title={"토스가 그날 추려 주는 '트렌딩 분류' 목록입니다.\n"
                + "전체 분류는 300개(대분류 39 + 소분류 261)인데 랭킹은 97개만 옵니다 —\n"
                + "size·limit·page·depth 어떤 파라미터로도 더 받을 수 없습니다(실측).\n"
                + "예: 삼성전자·SK하이닉스가 든 '종합반도체'(5종)는 오늘 목록에 없습니다."}>
            토스 트렌딩 목록
          </span>{" "}·{" "}
          <span className="text-gray-400">
            {stamp ? `조회 ${stamp} · ` : ""}카드를 누르면 반대쪽 같은 분류로 이동(다시 누르면 해제) · 📋 는 종목 목록
          </span>
        </span>
        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">토스 기준</span>
        <button onClick={() => void refetch()} disabled={isFetching}
                title="한·미 분류 랭킹을 다시 조회합니다 (프록시 2콜)"
                className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                           hover:bg-gray-100 disabled:opacity-50">
          {isFetching ? "조회 중…" : "🔄 새로고침"}
        </button>
      </div>

      {isError ? (
        <div className="py-6 text-center text-[11px] text-rose-700">
          데이터를 가져오지 못했습니다 — {(error as Error)?.message}
        </div>
      ) : isLoading && !data ? (
        <div className="py-6 text-center text-[11px] text-gray-400">불러오는 중…</div>
      ) : (
        /* 낮(한국장)은 한국이 왼쪽, 밤은 미국이 왼쪽 — 지금 움직이는 시장이 먼저 읽히는 자리에 온다. */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
          {(krClosed ? (["US", "KR"] as const) : (["KR", "US"] as const)).map((nat, i) => (
            // 두 시장 사이 세로선 — 좌우가 한 판이라 경계가 없으면 카드가 이어진 목록처럼 읽힌다.
            //   세로로 쌓이는 좁은 화면(lg 미만)에서는 선이 뜻을 잃으므로 lg 부터만 그린다.
            <div key={nat}
                 className={i === 1 ? "lg:pl-4 lg:border-l lg:border-gray-300" : ""}>
            <Panel nation={nat}
                   items={nat === "KR" ? krItems : usItems}
                   selected={selected}
                   onPick={n => setSelected(p => (p === n ? null : n))}
                   onOpen={cat => setDlg({ cat, nation: nat })}
                   bothOnly={bothOnly} common={common} expanded={expanded}
                   onExpand={() => setExpanded(true)}
                   session={nat === "KR" ? sessions?.kr : sessions?.us} />
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setExpanded(v => !v)}
              className="mt-1 w-full py-1 rounded border border-gray-300 bg-white text-[11px]
                         text-gray-600 hover:bg-gray-50">
        {expanded
          ? `접기 (각 상위 ${FOLD_TOP}${FOLD_BOTTOM ? ` · 하위 ${FOLD_BOTTOM}` : ""})`
          : `전체 보기 (지금은 각 상위 ${FOLD_TOP}${FOLD_BOTTOM ? ` · 하위 ${FOLD_BOTTOM}` : ""})`}
      </button>

      {dlg && (
        <TicsStockDialog cat={dlg.cat} nation={dlg.nation} onClose={() => setDlg(null)}
                         onOpenValuation={onOpenValuation} />
      )}
    </>
  );
}
