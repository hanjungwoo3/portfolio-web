// 🩳 공매도 분석 — 삼성전자·SK하이닉스(사용자 2026-11-21 "공매도 관련 분석해봐" → "이걸 앱에 표현할 수 있을까?").
//   ① 공매도 평균가(최근 5·20일, 수량 가중) vs 지금 값 → 공매도 쪽 손익과 '본전까지 몇 %' — 반등 시 되사기(숏커버링)가 나올 자리
//   ② 대차잔고(빌려 간 주식) 추이 — 5·20일 변화, 100일 중 위치, 커버 일수(잔고 ÷ 20일 평균 거래량)
//   ③ 공매도 거래 비중 — 오늘 vs 20일 평균
//   자료: 토스 공매도 추이·대차거래(일별, 장 마감 뒤 반영). 예측이 아니라 지금 상태 — 매수·매도 권유 아님.
import { useQueries } from "@tanstack/react-query";
import { fetchKrShortSelling, fetchKrLendingTrading, type ShortSellingPoint, type LendingTradingPoint } from "../lib/api";
import { Sparkline } from "./Sparkline";

const STOCKS = [{ code: "005930", name: "삼성전자" }, { code: "000660", name: "SK하이닉스" }] as const;
const HOUR = 3600_000;

const won = (v: number) => (v >= 1e4 ? `${(v / 1e4).toLocaleString(undefined, { maximumFractionDigits: 1 })}만원` : `${Math.round(v).toLocaleString()}원`);
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** 최근 n일 공매도 평균가(수량 가중) */
function avgShortPrice(rows: ShortSellingPoint[], n: number): number | undefined {
  const r = rows.slice(-n), v = r.reduce((a, x) => a + x.shortVolume, 0);
  return v > 0 ? r.reduce((a, x) => a + x.shortVolume * x.avgPrice, 0) / v : undefined;
}

export function ShortAnalysisCard() {
  const shorts = useQueries({ queries: STOCKS.map(s => ({ queryKey: ["sa-short", s.code], queryFn: () => fetchKrShortSelling(s.code, 5), staleTime: 3 * HOUR, retry: 1 })) });
  const lends = useQueries({ queries: STOCKS.map(s => ({ queryKey: ["sa-lend", s.code], queryFn: () => fetchKrLendingTrading(s.code, 5), staleTime: 3 * HOUR, retry: 1 })) });
  const last = shorts[0].data?.[shorts[0].data.length - 1]?.date;
  return (
    <div className="relative rounded-xl border border-gray-300 bg-white pg-box p-3 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-700">
        🩳 공매도 분석 <span className="text-[11px] font-normal text-gray-400">{last ? `${+last.slice(5, 7)}/${+last.slice(8, 10)} 기준` : "받는 중…"}</span>
      </span>
      <div className="mb-1.5 text-[12px] text-gray-600 leading-snug">
        공매도한 쪽이 <b>얼마에 팔았고 지금 이익인지 손해인지</b>, 빌려 간 주식(<b>대차잔고</b>)이 늘었는지를 봅니다. 공매도는 언젠가 되사서 갚아야 해서,
        주가가 <b>공매도 평균가 근처까지 오르면 되사기(숏커버링)</b>가 반등을 키울 수 있습니다. 미래를 맞히는 게 아니라 지금 상태입니다.
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {STOCKS.map((s, i) => <StockShort key={s.code} name={s.name} sh={shorts[i].data} ln={lends[i].data} />)}
      </div>
      <div className="mt-1.5 text-[10.5px] text-gray-400 leading-snug">
        출처: 토스 공매도 추이·대차거래(일별, 장 마감 뒤 반영). 공매도 평균가 = 그 기간 날마다의 공매도 평균가를 수량으로 가중 평균한 값(추정 원가). 대차잔고에는 공매도 말고 차익거래·대여 물량도 섞여 있습니다.
      </div>
    </div>
  );
}

