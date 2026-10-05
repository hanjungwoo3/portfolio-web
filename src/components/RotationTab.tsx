// AI 순환매 페이지 — 한국 AI 생태계 6단계의 흐름(lib/rotation.ts).
//
// 화면 원칙: **규칙의 과거 성적을 규칙 바로 옆에** 둔다. "다음 후보" 만 크게 띄우면 사람은
//   그걸 예측으로 읽는다. 실제로는 불안정한 신호라(앞 절반 마이너스·뒤 절반 플러스) 그 사실이
//   같은 자리에서 보여야 한다. 숫자는 매번 다시 계산하니 데이터가 쌓이면 판정도 바뀐다.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { signColor, dayChangePct } from "../lib/format";
import { fetchUsHoldingPrices, fetchTossPrices } from "../lib/api";
import {
  STAGES, OUTSIDE, ALL_GROUPS, LAG_WEEKS, fetchRotation, loadCachedRotation, sumLast, laggardAt,
  trackRecord, leaders, leadLag, type RotationData,
} from "../lib/rotation";

interface Props {
  onOpenValuation?: (ticker: string, name?: string) => void;
  // 지수 → 반도체 페이지 안에 들어갈 때. 섹션 책갈피가 제목을 대신하니 자기 제목은 뺀다.
  embedded?: boolean;
  // 메인(간밤 → 오늘 카드)은 빼고 부가 정보만 — 메인은 지수 카드 그룹(rotflow)이 그린다.
  extrasOnly?: boolean;
}

// 단계별 색 — 칩 계열(남·보라·하늘) / 에너지 계열(호박·주황·초록). 히스토리 띠에서 계열이 읽히게.
//   지수 카드 줄 책갈피(dashboardTagTone)와 같은 색 — 한쪽을 바꾸면 다른 쪽도.
const STAGE_COLOR: Record<string, { bg: string; text: string; chip: string; hex: string }> = {
  semi:    { bg: "bg-indigo-500",  text: "text-indigo-700",  chip: "bg-indigo-50 border-indigo-300", hex: "#6366f1" },
  front:   { bg: "bg-violet-500",  text: "text-violet-700",  chip: "bg-violet-50 border-violet-300", hex: "#8b5cf6" },
  back:    { bg: "bg-sky-500",     text: "text-sky-700",     chip: "bg-sky-50 border-sky-300", hex: "#0ea5e9" },
  cpu:     { bg: "bg-fuchsia-500", text: "text-fuchsia-700", chip: "bg-fuchsia-50 border-fuchsia-300", hex: "#d946ef" },
  optic:   { bg: "bg-lime-600",    text: "text-lime-700",    chip: "bg-lime-50 border-lime-300", hex: "#65a30d" },
  power:   { bg: "bg-amber-500",   text: "text-amber-700",   chip: "bg-amber-50 border-amber-300", hex: "#f59e0b" },
  nuclear: { bg: "bg-orange-600",  text: "text-orange-700",  chip: "bg-orange-50 border-orange-300", hex: "#ea580c" },
  defense: { bg: "bg-teal-600",    text: "text-teal-700",    chip: "bg-teal-50 border-teal-300", hex: "#0d9488" },
  // AI 밖(비교용) — 무채색 계열로 AI 단계와 한눈에 갈리게
  finance: { bg: "bg-stone-500",   text: "text-stone-700",   chip: "bg-stone-50 border-stone-300", hex: "#78716c" },
  ship:    { bg: "bg-slate-500",   text: "text-slate-700",   chip: "bg-slate-50 border-slate-300", hex: "#64748b" },
  staples: { bg: "bg-yellow-600",  text: "text-yellow-800",  chip: "bg-yellow-50 border-yellow-300", hex: "#ca8a04" },
  beauty:  { bg: "bg-pink-500",    text: "text-pink-700",    chip: "bg-pink-50 border-pink-300", hex: "#ec4899" },
  green:   { bg: "bg-emerald-500", text: "text-emerald-700", chip: "bg-emerald-50 border-emerald-300", hex: "#10b981" },
};
const labelOf = (k: string) => ALL_GROUPS.find(s => s.key === k)?.label ?? k;
const isOutside = (k: string) => OUTSIDE.some(o => o.key === k);
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

