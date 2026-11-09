// 시장 폭 읽기 — 주간 시장 그룹 아래. KODEX 200 ↔ 200동일가중 카드의 **실제 등락률**로(금리 읽기와 같은 모양, 사용자 2026-11-03).
import { useQuery } from "@tanstack/react-query";
import type { UsIndex } from "../lib/api";
import { fetchUpDown, type UpDown } from "../lib/upDown";
import { displayPctOf } from "../lib/format";
import { readAsia, readBreadth, readVkospi, type BreadthTone } from "../lib/breadth";

const TONE: Record<BreadthTone, string> = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-300",
  warn: "bg-amber-50 text-amber-800 border-amber-300",
  bad: "bg-orange-100 text-orange-800 border-orange-300",
  calm: "bg-sky-50 text-sky-800 border-sky-300",
  flat: "bg-gray-100 text-gray-600 border-gray-300",
};

// 주간 시장 읽기 — 시장 폭(KODEX 200 vs 동일가중) · V-KOSPI · 아시아(닛케이·상해) 세 줄(사용자 2026-11-03 "v-kospi 와 닛케이, 상해도")
// 오른·내린 종목 수 막대(코스피·코스닥 전체) — 빨강(오름)·회색(그대로)·파랑(내림) 길이로(사용자 2026-11-09)
function UpDownBar({ label, u, small }: { label: string; u: UpDown; small: boolean }) {
  const tot = Math.max(1, u.rise + u.flat + u.fall);
  return (
    <span className="inline-flex items-center gap-1 tabular-nums font-bold"
          title={`${label} 오른 종목 ${u.rise}${u.upper ? `(상한가 ${u.upper})` : ""} · 그대로 ${u.flat} · 내린 종목 ${u.fall}${u.lower ? `(하한가 ${u.lower})` : ""} — 지수는 큰 회사가 끌지만, 이 막대는 종목 하나하나를 한 표씩 셉니다`}>
      <span className="text-gray-700">{label}</span>
      <span className="text-rose-600">▲{u.rise}</span>
      <span className={`inline-flex ${small ? "w-14" : "w-24"} h-1.5 rounded-full overflow-hidden bg-gray-200`}>
        <span className="bg-rose-500" style={{ width: `${(u.rise / tot) * 100}%` }} />
        <span className="bg-gray-300" style={{ width: `${(u.flat / tot) * 100}%` }} />
        <span className="bg-blue-500" style={{ width: `${(u.fall / tot) * 100}%` }} />
      </span>
      <span className="text-blue-600">▼{u.fall}</span>
    </span>
  );
}

export function BreadthNote({ usMap, small = false }: { usMap: Map<string, UsIndex>; small?: boolean }) {
  const ud = useQuery({ queryKey: ["updown"], queryFn: fetchUpDown, refetchInterval: 120_000, staleTime: 60_000, retry: 1 }).data;
  const p = (sym: string) => displayPctOf(sym, usMap.get(sym));
  // 아시아 비교는 **오늘 열린 장만** — 일본 휴장(11/3 문화의 날)·상해 개장 전(10:30 KST 전)엔 어제 값이라 비교하면 틀린다
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const live = (sym: string) => { const q = usMap.get(sym); const t = q?.regularMarketTime ? new Date((q.regularMarketTime + 9 * 3600) * 1000).toISOString().slice(0, 10) : q?.tradeDate; return t === today ? p(sym) : null; };
  const k = p("069500.KS"), ew = p("252650.KS"), ks = p("^KS11"), nk = live("^N225"), sh = live("000001.SS");
  const v = usMap.get("VKOSPI");
  const chip = (t: { text: string; tone: BreadthTone }) => <span className={`inline-block font-bold px-1.5 rounded border ${TONE[t.tone]}`}>{t.text}</span>;
  const rows: React.ReactNode[] = [];
  if (ud?.kospi) rows.push(<UpDownBar key="udk" label="코스피" u={ud.kospi} small={small} />);
  if (ud?.kosdaq) rows.push(<UpDownBar key="udq" label="코스닥" u={ud.kosdaq} small={small} />);
  if (k != null && ew != null) rows.push(
    <span key="b" title="KODEX 200 = 큰 회사일수록 비중이 큰 지수(삼성전자·SK하이닉스가 절반 가까이). 200동일가중 = 200종목을 같은 비중으로. 둘의 차이가 0.5%p 이상이면 몇몇 대형주 쏠림으로 봅니다.">
      {chip(readBreadth(k, ew))}   {/* 숫자는 카드에 있다 — 해석만(사용자 2026-11-03 "그냥 요약으로") */}
    </span>);
  if (v && v.price > 0) {
    const vc = v.prevClose > 0 ? (v.price / v.prevClose - 1) * 100 : 0;
    rows.push(
      <span key="v" title="V-KOSPI = 코스피200 옵션 가격으로 계산한 앞으로 한 달 예상 변동폭(한국판 공포지수). 20 아래 안정 · 30 이상 불안 · 40 이상 공포.">
        {/* 앞 설명은 뺐다 — 카드에 값이 있다(사용자 2026-11-03). 해석만 */}
        {chip((r => ({ ...r, text: `V-KOSPI ${r.text}` }))(readVkospi(v.price, vc)))}
      </span>);
  }
  if (ks != null && (nk != null || sh != null)) rows.push(   // 오늘 열린 아시아 장이 없으면 줄째 숨김(사용자 2026-11-03)
    <span key="a" title="같은 시간에 열리는 일본·중국 장과 비교 — 같이 움직이면 바깥(미국·글로벌) 요인, 코스피만 1%p 이상 따로 가면 한국 요인으로 봅니다.">
      {chip(readAsia(ks, [nk ?? NaN, sh ?? NaN]))}
    </span>);
  if (!rows.length) return null;
  return (
    <div className={`${small ? "text-[10px]" : "text-[11px]"} text-gray-600 leading-snug rounded-md bg-gray-50 border border-gray-200 px-2 py-1 pg-note flex flex-wrap items-center gap-x-4 gap-y-0.5`}>   {/* 한 줄로 이어 쓰고, 좁으면 줄바꿈(사용자 2026-11-03) */}
      {rows}
    </div>
  );
}

// 미국 시장 폭 — S&P 500(시총가중, 빅테크 7개가 30%대) ↔ RSP(같은 500종목 동일가중). 미국 지수 그룹 아래(사용자 2026-11-03 "미장도 동일가중")
export function UsBreadthNote({ usMap, small = false }: { usMap: Map<string, UsIndex>; small?: boolean }) {
  const k = displayPctOf("^GSPC", usMap.get("^GSPC")), ew = displayPctOf("RSP", usMap.get("RSP"));
  if (k == null || ew == null) return null;
  const t = readBreadth(k, ew, "빅테크");
  return (
    <div className={`${small ? "text-[10px]" : "text-[11px]"} text-gray-600 leading-snug rounded-md bg-gray-50 border border-gray-200 px-2 py-1 pg-note flex flex-wrap items-center gap-x-4 gap-y-0.5`}>
      <span title="S&P 500 = 큰 회사일수록 비중이 큰 지수(엔비디아·애플·마이크로소프트 등 빅테크 7개가 30%대). RSP = 같은 500종목을 0.2%씩 같은 비중으로. 둘의 차이가 0.5%p 이상이면 몇몇 빅테크 쏠림으로 봅니다.">
        <span className={`inline-block font-bold px-1.5 rounded border ${TONE[t.tone]}`}>{t.text}</span>
      </span>
    </div>
  );
}
