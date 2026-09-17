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

import { useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTossTicsRanking, fetchTossMarketSessions,
  type TicsCategory, type TicsDuration, type TicsNation, type TicsSort,
} from "../lib/api";
import { TicsCard, DURATIONS, SORTS } from "./TicsFlow";

// 접힌 상태에서 보여줄 장 수. **3열 기준 5줄**(10 + 5)이 기본이다.
//   예전엔 상·하위 15개씩 = 30장이라 3열에서 10줄, 2열로 떨어지면 15줄이 되어 한 판에 안 들어왔다.
//   등락률 정렬이라 위쪽이 더 중요해 상위를 두 배로 둔다(급락 쪽도 한 줄은 보이게).
const FOLD_TOP = 10, FOLD_BOTTOM = 5;
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

function Panel({ nation, items, selected, onPick, onOpen, bothOnly, common, expanded, session }: {
  nation: TicsNation;
  items: TicsCategory[];
  selected: string | null;
  /** 카드 클릭 — 선택/해제 토글 */
  onPick: (name: string) => void;
  onOpen: (cat: TicsCategory) => void;
  bothOnly: boolean;
  common: Set<string>;
  expanded: boolean;
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
  const shown = !many || expanded
    ? filtered
    : [...filtered.slice(0, FOLD_TOP), ...filtered.slice(-FOLD_BOTTOM)];
  const maxAmount = items.reduce((m, c) => Math.max(m, c.tradingAmountKrw), 0);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 border-b border-gray-200 pb-1 mb-1.5">
        <span className={`text-xs font-bold ${nation === "KR" ? "text-blue-800" : "text-emerald-800"}`}>
          {nation === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"}
        </span>
        <span className="text-[10px] text-gray-400">{filtered.length}개 분류</span>
        {/* ★ 기준일 — 이게 없으면 새벽·주말에 본 숫자가 언제 것인지 알 수 없다 */}
        <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${
                session?.open ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {basisDateLabel(nation, !session?.open, !!session?.isHoliday)}
          {session?.phase && <span className="ml-1 opacity-70">· {session.phase}</span>}
        </span>
      </div>
      <div ref={boxRef} className="max-h-[560px] overflow-y-auto pr-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-stretch">
          {shown.map(c => (
            <div key={c.ticsId} data-tics={c.name} className="min-w-0 h-full">
              <TicsCard c={c} maxAmount={maxAmount}
                        selected={selected === c.name}
                        onClick={() => onPick(c.name)}
                        onOpen={() => onOpen(c)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TicsSectorBoard({ onOpenValuation }: {
  onOpenValuation?: (ticker: string, name: string) => void;
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
          <Panel nation="KR" items={krItems} selected={selected}
                 onPick={n => setSelected(p => (p === n ? null : n))}
                 onOpen={cat => setDlg({ cat, nation: "KR" })}
                 bothOnly={bothOnly} common={common} expanded={expanded} session={sessions?.kr} />
          <Panel nation="US" items={usItems} selected={selected}
                 onPick={n => setSelected(p => (p === n ? null : n))}
                 onOpen={cat => setDlg({ cat, nation: "US" })}
                 bothOnly={bothOnly} common={common} expanded={expanded} session={sessions?.us} />
        </div>
      )}

      <button onClick={() => setExpanded(v => !v)}
              className="mt-1 w-full py-1 rounded border border-gray-300 bg-white text-[11px]
                         text-gray-600 hover:bg-gray-50">
        {expanded
          ? `접기 (각 상위 ${FOLD_TOP} · 하위 ${FOLD_BOTTOM})`
          : `전체 보기 (지금은 각 상위 ${FOLD_TOP} · 하위 ${FOLD_BOTTOM})`}
      </button>

      {dlg && (
        <TicsStockDialog cat={dlg.cat} nation={dlg.nation} onClose={() => setDlg(null)}
                         onOpenValuation={onOpenValuation} />
      )}
    </>
  );
}