function fmtStamp(ms: number): string {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function RotationTab({ onOpenValuation, embedded, extrasOnly }: Props) {
  const [data, setData] = useState<RotationData | null>(() => loadCachedRotation());
  const [loading, setLoading] = useState(data === null);
  const [err, setErr] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);
  const [hoverDay, setHoverDay] = useState<number | null>(null);     // 일별 히트맵에서 가리킨 거래일 인덱스   // 주별 1등 띠에서 가리킨 칸
  const [moreOpen, setMoreOpen] = useState(true);    // 기본 펼침 — 부가 정보(지금 강한 곳·다음 후보·흐름·통계)
  // 일별 등락 가로 스크롤 — 처음엔 오른쪽 끝(최근)이 보이게
  const dailyScrollRef = useRef<HTMLDivElement>(null);
  const dailyLen = data?.days?.length ?? 0;
  useEffect(() => {
    const el = dailyScrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [dailyLen, moreOpen]);

  const run = (alive: () => boolean) =>
    fetchRotation()
      .then(d => { if (alive()) { setData(d); setLoading(false); setErr(null); } })
      .catch((e: unknown) => {
        if (!alive()) return;
        setLoading(false);
        setErr(e instanceof Error ? e.message : "조회 실패");
      });
  // 캐시가 없을 때만 자동 1회. 이후엔 새로고침 버튼으로(일봉 26콜).
  useEffect(() => {
    if (!loading) return;
    let alive = true;
    void run(() => alive);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refresh = () => { setLoading(true); setErr(null); void run(() => true); };

  // 간밤 미국 대장주 시세 — 배치 1콜
  const usSyms = useMemo(() => STAGES.map(s => s.us.symbol), []);
  const { data: usPx } = useQuery({
    queryKey: ["rotation-us", usSyms],
    queryFn: () => fetchUsHoldingPrices(usSyms),
    staleTime: 60_000, refetchInterval: 60_000,
  });
  const usMap = useMemo(() => new Map((usPx ?? []).map(p => [p.ticker, p])), [usPx]);
  // 한국 단계 종목 오늘 시세 — 20종목 배치 1콜. 미국 대장주 옆에 붙여 "따라갔나" 를 본다.
  const krCodes = useMemo(() => STAGES.flatMap(s => s.members.map(m => m.code)), []);
  const { data: krPx } = useQuery({
    queryKey: ["rotation-kr", krCodes],
    queryFn: () => fetchTossPrices(krCodes),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const krMap = useMemo(() => new Map((krPx ?? []).map(p => [p.ticker, p])), [krPx]);

  const T = data ? data.weekly[STAGES[0].key].length : 0;
  const stat = useMemo(() => {
    if (!data || T < LAG_WEEKS + 1) return null;
    const w = (k: string, n: number) => sumLast(data.weekly[k], n);
    // AI 밖(금융·조선·화장품)도 같이 줄 세운다 — AI 가 쉴 때 그쪽이 오르는지가 보이게. 다음 후보·성적은 순환매 단계만.
    const rows = ALL_GROUPS.map(s => ({ key: s.key, w1: w(s.key, 1), w4: w(s.key, 4), w13: w(s.key, 13) }));
    // 강세 = 1주가 전체 평균보다 높고 플러스. 1등 하나만 고르면 비슷하게 오른 단계가 묻힌다.
    const avg1 = rows.reduce((a, r) => a + r.w1, 0) / rows.length;
    const sorted = [...rows].sort((a, b) => b.w1 - a.w1);
    const strong = sorted.filter(r => r.w1 > avg1 && r.w1 > 0);
    const weak = sorted.filter(r => !strong.includes(r));
    const next = laggardAt(data, T);                                 // 최근 4주 가장 소외
    return { rows, strong, weak, next, tr: trackRecord(data), lead: leaders(data), ll: leadLag(data) };
  }, [data, T]);

  const verdict = (() => {
    const tr = stat?.tr;
    if (!tr) return null;
    const a = tr.first.meanEx, b = tr.second.meanEx;
    if (a > 0 && b > 0) return { text: "앞·뒤 두 구간 모두 평균보다 나았습니다 — 그래도 확정은 아닙니다.", cls: "text-emerald-700" };
    if (a <= 0 && b <= 0) return { text: "앞·뒤 두 구간 모두 평균보다 못했습니다 — 이 규칙에 기대지 마세요.", cls: "text-blue-700" };
    return { text: "⚠️ 한쪽 구간에서만 맞았습니다 — 최근의 우연일 수 있는 불안정한 신호입니다.", cls: "text-rose-700" };
  })();

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className={`flex flex-wrap items-center gap-2 ${embedded ? "" : "rounded-xl border border-gray-300 bg-white p-2.5"}`}>
        {!embedded && <span className="text-sm font-bold text-gray-800">🔄 AI 순환매</span>}
        <span className="text-[11px] text-gray-500">
          AI 8단계(반도체 · 전공정 · 후공정 · CPU·기판 · 광통신 · 전력기기 · 원자력 · 친환경) + 방산 · 비교용 AI 밖(금융 · 조선 · 화장품 · 필수소비재)
        </span>
        <button onClick={refresh} disabled={loading}
                title="단계별 종목 일봉을 다시 받습니다 (약 26콜)"
                className="ml-auto px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300
                           bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50">
          {loading ? "조회 중…" : "🔄 새로고침"}
        </button>
        {data && (
          <span className="text-[11px] text-gray-500 leading-tight text-right">
            기준 {fmtStamp(data.builtAt)}<br />{T}주{data.lastWeekPartial ? " · 이번 주 진행 중" : ""}
          </span>
        )}
      </div>

      {err && (
        <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
          ⚠️ 조회 실패 — {err}
          <button onClick={refresh} className="ml-2 underline font-bold">다시 시도</button>
        </div>
      )}
      {!data && loading && (
        <div className="py-16 text-center text-gray-500 text-sm">단계별 종목 일봉을 받고 있습니다…</div>
      )}

      {stat && data && (
        <>
          {/* ── 메인: 간밤 미국 → 오늘 한국 ──
              초보자도 한눈에 — 문장 대신 **카드 색**으로 읽는다(빨강 올랐음 · 파랑 내렸음).
              신호가 강한 단계부터(간밤 미국 등락 크기 × 한국과의 상관). 상관 숫자 같은 건
              메인에서 뺐다 — 정보가 많다고 좋은 게 아니다. 자세한 건 아래 '더 보기'. */}
          {!extrasOnly && (
          <div className="rounded-xl border border-gray-300 bg-white p-2.5">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-sm font-bold text-gray-800">🇺🇸 간밤 → 🇰🇷 오늘</span>
              <span className="text-[11px] text-gray-400">신호 강한 순</span>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-2">
              {[...STAGES]
                .map(st => {
                  const up = usMap.get(st.us.symbol);
                  const uv = up ? dayChangePct(up) : undefined;
                  return { st, uv, strength: Math.abs(uv ?? 0) * Math.max(0, data.usCorr[st.key] ?? 0) };
                })
                .sort((a, b) => b.strength - a.strength)
                .map(({ st, uv }) => (
                  <div key={st.key} className="flex items-stretch gap-1.5">
                    <div className={`w-14 shrink-0 self-center text-[13px] font-bold ${STAGE_COLOR[st.key].text}`}>
                      {st.label}
                    </div>
                    <MoveCard name={st.us.name} flag="🇺🇸" v={uv} emphasis />
                    <div className="self-center text-gray-300 text-lg leading-none">→</div>
                    <div className="flex flex-wrap gap-1.5 min-w-0">
                      {st.members.map(m => {
                        const p = krMap.get(m.code);
                        return (
                          <MoveCard key={m.code} name={m.name} v={p ? dayChangePct(p) : undefined}
                                    onClick={() => onOpenValuation?.(m.code, m.name)} />
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
            <div className="mt-2 text-[10px] text-gray-400">
              간밤 미국과 같은 방향으로 가는 경향이 조금 있을 뿐, 예측은 아닙니다.
            </div>
          </div>
          )}

          {/* ── 부가 정보 — 한 번에 접어 둔다 ── */}
          <div className="rounded-xl border border-gray-300 bg-white">
            <button onClick={() => setMoreOpen(o => !o)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
              <span className="text-[12px] font-bold text-gray-700">📊 더 보기</span>
              <span className="text-[11px] text-gray-500">지금 강한 곳 · 다음 후보 · 흐름 · 통계</span>
              <span className="ml-auto text-gray-400">{moreOpen ? "▾" : "▸"}</span>
            </button>
            {moreOpen && (
              <div className="px-2.5 pb-2.5 space-y-3 border-t border-gray-100 pt-2.5">
          {/* ① 지금 어디가 강한가 — 강세끼리 한 상자에 묶는다.
              1등 하나에만 '받는 중' 을 달면, 거의 같은 폭으로 오른 2·3등이 약한 것처럼 보인다
              (친환경 +4.4% · 전공정 +4.3% · 후공정 +3.4% 인데 친환경에만 붙었던 것 실측).
              강세 = 1주 수익률이 전체(순환매 단계 + AI 밖) 평균보다 높고 플러스. */}
          <div className="rounded-xl border border-gray-300 bg-white p-2.5 space-y-2">
            <div className="text-[12px] font-bold text-gray-700">지금 어디가 강한가</div>
            {([
              ["🔥 강세", "1주 평균보다 많이 오름", stat.strong, "border-rose-200 bg-rose-50/40"],
              ["보통 · 약세", "", stat.weak, "border-gray-200 bg-gray-50/50"],
            ] as [string, string, typeof stat.rows, string][]).map(([title, hint, list, box]) => list.length === 0 ? null : (
              <div key={title} className={`relative rounded-lg border px-2 pb-2 pt-3.5 mt-1 ${box}`}>
                <span className="absolute -top-2.5 left-2 px-1.5 py-0.5 rounded-md border border-gray-300 bg-white
                                 text-[11px] font-bold text-gray-700 whitespace-nowrap">
                  {title}{hint && <span className="ml-1 font-normal text-gray-400">{hint}</span>}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {list.map(r => {
                    const c = STAGE_COLOR[r.key];
                    return (
                      <div key={r.key} className={`relative rounded-lg border px-2 py-1.5 ${c.chip}`}>
                        {isOutside(r.key) && (
                          <div className="absolute -top-2 left-1 px-1 py-0 rounded text-[9px] border bg-white text-gray-500 border-gray-300">AI 밖</div>
                        )}
                        {r.key === stat.next && (
                          <div className="absolute -top-2 right-1 px-1.5 py-0 rounded text-[9px] font-bold border
                                          bg-white text-gray-700 border-gray-400">⏳ 다음 후보</div>
                        )}
                        <div className={`text-sm font-bold ${c.text}`}>{labelOf(r.key)}</div>
                        <div className="mt-0.5 space-y-0 text-[11px] tabular-nums">
                          {([["1주", r.w1], ["4주", r.w4], ["13주", r.w13]] as [string, number][]).map(([l, v]) => (
                            <div key={l} className="flex justify-between">
                              <span className="text-gray-500">{l}</span>
                              <b className={signColor(v)}>{pct(v)}</b>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {stat.strong.length === 0 && (
              <div className="text-[11px] text-gray-500">이번 주는 평균보다 뚜렷하게 오른 단계가 없습니다.</div>
            )}
          </div>

          {/* ② 다음 후보 + 규칙의 과거 성적 — 같은 상자에 */}
          <div className="rounded-xl border border-gray-300 bg-white p-2.5 space-y-1.5">
            <div className="text-[12px] font-bold text-gray-700">다음 후보</div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[12px] text-gray-500">지금 강세</span>
              {stat.strong.length > 0 ? stat.strong.map(r => (
                <b key={r.key} className={`text-base ${STAGE_COLOR[r.key].text}`}>{labelOf(r.key)}</b>
              )) : <span className="text-[12px] text-gray-400">뚜렷한 강세 없음</span>}
              <span className="text-gray-300">→</span>
              <span className="text-[12px] text-gray-500">최근 {LAG_WEEKS}주 가장 소외</span>
              <b className={`text-base ${STAGE_COLOR[stat.next].text}`}>{labelOf(stat.next)}</b>
              <span className={`text-[12px] tabular-nums ${signColor(sumLast(data.weekly[stat.next], LAG_WEEKS))}`}>
                ({pct(sumLast(data.weekly[stat.next], LAG_WEEKS))})
              </span>
            </div>
            {stat.tr && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] leading-relaxed">
                <div className="text-gray-600">
                  <b className="text-gray-800">이 규칙의 과거 성적</b> — 매주 "직전 {LAG_WEEKS}주 꼴찌" 를 골랐다면, 그 주에 순환매 단계 평균보다:
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
                  <span>전체 {stat.tr.n}주 <b className={signColor(stat.tr.meanEx)}>{pct(stat.tr.meanEx, 2)}p</b>
                    <span className="text-gray-400"> · t={stat.tr.t.toFixed(2)} · 이김 {stat.tr.wins}/{stat.tr.n}</span></span>
                  <span>앞 절반 <b className={signColor(stat.tr.first.meanEx)}>{pct(stat.tr.first.meanEx, 2)}p</b>
                    <span className="text-gray-400"> ({stat.tr.first.wins}/{stat.tr.first.n})</span></span>
                  <span>뒤 절반 <b className={signColor(stat.tr.second.meanEx)}>{pct(stat.tr.second.meanEx, 2)}p</b>
                    <span className="text-gray-400"> ({stat.tr.second.wins}/{stat.tr.second.n})</span></span>
                </div>
                {verdict && <div className={`mt-0.5 font-bold ${verdict.cls}`}>{verdict.text}</div>}
                <div className="mt-0.5 text-gray-400">
                  t 가 2 를 넘어야 우연이 아니라고 봅니다. "지금 1등 → 다음 단계" 로 고르는 방식은
                  과거에 무작위보다 못해서 쓰지 않습니다.
                </div>
              </div>
            )}
          </div>

          {/* ③ 일별 등락 히트맵 — 표: 행 = 6단계, 열 = 날짜. **한 주(월~금)씩 끊어** 주 사이에 틈을 두고
              요일을 머리에 적는다(휴장일은 빈칸) — 요일별로 비교가 된다. 칸 색 = 등락(빨강 오름·파랑 내림),
              진할수록 크게 움직인 날. 칸 폭 고정 + 가로 스크롤(처음엔 최근 쪽). */}
          <div className="rounded-xl border border-gray-300 bg-white p-2.5">
            <div className="mb-1.5 text-[12px] font-bold text-gray-700">일별 등락 — 최근 12주 (요일별)</div>
            {(() => {
              if (data.days.length === 0) return <div className="text-[11px] text-gray-400">일별 데이터가 없습니다.</div>;
              // 주(월요일 날짜) → 월~금 5칸. 거래일 인덱스를 칸에 담고, 휴장일은 null.
              const monday = (d: string) => {
                const t = new Date(`${d}T00:00:00Z`);
                t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
                return t.toISOString().slice(0, 10);
              };
              const byWeek = new Map<string, (number | null)[]>();
              data.days.forEach((d, i) => {
                const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;   // 월=0 … 금=4
                if (wd > 4) return;
                const m = monday(d);
                if (!byWeek.has(m)) byWeek.set(m, [null, null, null, null, null]);
                byWeek.get(m)![wd] = i;
              });
              const weeks = [...byWeek.entries()].sort(([x], [y]) => x.localeCompare(y)).slice(-12);
              const idxs = weeks.flatMap(([, slots]) => slots.filter((x): x is number => x != null));
              // 명도 척도 — 모든 단계 공통. 튀는 하루가 나머지를 다 옅게 만들지 않도록 95% 분위수에서 가장 진하게.
              const abs = ALL_GROUPS.flatMap(st => idxs.map(i => Math.abs(data.daily[st.key][i] ?? 0))).sort((x, y) => x - y);
              const cap = Math.max(1, abs[Math.floor(abs.length * 0.95)] ?? 1);
              const cell = (v: number) => {
                const t = Math.min(1, Math.abs(v) / cap);                     // 0..1
                const [r, g, b] = v >= 0 ? [225, 29, 72] : [37, 99, 235];     // rose-600 / blue-600
                return { background: `rgba(${r},${g},${b},${0.08 + t * 0.82})`, color: t > 0.55 ? "#fff" : v >= 0 ? "#be123c" : "#1d4ed8" };
              };
              const COL = 36;                            // 하루 칸 폭(px) — '+1.2' 가 들어가는 폭
              const DOW = ["월", "화", "수", "목", "금"];
              const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
              // 주 사이 칸막이 — 틈 가운데 세로선(머리·몸통 모든 줄에 이어져 한 줄로 보인다)
              const gap = (
                <td className="relative w-3 p-0">
                  <div className="absolute left-1/2 -top-px -bottom-px w-px -translate-x-1/2 bg-gray-400" />
                </td>
              );
              return (
                <>
                  <div ref={dailyScrollRef} className="overflow-x-auto" onMouseLeave={() => setHoverDay(null)}>
                    <table className="border-separate border-spacing-px text-[10px] tabular-nums">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 bg-white" />
                          {weeks.map(([m], wi) => (
                            <Fragment key={m}>
                              {wi > 0 && gap}
                              <th colSpan={5} className="font-bold text-gray-500 text-left pl-0.5 whitespace-nowrap border-b border-gray-200">
                                {md(m)} 주
                              </th>
                            </Fragment>
                          ))}
                        </tr>
                        <tr>
                          <th className="sticky left-0 z-10 bg-white" />
                          {weeks.map(([m, slots], wi) => (
                            <Fragment key={m}>
                              {wi > 0 && gap}
                              {slots.map((ix, k) => (
                                <th key={k} style={{ minWidth: COL }}
                                    className={`font-normal pb-0.5 whitespace-nowrap
                                                ${ix != null && hoverDay === ix ? "font-bold text-gray-900" : "text-gray-400"}`}>
                                  {DOW[k]}{ix != null && <span className="ml-0.5 text-[9px]">{Number(data.days[ix].slice(8, 10))}</span>}
                                </th>
                              ))}
                            </Fragment>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ALL_GROUPS.map(st => (
                          <Fragment key={st.key}>
                          {st.key === OUTSIDE[0].key && (
                            // AI 밖 — 구분 줄. 여기부터는 비교용(미국이 끌고 오지 않는 업종)
                            <tr><th className="sticky left-0 z-10 bg-white pt-1.5 text-left text-[9px] font-bold text-gray-400 whitespace-nowrap">AI 밖</th>
                                <td colSpan={weeks.length * 6} className="pt-1.5"><div className="border-t border-dashed border-gray-300" /></td></tr>
                          )}
                          <tr>
                            <th className={`sticky left-0 z-10 bg-white pr-1.5 text-left font-bold whitespace-nowrap ${STAGE_COLOR[st.key].text}`}>
                              {st.label}
                            </th>
                            {weeks.map(([m, slots], wi) => (
                              <Fragment key={m}>
                                {wi > 0 && gap}
                                {slots.map((ix, k) => {
                                  if (ix == null) return <td key={k} className="h-6 rounded-[3px] bg-gray-50" title="휴장" />;
                                  const v = data.daily[st.key][ix];
                                  return (
                                    <td key={k} style={cell(v)} onMouseEnter={() => setHoverDay(ix)}
                                        title={`${data.days[ix]} (${DOW[k]}) ${st.label} ${pct(v, 2)}`}
                                        className={`h-6 text-center rounded-[3px] ${hoverDay === ix ? "outline outline-1 outline-gray-700" : ""}`}>
                                      {v >= 0 ? "+" : ""}{v.toFixed(1)}
                                    </td>
                                  );
                                })}
                              </Fragment>
                            ))}
                          </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-1 text-center text-[10px] text-gray-400">
                    빨강 = 오른 날 · 파랑 = 내린 날 · 진할수록 크게 움직임 · 회색 빈칸 = 휴장 · 옆으로 밀면 이전 주
                  </div>
                </>
              );
            })()}
          </div>

          {/* ⑤ 순서가 있나 — 접어 둔다 */}
          <div className="rounded-xl border border-gray-300 bg-white">
            <button onClick={() => setStatsOpen(o => !o)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
              <span className="text-[12px] font-bold text-gray-700">정해진 순서가 있나?</span>
              <span className="text-[11px] text-gray-500">A 가 오른 다음 주 B 도 오르나 — 선행 상관</span>
              <span className="ml-auto text-gray-400">{statsOpen ? "▾" : "▸"}</span>
            </button>
            {statsOpen && (
              <div className="px-2.5 pb-2.5 border-t border-gray-100 pt-2 space-y-1.5">
                <table className="text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-gray-400">
                      <th className="text-left font-normal pr-2">먼저 ↓ / 다음 주 →</th>
                      {STAGES.map(s => <th key={s.key} className="font-normal px-1.5">{s.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {STAGES.map(a => (
                      <tr key={a.key}>
                        <td className={`pr-2 font-bold ${STAGE_COLOR[a.key].text}`}>{a.label}</td>
                        {STAGES.map(b => {
                          const r = stat.ll[a.key][b.key];
                          const strong = r != null && Math.abs(r) >= 0.2;
                          return (
                            <td key={b.key} className={`px-1.5 text-right
                                ${r == null ? "text-gray-300" : strong ? `font-bold ${signColor(r)}` : "text-gray-400"}`}>
                              {r == null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11px] text-gray-600 leading-relaxed">
                  진한 칸(|r| ≥ 0.2)만 우연이 아닐 가능성이 있습니다. 대부분 흐린 칸이라면
                  <b> 정해진 순서로 돌지는 않는다</b>는 뜻입니다 — 돈은 돌지만 순서는 매번 다릅니다.
                  대각선(자기 자신)이 음수면 그 단계는 한 주 크게 오르면 다음 주 되돌린다는 뜻입니다.
                </div>
              </div>
            )}
          </div>

              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 등락 카드 — 이름 + 큰 % . 배경색이 곧 방향(빨강 올랐음 · 파랑 내렸음 · 회색 보합/없음).
//   미국 대장주 카드는 테두리를 굵게(emphasis) 해서 "원인" 쪽임을 구분한다.
function MoveCard({ name, v, flag, emphasis, onClick }: {
  name: string; v?: number; flag?: string; emphasis?: boolean; onClick?: () => void;
}) {
  const bg = v == null ? "bg-gray-50 border-gray-200"
    : v > 0.05 ? "bg-rose-50 border-rose-200"
    : v < -0.05 ? "bg-blue-50 border-blue-200"
    : "bg-gray-50 border-gray-200";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
         className={`shrink-0 min-w-[84px] rounded-lg px-2 py-1 text-left ${bg}
                     ${emphasis ? "border-2" : "border"} ${onClick ? "hover:brightness-95" : ""}`}>
      <div className="text-[11px] text-gray-600 leading-tight whitespace-nowrap">
        {flag && <span className="mr-0.5">{flag}</span>}{name}
      </div>
      <div className={`text-[15px] font-bold tabular-nums leading-tight ${v != null ? signColor(v) : "text-gray-300"}`}>
        {v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—"}
      </div>
    </Tag>
  );
}