function StockShort({ name, sh, ln }: { name: string; sh?: ShortSellingPoint[]; ln?: LendingTradingPoint[] }) {
  if (!sh?.length || !ln?.length) return <div className="rounded-lg border border-gray-200 p-2 text-[12px] text-gray-400">{name} — 받는 중…</div>;
  const close = sh[sh.length - 1].close ?? ln[ln.length - 1].close;
  const a5 = avgShortPrice(sh, 5), a20 = avgShortPrice(sh, 20);
  const pnl = (a?: number) => (a && close ? (1 - close / a) * 100 : undefined);   // 공매도 쪽 손익(+ = 이익)
  const toBE = a5 && close ? (a5 / close - 1) * 100 : undefined;                   // 최근 5일 공매도 본전까지 주가가 몇 % 올라야
  const bal = ln.map(x => x.balanceVolume), b0 = bal[bal.length - 1];
  const chg = (n: number) => (bal.length > n && bal[bal.length - 1 - n] > 0 ? (b0 / bal[bal.length - 1 - n] - 1) * 100 : undefined);
  const c5 = chg(5), c20 = chg(20);
  const last100 = bal.slice(-100), hi100 = Math.max(...last100), lo100 = Math.min(...last100);
  const pos = hi100 > lo100 ? (b0 - lo100) / (hi100 - lo100) : 0.5;   // 0 = 100일 최저, 1 = 최고
  const vols = sh.slice(-20).map(x => x.volume ?? 0).filter(v => v > 0);
  const coverDays = vols.length ? b0 / (vols.reduce((a, v) => a + v, 0) / vols.length) : undefined;
  const r = sh.map(x => x.ratio), rNow = r[r.length - 1], r20 = r.slice(-21, -1).reduce((a, v) => a + v, 0) / Math.max(1, r.slice(-21, -1).length);
  // 한 줄 판정 — 숫자로 확인되는 것만
  const notes: { t: string; c: string }[] = [];
  if (c20 != null && c20 >= 15) notes.push({ t: `대차잔고가 20일 새 ${pct(c20)} — 빌려 간 주식이 크게 늘었다(반등 땐 되사기 물량)`, c: "text-amber-700" });
  if (pos >= 0.95) notes.push({ t: "대차잔고 100일 중 최고 수준", c: "text-amber-700" });
  const p20 = pnl(a20);
  if (p20 != null && p20 >= 5) notes.push({ t: `최근 20일 공매도는 약 ${p20.toFixed(0)}% 이익 — 급하게 되살 압박은 약함`, c: "text-gray-600" });
  if (toBE != null && toBE > 0 && toBE <= 6) notes.push({ t: `주가가 ${pct(toBE)}(${won(a5!)}) 오르면 최근 5일 공매도분이 본전 — 되사기가 나올 수 있는 자리`, c: "text-rose-700" });
  if (rNow >= r20 + 1) notes.push({ t: `오늘 공매도 비중 ${rNow.toFixed(1)}% — 20일 평균(${r20.toFixed(1)}%)보다 높다`, c: "text-blue-700" });
  return (
    <div className="rounded-lg border border-gray-200 p-2">
      <div className="flex items-baseline gap-2">
        <b className="text-[13px] text-gray-800">{name}</b>
        {close ? <span className="text-[11.5px] text-gray-500 tabular-nums">종가 {won(close)}</span> : null}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1.5 text-[11.5px]">
        <Cell label="공매도 평균가(5일)" v={a5 ? won(a5) : "—"} sub={pnl(a5) != null ? `공매도 쪽 ${pnl(a5)! >= 0 ? "이익" : "손해"} ${Math.abs(pnl(a5)!).toFixed(1)}%` : ""} hint="최근 5거래일 공매도 평균가(수량 가중) — 지금 값보다 높으면 공매도한 쪽이 이익" />
        <Cell label="공매도 평균가(20일)" v={a20 ? won(a20) : "—"} sub={pnl(a20) != null ? `공매도 쪽 ${pnl(a20)! >= 0 ? "이익" : "손해"} ${Math.abs(pnl(a20)!).toFixed(1)}%` : ""} hint="최근 20거래일 공매도 평균가(수량 가중)" />
        <Cell label="공매도 비중(오늘)" v={`${rNow.toFixed(1)}%`} sub={`20일 평균 ${r20.toFixed(1)}%`} hint="그날 거래량 중 공매도 비중" tone={rNow >= r20 + 1 ? "text-blue-700" : undefined} />
      </div>
      <div className="mt-1.5 rounded-md border border-gray-200 px-1.5 py-1">
        <div className="flex items-baseline gap-2 text-[11.5px] flex-wrap">
          <b className="text-gray-700">대차잔고</b>
          <b className="tabular-nums">{(b0 / 1e4).toLocaleString(undefined, { maximumFractionDigits: 0 })}만 주</b>
          {c5 != null && <span className={`tabular-nums ${c5 > 0 ? "text-amber-700" : "text-gray-500"}`}>5일 {pct(c5)}</span>}
          {c20 != null && <span className={`tabular-nums ${c20 > 0 ? "text-amber-700" : "text-gray-500"}`}>20일 {pct(c20)}</span>}
          <span className="text-gray-500">100일 중 {pos >= 0.95 ? "최고 수준" : pos <= 0.05 ? "최저 수준" : `${Math.round(pos * 100)}% 위치`}</span>
          {coverDays != null && <span className="text-gray-500" title="대차잔고 ÷ 최근 20일 평균 거래량 — 빌린 주식을 다 되사는 데 걸리는 날 수(어림)">커버 {coverDays.toFixed(1)}일치</span>}
        </div>
        <Sparkline data={bal.slice(-100)} width={300} height={28} className="mt-0.5 w-full h-[28px]" strokeWidth={1.2} color="#d97706" />
      </div>
      {notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11.5px] leading-snug">
          {notes.map((n, k) => <li key={k} className={n.c}>• {n.t}</li>)}
        </ul>
      )}
    </div>
  );
}

function Cell({ label, v, sub, hint, tone }: { label: string; v: string; sub: string; hint: string; tone?: string }) {
  return (
    <div title={hint} className="rounded-md border border-gray-200 bg-gray-50/60 px-1.5 py-1">
      <div className="text-[10.5px] text-gray-500">{label}</div>
      <div className={`text-[13px] font-bold tabular-nums ${tone ?? "text-gray-800"}`}>{v}</div>
      <div className="text-[10.5px] text-gray-500">{sub}</div>
    </div>
  );
}
