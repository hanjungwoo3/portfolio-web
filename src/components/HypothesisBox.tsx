// 가설 검증 — "외국인이 장 초반 선물을 팔아 베이시스를 눌러 차익 프로그램 매도를 끌어내고, 장 막판 되사서 청산한다"
//   (사용자 가설 2026-10-21). 오늘 숫자로 조건을 하나씩 판정하고, 최근 20거래일 일별 통계로 같이 움직였는지 본다.
//   ⚠️ 인과가 아니라 '같이 일어났는가'만 본다. 외국인 선물 수급은 20분 늦다(네이버). 시간별 과거 자료는 무료 소스가 없어
//   과거 검증은 **일별**만 — 초반 매도·막판 청산 같은 장중 모양은 오늘 것만 판정할 수 있다.
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrProgramIntraday, fetchKrProgramDaily, fetchYahooTodayKst, fetchKrDailyInvestorFlow,
  type IntradayFlow, type DaySeries,
} from "../lib/api";

const MIN_MS = 60_000;
type Pt = { t: string; v: number };
const at = (s: Pt[], hm: string) => { let v: number | undefined; for (const p of s) { if (p.t <= hm) v = p.v; else break; } return v; };
const firstCross = (s: Pt[], lim: number) => s.find(p => p.v <= lim)?.t;
const fmt = (v: number, d = 0) => `${v > 0 ? "+" : ""}${v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })}`;
const addMin = (hm: string, m: number) => { const x = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + m; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

type St = "ok" | "no" | "wait";
interface Check { st: St; name: string; val: string; why?: string; now?: string }   // why = 이 조건을 왜 보나 · now = 오늘 값의 뜻

export function HypothesisBox({ ff, futMin, embedded }: { ff?: IntradayFlow; futMin?: DaySeries; embedded?: boolean }) {
  const { data: prog } = useQuery({
    queryKey: ["semi-dash-prog", "KOSPI"], queryFn: () => fetchKrProgramIntraday("KOSPI"),
    refetchInterval: MIN_MS, staleTime: 30_000,
  });
  const { data: spot } = useQuery({
    queryKey: ["yahoo-today", "^KS200"], queryFn: () => fetchYahooTodayKst("^KS200"),
    refetchInterval: MIN_MS, staleTime: 30_000,
  });
  const { data: futDaily } = useQuery({
    queryKey: ["semi-dash-daily", "futures"], queryFn: () => fetchKrDailyInvestorFlow("futures", 20),
    staleTime: 30 * 60_000, refetchOnWindowFocus: false,
  });
  const { data: progDaily } = useQuery({
    queryKey: ["prog-daily", "KOSPI"], queryFn: () => fetchKrProgramDaily("KOSPI", 20),
    staleTime: 30 * 60_000, refetchOnWindowFocus: false,
  });

  // ── 오늘 시계열 ──
  const fut: Pt[] = (ff?.points ?? []).map(p => ({ t: p.time, v: p.foreigners }));            // 외국인 선물 누적(계약)
  const arb: Pt[] = (prog?.points ?? []).map(p => ({ t: `${p.time.slice(0, 2)}:${p.time.slice(2, 4)}`, v: p.arbitrage / 1e8 }));   // 차익 누적(억)
  // 베이시스 = 선물(한경 1분, 봉 시작 시각) − 코스피200 현물(야후 5분, 봉 시작) — 현물 봉 끝(+4분)의 선물 값과 맞춘다
  const bi = futMin?.breakIdx ?? 0;
  const fTimes = futMin?.todayTimes ?? [], fCloses = futMin ? futMin.closes.slice(bi, bi + fTimes.length) : [];
  const futPx: Pt[] = fTimes.map((t, i) => ({ t, v: fCloses[i] }));
  const basis: Pt[] = (spot ?? []).flatMap(s => { const f = at(futPx, addMin(s.t, 4)); return f != null ? [{ t: s.t, v: f - s.c }] : []; });
  const dataT = fut[fut.length - 1]?.t ?? "";   // 외국인 선물 자료의 마지막 시각(20분 지연)

  const checks: Check[] = [];
  const early = dataT >= "10:30" ? "ok" : "wait";
  const f1030 = at(fut, "10:30");
  checks.push(f1030 == null ? { st: "wait", name: "① 초반(~10:30) 외국인 선물 순매도", val: "자료 대기" }
    : { st: early === "wait" ? "wait" : f1030 < 0 ? "ok" : "no", name: "① 초반(~10:30) 외국인 선물 순매도", val: `${fmt(f1030)}계약` });
  const b0 = basis.find(p => p.t >= "09:00")?.v, b1 = at(basis, "10:30");
  checks.push(b0 == null || b1 == null ? { st: "wait", name: "② 같은 구간 베이시스 축소", val: "자료 대기" }
    : { st: (basis[basis.length - 1]?.t ?? "") < "10:30" ? "wait" : b1 < b0 ? "ok" : "no", name: "② 같은 구간 베이시스 축소", val: `${b0.toFixed(2)} → ${b1.toFixed(2)}` });
  const a1030 = at(arb, "10:30");
  checks.push(a1030 == null ? { st: "wait", name: "③ 같은 구간 차익 프로그램 순매도", val: "자료 대기" }
    : { st: (arb[arb.length - 1]?.t ?? "") < "10:30" ? "wait" : a1030 < 0 ? "ok" : "no", name: "③ 같은 구간 차익 프로그램 순매도", val: `${fmt(a1030)}억` });
  const tf = firstCross(fut, -1000), ta = firstCross(arb, -300);
  checks.push(!tf || !ta ? { st: dataT >= "15:40" ? "no" : "wait", name: "④ 선물 매도가 차익 매도보다 먼저(또는 동시)", val: `선물 −1,000 ${tf ?? "없음"} · 차익 −300억 ${ta ?? "없음"}` }
    : { st: tf <= addMin(ta, 10) ? "ok" : "no", name: "④ 선물 매도가 차익 매도보다 먼저(또는 동시)", val: `선물 −1,000 ${tf} · 차익 −300억 ${ta}` });
  const f1430 = at(fut, "14:30"), fEnd = fut[fut.length - 1]?.v;
  if (f1430 == null || fEnd == null || dataT < "15:40") {
    checks.push({ st: "wait", name: "⑤ 14:30 뒤 반대로 청산(누적의 30%↑)", val: f1430 != null ? `14:30 ${fmt(f1430)} · 마감 자료 대기(20분 지연)` : "자료 대기" });
  } else {
    const d = fEnd - f1430, rev = f1430 !== 0 && Math.sign(d) === -Math.sign(f1430) && Math.abs(d) >= 0.3 * Math.abs(f1430);
    checks.push({ st: rev ? "ok" : "no", name: "⑤ 14:30 뒤 반대로 청산(누적의 30%↑)", val: `14:30 ${fmt(f1430)} → 마감 ${fmt(fEnd)} (${fmt(d)})` });
  }
  const g = ff?.points[ff.points.length - 1]?.gross;
  if (g && g.fBuy + g.fSell > 0) {
    const rate = Math.min(g.fBuy, g.fSell) / ((g.fBuy + g.fSell) / 2) * 100;
    checks.push({ st: rate >= 90 ? "ok" : "no", name: "⑥ 당일 회전 90%↑(단타·당일 청산 위주)", val: `${rate.toFixed(0)}%` });
  } else checks.push({ st: "wait", name: "⑥ 당일 회전 90%↑(단타·당일 청산 위주)", val: "자료 대기" });
  // ── 풀어 쓴 설명(사용자 요청) — 조건마다 '왜 보나' + '오늘 값은 무슨 뜻' ──
  const WHY = [
    "가설의 출발점. 외국인이 장 초반에 선물을 팔아야 이후 연결고리가 시작된다.",
    "선물을 팔면 선물값이 현물보다 싸져 베이시스(선물−현물)가 줄어든다. 줄어야 '선물 매도가 가격 차이를 만들었다'고 볼 수 있다.",
    "베이시스가 줄면 '현물 팔고 선물 사는' 차익거래가 이득이 돼 차익 프로그램이 현물을 판다 — 지수를 누르는 고리.",
    "원인이 먼저 와야 한다. 선물 매도가 차익 매도보다 늦게 나오면 '선물이 프로그램을 끌어냈다'는 순서가 아니다.",
    "가설의 끝. 장중에 판 선물을 막판에 되사서 청산(포지션을 다음 날로 안 넘김)하면 반대 방향 매수가 크게 나온다.",
    "사고판 양 대부분이 같은 날 안에서 돌았는지 — 높을수록 '당일에 사고팔아 청산하는 단타' 성격.",
  ];
  const NOW: (string | undefined)[] = [
    f1030 == null ? undefined : f1030 < 0 ? `10:30까지 외국인이 선물 ${Math.abs(f1030).toLocaleString()}계약을 순매도 — 출발점은 맞다.` : `10:30까지 외국인은 선물을 오히려 ${f1030.toLocaleString()}계약 순매수 — 출발점부터 가설과 다르다.`,
    b0 == null || b1 == null ? undefined : b1 < b0 ? `베이시스가 ${b0.toFixed(2)} → ${b1.toFixed(2)}로 줄었다 — 선물이 현물보다 상대적으로 약해졌다.` : `베이시스가 ${b0.toFixed(2)} → ${b1.toFixed(2)}로 오히려 커졌다 — 선물이 현물보다 강했다. 선물 매도의 힘이 가격 차이를 만들 만큼 크지 않았다는 뜻.`,
    a1030 == null ? undefined : a1030 < 0 ? `같은 시간 차익 프로그램이 ${Math.abs(Math.round(a1030)).toLocaleString()}억 순매도 — 현물을 누르는 고리가 나타났다.` : `같은 시간 차익 프로그램은 ${Math.round(a1030).toLocaleString()}억 순매수 — 차익 매도로 이어지지 않았다.`,
    !tf || !ta ? (tf && !ta ? "선물 매도는 있었지만 차익이 −300억까지 팔지 않았다 — 연결이 안 보인다." : !tf && ta ? "차익 매도는 있었지만 외국인 선물이 −1,000계약까지 팔지 않았다 — 차익 매도의 원인이 다른 데 있을 수 있다." : undefined)
      : tf <= addMin(ta, 10) ? `선물 매도(${tf})가 차익 매도(${ta})보다 먼저거나 거의 동시 — 순서가 가설과 맞다.` : `차익 매도(${ta})가 선물 매도(${tf})보다 먼저 — 선물이 차익을 끌어냈다고 보기 어렵다.`,
    f1430 == null || fEnd == null || dataT < "15:40" ? undefined
      : Math.sign(fEnd - f1430) === -Math.sign(f1430) && Math.abs(fEnd - f1430) >= 0.3 * Math.abs(f1430)
        ? `14:30 이후 ${Math.abs(fEnd - f1430).toLocaleString()}계약을 되사며 청산 — 막판 청산 패턴이 나왔다.`
        : `14:30 이후 ${Math.sign(fEnd - f1430) === Math.sign(f1430) || f1430 === 0 ? `같은 방향으로 ${Math.abs(fEnd - f1430).toLocaleString()}계약 더 쌓았다 — 청산이 아니라 포지션을 늘린 것(다음 날로 넘길 가능성)` : "되사긴 했지만 누적의 30%가 안 된다 — 일부만 정리"}.`,
    g && g.fBuy + g.fSell > 0 ? (() => { const r = Math.min(g.fBuy, g.fSell) / ((g.fBuy + g.fSell) / 2) * 100; return r >= 90 ? `거래의 ${r.toFixed(0)}%가 당일 안에서 사고판 물량 — 단타 성격이 강하다.` : `당일 회전 ${r.toFixed(0)}% — 방향을 실어 남긴 비중이 꽤 있다.`; })() : undefined,
  ];
  checks.forEach((c, i) => { c.why = WHY[i]; c.now = c.st === "wait" ? (NOW[i] ? `지금까지: ${NOW[i]}` : undefined) : NOW[i]; });
  const decided = checks.filter(c => c.st !== "wait"), hit = decided.filter(c => c.st === "ok").length;
  // 한 줄 결론
  const verdict = !decided.length ? "아직 판정할 자료가 모자란다."
    : hit === decided.length ? "오늘은 가설대로 흘렀다 — 선물 매도가 차익 매도를 끌어내고 막판에 정리한 모양."
    : hit >= decided.length / 2 ? `오늘은 가설과 절반쯤 맞는다(${hit}/${decided.length}) — 일부 고리만 나타났다.`
    : `오늘은 가설과 다르게 흘렀다(${hit}/${decided.length}) — ❌ 항목의 설명을 보면 어디서 어긋났는지 보인다.`;

  // ── 최근 20거래일 일별 ──
  const pd = new Map((progDaily ?? []).map(p => [p.date, p.arbitrage / 1e8]));
  const days = (futDaily?.points ?? []).filter(p => pd.has(p.date)).map(p => ({ date: p.date, f: p.foreigners, a: pd.get(p.date)!, g: p.gross }));
  const corr = (() => {
    const n = days.length; if (n < 5) return undefined;
    const mf = days.reduce((s, d) => s + d.f, 0) / n, ma = days.reduce((s, d) => s + d.a, 0) / n;
    let c = 0, vf = 0, va = 0;
    for (const d of days) { c += (d.f - mf) * (d.a - ma); vf += (d.f - mf) ** 2; va += (d.a - ma) ** 2; }
    return vf && va ? c / Math.sqrt(vf * va) : undefined;
  })();
  const sellDays = days.filter(d => d.f < 0), sellBoth = sellDays.filter(d => d.a < 0).length;
  const buyDays = days.filter(d => d.f > 0), buyBoth = buyDays.filter(d => d.a > 0).length;
  const turns = days.flatMap(d => (d.g && d.g.fBuy + d.g.fSell > 0 ? [Math.min(d.g.fBuy, d.g.fSell) / ((d.g.fBuy + d.g.fSell) / 2) * 100] : []));
  const avgTurn = turns.length ? turns.reduce((s, v) => s + v, 0) / turns.length : undefined;
  const mxF = Math.max(1, ...days.map(d => Math.abs(d.f))), mxA = Math.max(1, ...days.map(d => Math.abs(d.a)));

  const icon = (s: St) => (s === "ok" ? "✅" : s === "no" ? "❌" : "⏳");
  return (
    <div className={`${embedded ? "" : "rounded-lg border border-gray-200 bg-white p-2 "}flex flex-col min-h-0 overflow-auto text-[11.5px]`}>
      <div className="flex items-baseline gap-2">
        {!embedded && <span className="font-bold text-gray-800">가설 검증</span>}
        <span className="text-[11px] text-gray-400 truncate">외국인 초반 선물 매도 → 베이시스↓ → 차익 매도 → 막판 청산</span>
        <span className="ml-auto shrink-0 font-bold text-gray-800">{decided.length ? `오늘 ${hit}/${decided.length} 일치` : "판정 대기"}</span>
      </div>
      <div className="mt-1 space-y-0.5 tabular-nums">
        <div className="mb-1 px-1.5 py-1 rounded bg-gray-50 text-gray-800 font-semibold">{verdict}</div>
        {checks.map(c => (
          <div key={c.name} className="pb-1">
            <div className="flex gap-1.5">
              <span className="shrink-0">{icon(c.st)}</span>
              <span className="text-gray-800 font-semibold">{c.name}</span>
              <span className="ml-auto text-gray-500 text-right shrink-0">{c.val}</span>
            </div>
            {c.now && <div className={`pl-6 text-[11px] ${c.st === "ok" ? "text-rose-700" : c.st === "no" ? "text-blue-700" : "text-gray-600"}`}>→ {c.now}</div>}
            {c.why && <div className="pl-6 text-[10.5px] text-gray-400">{c.why}</div>}
          </div>
        ))}
      </div>
      <div className="mt-2 pt-1.5 border-t">
        <div className="flex items-baseline gap-2">
          <b className="text-gray-800">최근 {days.length}거래일 (일별)</b>
          <span className="text-[10.5px] text-gray-400">
            <i className="inline-block w-2 h-2 bg-orange-500 mr-0.5" />외국인 선물 순매수 <i className="inline-block w-2 h-2 bg-emerald-500 ml-1.5 mr-0.5" />차익 프로그램 순매수
          </span>
        </div>
        {days.length > 0 && (
          <svg viewBox={`0 0 ${days.length * 10} 40`} preserveAspectRatio="none" className="w-full h-10 mt-0.5">
            <line x1={0} x2={days.length * 10} y1={20} y2={20} stroke="#cbd5e1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            {days.map((d, i) => {
              const hf = (Math.abs(d.f) / mxF) * 19, ha = (Math.abs(d.a) / mxA) * 19;
              return (
                <g key={d.date}>
                  <rect x={i * 10 + 1} width={3.5} y={d.f >= 0 ? 20 - hf : 20} height={Math.max(0.3, hf)} fill="#f97316" />
                  <rect x={i * 10 + 5} width={3.5} y={d.a >= 0 ? 20 - ha : 20} height={Math.max(0.3, ha)} fill="#10b981" />
                </g>
              );
            })}
          </svg>
        )}
        <div className="tabular-nums text-gray-700 space-y-0.5 mt-0.5">
          <div>상관계수 <b>{corr != null ? corr.toFixed(2) : "-"}</b>
            <span className="text-gray-500"> {corr == null ? "" : corr >= 0.5 ? "— 같이 움직이는 편(가설 쪽)" : corr >= 0.2 ? "— 약하게 같이" : corr > -0.2 ? "— 거의 무관" : "— 반대로"}</span>
            <div className="text-[10.5px] text-gray-400">1에 가까울수록 '외국인이 선물을 판 날 차익도 팔고, 산 날 차익도 산' 날이 많다는 뜻(−1~1). 0.5 위면 하루 단위로는 가설이 잘 맞는 편.</div></div>
          <div>외국인 선물 순매도한 {sellDays.length}일 중 차익도 순매도 <b>{sellBoth}일</b>{sellDays.length ? ` (${Math.round(sellBoth / sellDays.length * 100)}%)` : ""}
            <span className="text-gray-500"> · 순매수한 {buyDays.length}일 중 차익 순매수 {buyBoth}일</span>
            <div className="text-[10.5px] text-gray-400">외국인 선물 매도가 있던 날 차익 매도가 같이 나온 비율 — 높을수록 '선물 매도 → 차익 매도' 연결이 자주 있었다.</div></div>
          <div>외국인 선물 일평균 당일 회전 <b>{avgTurn != null ? `${avgTurn.toFixed(0)}%` : "-"}</b>
            <span className="text-gray-500"> — 매일 사고판 양 대부분이 당일 안에서 돌았는지</span>
            <div className="text-[10.5px] text-gray-400">90%대면 외국인 선물은 대부분 당일에 사고팔아 정리하고, 남기는 건 일부뿐이다 — 그날 남긴 방향(순매수)이 진짜 신호.</div></div>
        </div>
        <div className="mt-1 text-[10px] text-gray-400 leading-snug">같이 일어났는지만 본다(인과 아님). 외국인 선물은 20분 지연 · 장중 모양(초반·막판)은 시간별 과거 자료가 없어 오늘만 판정.</div>
      </div>
    </div>
  );
}
