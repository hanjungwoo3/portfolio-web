// 시장 폭 읽기 — 주간 시장 그룹 아래. KODEX 200 ↔ 200동일가중 카드의 **실제 등락률**로(금리 읽기와 같은 모양, 사용자 2026-11-03).
import type { UsIndex } from "../lib/api";
import { displayPctOf } from "../lib/format";
import { readAsia, readBreadth, readVkospi, type BreadthTone } from "../lib/breadth";

const TONE: Record<BreadthTone, string> = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-300",
  warn: "bg-amber-50 text-amber-800 border-amber-300",
  bad: "bg-orange-100 text-orange-800 border-orange-300",
  calm: "bg-sky-50 text-sky-800 border-sky-300",
  flat: "bg-gray-100 text-gray-600 border-gray-300",
};
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

// 주간 시장 읽기 — 시장 폭(KODEX 200 vs 동일가중) · V-KOSPI · 아시아(닛케이·상해) 세 줄(사용자 2026-11-03 "v-kospi 와 닛케이, 상해도")
export function BreadthNote({ usMap, small = false }: { usMap: Map<string, UsIndex>; small?: boolean }) {
  const p = (sym: string) => displayPctOf(sym, usMap.get(sym));
  // 아시아 비교는 **오늘 열린 장만** — 일본 휴장(11/3 문화의 날)·상해 개장 전(10:30 KST 전)엔 어제 값이라 비교하면 틀린다
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const live = (sym: string) => { const q = usMap.get(sym); const t = q?.regularMarketTime ? new Date((q.regularMarketTime + 9 * 3600) * 1000).toISOString().slice(0, 10) : q?.tradeDate; return t === today ? p(sym) : null; };
  const k = p("069500.KS"), ew = p("252650.KS"), ks = p("^KS11"), nk = live("^N225"), sh = live("000001.SS");
  const v = usMap.get("VKOSPI");
  const chip = (t: { text: string; tone: BreadthTone }) => <span className={`inline-block font-bold px-1.5 rounded border ${TONE[t.tone]}`}>{t.text}</span>;
  const rows: React.ReactNode[] = [];
  if (k != null && ew != null) rows.push(
    <div key="b" title="KODEX 200 = 큰 회사일수록 비중이 큰 지수(삼성전자·SK하이닉스가 절반 가까이). 200동일가중 = 200종목을 같은 비중으로. 둘의 차이가 0.5%p 이상이면 몇몇 대형주 쏠림으로 봅니다.">
      <b>시장 폭 읽기</b> · KODEX 200 {pct(k)} vs 200동일가중 {pct(ew)} = 차이 <b>{(ew - k >= 0 ? "+" : "")}{(ew - k).toFixed(2)}%p</b>. {chip(readBreadth(k, ew))}
    </div>);
  if (v && v.price > 0) {
    const vc = v.prevClose > 0 ? (v.price / v.prevClose - 1) * 100 : 0;
    rows.push(
      <div key="v" title="V-KOSPI = 코스피200 옵션 가격으로 계산한 앞으로 한 달 예상 변동폭(한국판 공포지수). 20 아래 안정 · 30 이상 불안 · 40 이상 공포.">
        <b>공포 읽기</b> · V-KOSPI <b>{v.price.toFixed(2)}</b> ({pct(vc)}). {chip(readVkospi(v.price, vc))}
      </div>);
  }
  if (ks != null) rows.push(
    <div key="a" title="같은 시간에 열리는 일본·중국 장과 비교 — 같이 움직이면 바깥(미국·글로벌) 요인, 코스피만 1%p 이상 따로 가면 한국 요인으로 봅니다.">
      <b>아시아 읽기</b> · 코스피 {pct(ks)} · 닛케이 {nk != null ? pct(nk) : "휴장·개장 전"} · 상해 {sh != null ? pct(sh) : "휴장·개장 전"}. {nk == null && sh == null ? <span className="text-gray-400">오늘 열린 아시아 장이 아직 없어 비교하지 않습니다.</span> : chip(readAsia(ks, [nk ?? NaN, sh ?? NaN]))}
    </div>);
  if (!rows.length) return null;
  return (
    <div className={`${small ? "text-[10px]" : "text-[11px]"} text-gray-600 leading-snug rounded-md bg-gray-50 border border-gray-200 px-2 py-1 pg-note space-y-0.5`}>
      {rows}
    </div>
  );
}
