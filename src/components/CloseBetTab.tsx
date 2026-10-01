// 종가배팅 — 오늘 종가 근처에 사서 다음 날 시가에 판다. 조건·성적은 lib/closeBet.ts (백테스트로 고른 셋).
//   화면 순서: 오늘 시장 상태(요일·나스닥 선물·마감 시각) → 조건별 후보 → 백테스트 표 → 주의.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch } from "../lib/api";
import { signColor } from "../lib/format";
import { loadKrNameDict, getRuntimeNames, fetchMissingKrNames } from "../lib/krStockNames";
import {
  RULES, COST, MARKET_NOTES, fetchCloseBet, loadCachedBet, type BetRow, type BetRule,
} from "../lib/closeBet";

interface Props {
  onOpenValuation?: (ticker: string, name?: string) => void;
}

const pct = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const eok = (won: number) => won >= 1e12 ? `${(won / 1e12).toFixed(1)}조` : `${Math.round(won / 1e8).toLocaleString()}억`;

function kstNow() {
  const t = new Date(Date.now() + 9 * 3600_000);
  return { dow: t.getUTCDay(), hm: t.getUTCHours() * 60 + t.getUTCMinutes(), date: t.toISOString().slice(0, 10) };
}

export function CloseBetTab({ onOpenValuation }: Props) {
  const betQ = useQuery({
    queryKey: ["close-bet"],
    queryFn: fetchCloseBet,
    initialData: () => loadCachedBet() ?? undefined,
    initialDataUpdatedAt: () => loadCachedBet()?.fetchedAt,
    staleTime: 3 * 60_000, refetchOnWindowFocus: false,
  });
  const nqQ = useQuery({
    queryKey: ["close-bet-nq"],
    queryFn: () => fetchYahooBatch([{ symbol: "NQ=F", name: "나스닥 선물" }]),
    staleTime: 60_000, refetchInterval: 60_000,
  });
  const nq = nqQ.data?.get("NQ=F")?.pct;

  const rows = useMemo(() => betQ.data?.rows ?? [], [betQ.data]);
  // 한글 이름 — 걸린 몇 종목만. 사전에 없으면 폴백 조회.
  const dictQ = useQuery({ queryKey: ["kr-name-dict"], queryFn: loadKrNameDict, staleTime: Infinity });
  const missCodes = useMemo(() => {
    const dict = dictQ.data ?? {}; const rt = getRuntimeNames();
    return rows.map(r => r.code).filter(c => !dict[c] && !rt[c]);
  }, [rows, dictQ.data]);
  const missQ = useQuery({
    queryKey: ["kr-name-miss", missCodes.join(",")],
    queryFn: () => fetchMissingKrNames(missCodes),
    enabled: missCodes.length > 0, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const krName = (r: BetRow) => dictQ.data?.[r.code] ?? getRuntimeNames()[r.code] ?? missQ.data?.[r.code] ?? r.name;

  const now = kstNow();
  const friday = now.dow === 5;
  const baseDate = rows[0]?.date;
  const stale = baseDate && baseDate !== now.date;   // 장 전·휴장일 — 직전 거래일 기준
  const fetchedAt = betQ.data?.fetchedAt;
  const left = (endHm: number) => {
    const m = endHm - now.hm;
    if (now.dow === 0 || now.dow === 6) return "주말";
    if (m <= 0) return "마감";
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분 남음` : `${m}분 남음`;
  };

  return (
    <div className="space-y-3">
      {/* 머리 — 무엇을 하는 화면인가 */}
      <div className="rounded-xl border border-gray-300 bg-white p-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-gray-800">🌙 종가배팅</span>
          <span className="text-[12px] text-gray-500">오늘 종가 근처에 사서 → 내일 아침 시가에 판다</span>
          <button onClick={() => void betQ.refetch()} disabled={betQ.isFetching}
                  className="ml-auto px-2.5 py-1 rounded-md border border-gray-300 text-[12px] font-bold text-gray-700
                             hover:bg-gray-50 disabled:opacity-50">
            {betQ.isFetching ? "찾는 중…" : "🔄 다시 찾기"}
          </button>
        </div>
        <div className="text-[11px] text-gray-500 leading-relaxed">
          조건은 지난 389거래일(2025-02 ~ 2026-09) 백테스트로 고른 세 가지입니다. 승률보다 <b>평균</b>이 중요해요 —
          지는 날이 더 많아도 이기는 날이 크게 이겨서 남는 구조라, <b>한 번에 몰지 말고 여러 종목·여러 날로 나눠</b>야 평균에 가까워집니다.
        </div>
        {/* 오늘 시장 상태 */}
        <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px]">
          <span className="px-2 py-0.5 rounded-full border border-gray-300 bg-gray-50 text-gray-700">
            ETF 마감 15:30 · <b>{left(15 * 60 + 30)}</b>
          </span>
          <span className="px-2 py-0.5 rounded-full border border-gray-300 bg-gray-50 text-gray-700">
            종목 마감 20:00(NXT) · <b>{left(20 * 60)}</b>
          </span>
          {nq != null && (
            <span className={`px-2 py-0.5 rounded-full border ${nq >= 0.5 ? "border-rose-300 bg-rose-50 text-rose-700"
                              : nq <= -0.5 ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-300 bg-gray-50 text-gray-700"}`}
                  title="ETF 는 나스닥 선물이 +0.5% 이상인 날 밤 평균이 더 좋았다 (종목은 차이 작음)">
              나스닥 선물 <b>{pct(nq)}</b>{nq >= 0.5 ? " · ETF 유리" : ""}
            </span>
          )}
          {friday && (
            <span className="px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800 font-bold"
                  title="금요일에 사서 월요일 시가에 팔면 주말 위험이 붙는다">
              ⚠️ 금요일 — ETF 는 금요일 매수 성적이 나빴다
            </span>
          )}
          {fetchedAt && (
            <span className="px-2 py-0.5 text-gray-400">
              조회 {new Date(fetchedAt + 9 * 3600_000).toISOString().slice(11, 16)}
              {stale && ` · 기준일 ${baseDate} (오늘 거래 전)`}
            </span>
          )}
        </div>
      </div>

      {betQ.isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[12px] text-rose-700">
          후보를 못 가져왔습니다 — {(betQ.error as Error)?.message}
        </div>
      )}

      {/* 조건별 후보 */}
      {RULES.map(rule => (
        <RuleBlock key={rule.kind} rule={rule} rows={rows.filter(r => r.kind === rule.kind)}
                   loading={betQ.isFetching && !betQ.data} krName={krName} friday={friday}
                   onOpen={(r) => onOpenValuation?.(r.code, krName(r))} />
      ))}

      {/* 백테스트 표 */}
      <div className="rounded-xl border border-gray-300 bg-white p-3 space-y-2">
        <div className="text-[12px] font-bold text-gray-700">백테스트 — 그날 종가에 사서 다음 날 시가에 팔았다면</div>
        <div className="overflow-x-auto">
          <table className="text-[11px] tabular-nums whitespace-nowrap">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left pr-3 font-normal">조건</th>
                <th className="px-2 font-normal">건수</th>
                <th className="px-2 font-normal">평균</th>
                <th className="px-2 font-normal">비용 뺀 평균</th>
                <th className="px-2 font-normal">승률</th>
                <th className="px-2 font-normal">기간 3등분</th>
                <th className="px-2 font-normal">수익 난 달</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map(r => (
                <tr key={r.kind} className="border-t border-gray-100">
                  <td className="pr-3 py-1 font-bold text-gray-700">{r.title}</td>
                  <td className="px-2 text-center">{r.n.toLocaleString()}</td>
                  <td className={`px-2 text-center ${signColor(r.avg)}`}>{pct(r.avg)}</td>
                  <td className={`px-2 text-center font-bold ${signColor(r.net)}`}>{pct(r.net)}</td>
                  <td className="px-2 text-center">{r.win}%</td>
                  <td className="px-2 text-center">{r.thirds.map(v => pct(v)).join(" · ")}</td>
                  <td className="px-2 text-center">{r.months}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="text-[11px] text-gray-500 space-y-0.5 list-disc pl-4 leading-relaxed">
          <li><b>비용</b>: 종목은 매도세 0.15% + 수수료로 왕복 약 {COST.stock}%, ETF 는 매도세가 없어 약 {COST.etf}% 를 뺐습니다.</li>
          <li><b>기간 3등분</b>이 모두 플러스 — 한 시기에만 통한 조건이 아닙니다. 조건을 엄격하게 할수록 고르게 좋아져 숫자 하나에 끼워 맞춘 것도 아닙니다.</li>
          <li><b>상한가(+29%↑) 마감은 뺐습니다</b> — 넣으면 평균이 크게 뛰지만, 잠긴 상한가는 종가에 사려 해도 파는 사람이 없어 실제로는 거의 못 삽니다.</li>
          <li>외국인·기관 수급, 신고가, 오버나잇 모멘텀은 <b>더해도 나아지지 않아</b> 뺐습니다.</li>
          <li>시장 전체로 보면 ETF 는 금요일 매수(→월) {pct(MARKET_NOTES.etfFriday)} vs 월~목 {pct(MARKET_NOTES.etfMonThu)},
            나스닥 선물 +0.5%↑인 날 {pct(MARKET_NOTES.etfNqUp)} vs 나머지 {pct(MARKET_NOTES.etfNqRest)} 였습니다(종목은 차이가 작음).</li>
          <li>상승장 1년 반 데이터입니다. 하락장에선 다를 수 있고, 판정은 <b>확정 종가</b>로 쟀기 때문에 마감 전에 보는 값과 조금 다를 수 있어요.
            토스 일봉은 시간외(NXT)까지 합친 값이라, 종목은 20:00 마감 매수와 가깝습니다.</li>
        </ul>
      </div>
    </div>
  );
}

function RuleBlock({ rule, rows, loading, krName, friday, onOpen }: {
  rule: BetRule; rows: BetRow[]; loading: boolean; friday: boolean;
  krName: (r: BetRow) => string; onOpen: (r: BetRow) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-300 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13px] font-bold text-gray-800">{rule.title}</span>
        <span className="text-[11px] text-gray-500">{rule.desc}</span>
        <span className="ml-auto text-[11px] text-gray-500 tabular-nums"
              title={`백테스트 ${rule.n.toLocaleString()}건 · 기간 3등분 ${rule.thirds.map(v => pct(v)).join(" / ")} · 수익 난 달 ${rule.months}`}>
          과거 평균 <b className={signColor(rule.net)}>{pct(rule.net)}</b>(비용 후) · 승률 {rule.win}%
        </span>
      </div>
      {rule.kind === "etfDip" && friday && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          ⚠️ 오늘은 금요일 — 급락 반등 성적은 금요일을 빼고 쟀습니다. 금요일 매수는 월요일 시가까지 주말 위험이 붙어요.
        </div>
      )}
      {loading ? (
        <div className="text-[12px] text-gray-400">찾는 중…</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-gray-400">오늘은 조건에 맞는 {rule.kind === "stock" ? "종목" : "ETF"}이 없습니다.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rows.map(r => (
            <button key={r.code} onClick={() => onOpen(r)}
                    className="text-left rounded-lg border border-gray-200 hover:border-gray-400 bg-gray-50/50 px-2.5 py-1.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold text-gray-800 truncate">{krName(r)}</span>
                <span className="text-[10px] text-gray-400">{r.code}</span>
                <span className={`ml-auto text-sm font-bold tabular-nums ${signColor(r.changePct)}`}>{pct(r.changePct)}</span>
              </div>
              <div className="flex flex-wrap gap-x-2.5 text-[11px] text-gray-500 tabular-nums">
                <span>{r.close.toLocaleString()}원</span>
                <span title="하루 범위(저가~고가)에서 종가 위치 — 100% = 고가 마감">위치 <b className="text-gray-700">{Math.round(r.pos * 100)}%</b></span>
                <span title="오늘 거래대금 ÷ 직전 20일 평균">거래대금 <b className="text-gray-700">{r.tvRatio.toFixed(1)}배</b></span>
                <span>{eok(r.value)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
