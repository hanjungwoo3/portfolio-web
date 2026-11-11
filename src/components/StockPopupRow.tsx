// 📊 종목정보 ⚡ 실시간 탭의 종목 전용 칸들(2026-10-23 재설계) — SemiDashTab(popup 모드)이 조립한다.
//   호가 / 거래원(증권사·외국계) / 프로그램+투자자 오늘·5일 / 새 소식(뉴스+공시) / 토스·네이버 커뮤니티
//   + useStockLiveSignals: 위 칸들의 숫자로 '지금 신호' 줄을 만든다(쿼리키가 같아 추가 호출 없음).
//   팝업이 열려 있을 때만 받는다(= 이 칸들이 마운트된 동안). 호가 3초 · 거래원·프로그램 30초 · 뉴스·공시 1분.
import { memberFlow, onMemberFlow, watchMembers, memberFlowAvailable } from "../lib/memberFlow";
import { fetchKisInvestorEstimate, kisFutAvailable } from "../lib/kisFutures";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { subscribeKisQuotes, type KisQuote } from "../lib/kisWs";
import {
  fetchNaverNews, fetchNaverRecentDisclosures, fetchTossOrderBook, fetchTossPrices, fetchTossTicks, fetchInvestorHistory, fetchTossBrokerRanking, fetchTossProgramRecent,
} from "../lib/api";
import type { Investor } from "../types";
import { useLastRefresh } from "../lib/lastRefresh";
import { TossPane, NaverPane } from "./CommunityDialog";
import { openGoogleAi, discAiQuery } from "../lib/googleAi";

const up = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");
const BOX = "pg-card rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0 min-w-0";
const NEW_MIN = 60;   // 이 안에 올라온 소식 = NEW
const eokWon = (won: number) => `${Math.round(won / 1e8).toLocaleString()}억`;
const sgnEok = (won: number) => `${won > 0 ? "+" : won < 0 ? "−" : ""}${eokWon(Math.abs(won))}`;

// ── 쿼리(칸과 신호가 같이 쓴다 — 키가 같아 한 번만 받는다)
const useOrderBook = (code: string, on = true) =>
  useQuery({ queryKey: ["popup-orderbook", code], queryFn: () => fetchTossOrderBook(code), refetchInterval: 3_000, staleTime: 1_500, enabled: on });
const useBroker = (code: string, on = true) =>
  useQuery({ queryKey: ["popup-broker", code], queryFn: () => fetchTossBrokerRanking(code), refetchInterval: 30_000, staleTime: 15_000, enabled: on });
const useProgram = (code: string, on = true) =>
  useQuery({ queryKey: ["popup-program", code], queryFn: () => fetchTossProgramRecent(code, 10), refetchInterval: 30_000, staleTime: 15_000, enabled: on });
const useInvestors = (code: string, on = true) =>
  useQuery({ queryKey: ["popup-inv", code], queryFn: () => fetchInvestorHistory(code, 20), refetchInterval: 5 * 60_000, staleTime: 60_000, enabled: on });

// ── 지금 신호 — 종목 전용 줄(호가 벽 · 외국계 창구 · 프로그램). SemiDashTab 의 체결 줄 뒤, 시장 줄 앞에 끼운다
export interface LiveSignal { t: string; c: string; d?: string }
export function useStockLiveSignals(code: string, on: boolean, price?: number): LiveSignal[] {
  const ob = useOrderBook(code, on).data;
  const br = useBroker(code, on).data;
  const pg = useProgram(code, on).data;
  if (!on) return [];
  const out: LiveSignal[] = [];
  if (ob && ob.sumSell + ob.sumBuy > 0) {
    const pct = (ob.sumBuy / (ob.sumSell + ob.sumBuy)) * 100;
    if (pct >= 60 || pct <= 40) out.push({
      t: `호가 — 매수 잔량 ${pct.toFixed(0)}% ${pct >= 60 ? "(매수벽 두꺼움)" : "(매도벽 두꺼움)"}`,
      c: pct >= 60 ? "text-rose-600" : "text-blue-600",
      d: `10단계 잔량 매수 ${ob.sumBuy.toLocaleString()}주 · 매도 ${ob.sumSell.toLocaleString()}주. ${pct >= 60 ? "아래를 받치는 주문이 많다 — 다만 큰 벽은 체결 직전 빠지기도 한다." : "위에 파는 주문이 많아 올라가려면 그 물량을 먹어야 한다."}`,
    });
  }
  if (br && br.foreign.askVal + br.foreign.bidVal > 0) {
    const net = br.foreign.bidVal - br.foreign.askVal;
    out.push({
      t: `외국계 창구 ${net >= 0 ? "순매수" : "순매도"} ${eokWon(Math.abs(net))} (매수 ${eokWon(br.foreign.bidVal)} · 매도 ${eokWon(br.foreign.askVal)})`,
      c: up(net),
      d: "외국계 증권사(골드만·JP모간 등) 창구로 들어온 오늘 매매 합계 — 장 마감 뒤 나오는 '외국인 순매수'를 장중에 어림하는 가장 빠른 수치. 창구 = 실제 주체와 다를 수 있다.",
    });
  }
  const today = pg?.[0];
  if (today && (today.buy > 0 || today.sell > 0)) {
    const won = price ? ` ≈${sgnEok(today.net * price)}` : "";
    out.push({
      t: `프로그램 ${today.net >= 0 ? "순매수" : "순매도"} ${Math.abs(today.net).toLocaleString()}주${won} (비차익 ${today.nonArbNet > 0 ? "+" : ""}${today.nonArbNet.toLocaleString()} · 차익 ${today.arbNet > 0 ? "+" : ""}${today.arbNet.toLocaleString()})`,
      c: up(today.net),
      d: "기관·외국인이 바스켓으로 한꺼번에 사고파는 물량. 비차익이 크면 지수 ETF·펀드 자금 흐름, 차익은 선물과의 가격차 거래라 방향성과 무관하다.",
    });
  }
  return out;
}

// ── 호가창 — 토스 모양(사용자 2026-11-09 "이거 그대로 구현 못하나"):
//   가운데 = 가격(전일 대비 % 아래), 매도 잔량은 왼쪽(파랑 막대), 매수 잔량은 오른쪽(빨강 막대), 현재가 칸 테두리.
//   빈 칸 — 오른쪽 위 = 최고·최저·거래량·어제보다, 왼쪽 아래 = 체결강도 + 최근 체결. 맨 아래 = 판매대기 · 구매대기.
//   값 = 토스 v3 통합(KRX+NXT) 호가 3초 · 시세·체결 5초
export function OrderBookBox({ code }: { code: string }) {
  const { data: tossOb, error } = useOrderBook(code);
  // 앱 + 한국투자(0.1.15+) — 웹소켓 실시간 호가가 들어오면 그것을(토스 3초 대신), 10초 넘게 안 오면 토스로 돌아간다(사용자 2026-11-09 "소켓으로 실시간 안 돼?")
  const [kq, setKq] = useState<{ q: KisQuote; at: number } | null>(null);
  useEffect(() => subscribeKisQuotes(code, q => setKq({ q, at: Date.now() })), [code]);
  const live = !!kq && Date.now() - kq.at < 10_000;
  const ob = live && kq ? { close: tossOb?.close ?? 0, sell: kq.q.sell, buy: kq.q.buy, sumSell: kq.q.sumSell, sumBuy: kq.q.sumBuy, single: !!tossOb?.single, estPrice: tossOb?.estPrice } : tossOb;
  const { data: px } = useQuery({ queryKey: ["popup-ob-px", code], queryFn: () => fetchTossPrices([code]).then(r => r[0] ?? null), refetchInterval: 5_000, staleTime: 3_000 });
  const { data: ticks } = useQuery({ queryKey: ["popup-ob-ticks", code], queryFn: () => fetchTossTicks(code, 60), refetchInterval: 5_000, staleTime: 3_000 });
  const base = px?.prevClose || px?.base || 0;
  const mx = Math.max(1, ...(ob ? [...ob.sell, ...ob.buy].map(x => x.qty) : [1]));
  const pct = (p: number) => (base > 0 ? ((p / base - 1) * 100) : null);
  const tone = (p: number) => (base > 0 ? (p > base ? "text-rose-600" : p < base ? "text-blue-600" : "text-gray-700") : "text-gray-800");
  const bs = (ticks ?? []).reduce((a, t) => { if (t.side === "BUY") a.b += t.volume; else a.s += t.volume; return a; }, { b: 0, s: 0 });
  const strength = bs.s > 0 ? (bs.b / bs.s) * 100 : null;
  const cur = ob?.close || px?.price || 0;
  const priceCell = (p: number) => {
    const c = pct(p);
    return (
      <div className={`flex flex-col items-center justify-center leading-[13px] px-1 ${p === cur ? "outline outline-1 outline-gray-800 rounded bg-white" : ""}`}>
        <span className={`text-[12px] font-bold tabular-nums ${tone(p)}`}>{p.toLocaleString()}</span>
        {c != null && <span className={`text-[9.5px] tabular-nums ${tone(p)}`}>{c >= 0 ? "+" : ""}{c.toFixed(2)}%</span>}
      </div>
    );
  };
  const R = "grid grid-cols-[1fr_minmax(0,1.1fr)_1fr] items-stretch h-[28px] border-b border-white";
  return (
    <div className={BOX}>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800">호가</span>
        <span className="text-[11px] text-gray-400">{live ? <b className="text-emerald-600">● 한투 실시간</b> : "3초마다"} · KRX+NXT{ob?.single ? ` · 단일가(예상 ${ob.estPrice?.toLocaleString() ?? "-"})` : ""}</span>
      </div>
      {!ob ? <div className="text-gray-400 text-[12px] mt-2">{error ? `⚠️ ${(error as Error).message}` : "불러오는 중…"}</div> : (<>
        <div className="flex-1 min-h-0 overflow-y-auto mt-1 text-[11px]">
          {/* 매도 10 — 높은 값이 위. 오른쪽 칸 = 시세 정보 */}
          {[...ob.sell].reverse().map((x, i) => (
            <div key={"s" + x.price} className={R}>
              <div className="relative bg-blue-50/60 flex items-center justify-end pr-1.5">
                <span className="absolute inset-y-[3px] right-0 bg-blue-200/80 rounded-l" style={{ width: `${(x.qty / mx) * 100}%` }} />
                <span className="relative tabular-nums text-blue-800">{x.qty.toLocaleString()}</span>
              </div>
              <div className="bg-blue-50/30">{priceCell(x.price)}</div>
              <div className="flex items-center justify-between px-1.5 text-[10.5px] tabular-nums text-gray-500">
                {i === 0 && px && <><span>최고</span><b className="text-rose-600">{px.high?.toLocaleString?.() ?? "-"}</b></>}
                {i === 1 && px && <><span>최저</span><b className="text-blue-600">{px.low?.toLocaleString?.() ?? "-"}</b></>}
                {i === 3 && px && <><span>거래량</span><b className="text-gray-800">{px.volume?.toLocaleString?.() ?? "-"}</b></>}
                {i === 5 && base > 0 && px && <><span>어제보다</span><b className={tone(px.price)}>{(((px.price / base) - 1) * 100).toFixed(2)}%</b></>}
              </div>
            </div>
          ))}
          {/* 매수 10 — 왼쪽 칸 = 체결강도 + 최근 체결 */}
          {ob.buy.map((x, i) => {
            const t = (ticks ?? [])[i - 1];
            return (
              <div key={"b" + x.price} className={R}>
                <div className="flex items-center justify-between px-1.5 text-[10.5px] tabular-nums">
                  {i === 0
                    ? <><span className="text-gray-500">체결강도</span><b className={strength != null && strength >= 100 ? "text-rose-600" : "text-blue-600"}>{strength != null ? `${strength.toFixed(2)}%` : "-"}</b></>
                    : t ? <><span className="text-gray-700">{t.price.toLocaleString()}</span><span className={t.side === "BUY" ? "text-rose-600" : "text-blue-600"}>{t.volume.toLocaleString()}</span></> : null}
                </div>
                <div className="bg-rose-50/30">{priceCell(x.price)}</div>
                <div className="relative bg-rose-50/60 flex items-center pl-1.5">
                  <span className="absolute inset-y-[3px] left-0 bg-rose-200/80 rounded-r" style={{ width: `${(x.qty / mx) * 100}%` }} />
                  <span className="relative tabular-nums text-rose-800">{x.qty.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
        {/* 판매대기 · 구매대기 */}
        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center text-[11px] tabular-nums">
          <span className="border-t-2 border-blue-500 pt-0.5"><span className="text-gray-500">판매대기</span> <b className="text-gray-800">{ob.sumSell.toLocaleString()}</b></span>
          <span className="px-2 text-gray-400 text-[10px]">총잔량</span>
          <span className="border-t-2 border-rose-500 pt-0.5 text-right"><b className="text-gray-800">{ob.sumBuy.toLocaleString()}</b> <span className="text-gray-500">구매대기</span></span>
        </div>
      </>)}
    </div>
  );
}

// ── 거래원 — 매도·매수 상위 5 증권사(금액) + 외국계 합계. 외국계는 이름 옆 🌐
export function BrokerBox({ code, className = "" }: { code: string; className?: string }) {
  const { data: br, error } = useBroker(code);
  const mx0 = Math.max(1, ...(br ? br.rows.flatMap(r => [r.ask.val, r.bid.val]) : [1]));
  // 같은 증권사가 매도·매수 상위 5에 다 들면(사용자 2026-10-27·10-29) 두 칸 모두 총 거래액 막대 — 제 칸 색이 앞(매도 칸 파랑·매수 칸 빨강).
  //   한쪽에만 든 곳은 상대 금액을 몰라 제 막대 하나 그대로.
  const askBy = new Map(br ? br.rows.map(r => [r.ask.name, r.ask.val]) : []);
  const bidBy = new Map(br ? br.rows.map(r => [r.bid.name, r.bid.val]) : []);
  // 막대 눈금 — 양쪽에 다 든 증권사는 총 거래액(매수 + 매도)이 막대라, 그 합까지 들어가게
  const mx = Math.max(mx0, ...[...askBy].map(([n, a]) => a + (bidBy.get(n) ?? -a)));
  const side = (b: { name: string; val: number; foreign: boolean }, k: "ask" | "bid") => {
    const other = (k === "ask" ? bidBy : askBy).get(b.name);
    const both = other != null;
    const bid = k === "bid" ? b.val : other ?? 0, ask = k === "ask" ? b.val : other ?? 0;
    const net = bid - ask;
    const w = (v: number) => `${(v / mx) * 100}%`;
    // 두 칸 같은 길이 — 총 거래액(매수 + 매도). 제 칸 색이 앞(매도 칸 = 파랑 먼저, 매수 칸 = 빨강 먼저), 글자는 제 칸 금액이 오른쪽 끝(
    //   사용자 2026-10-29 "총 거래액 17,141 아냐?"). 순매매는 마우스를 올리면(title)
    return (
      // 글자 줄 아래에 막대 줄을 따로(사용자 2026-10-27 "그래프를 글자아래에 별도로")
      <div className="px-1 pt-0.5 pb-1 text-[11.5px]"
           title={both ? `${b.name} — 매수 ${eokWon(bid)} · 매도 ${eokWon(ask)} · 순${net >= 0 ? "매수" : "매도"} ${eokWon(Math.abs(net))}` : undefined}>
        <div className="flex items-center justify-between gap-1 leading-tight">
          {/* 양쪽에 다 든 증권사 — 이름 옆에 순매매, 금액은 막대 위 제 조각 자리(사용자 2026-10-29 "삼성증권(−4,449억), 그래프 위에 각 금액") */}
          {/* 순매수(+)면 이름·괄호 모두 빨강, 순매도(−)면 파랑(사용자 2026-10-29) */}
          <span className={`truncate font-medium ${net > 0 ? "text-rose-600" : net < 0 ? "text-blue-600" : "text-gray-800"}`}>{b.name}{b.foreign && <span className="ml-0.5 text-[10px]" title="외국계">🌐</span>}
            {/* 한쪽에만 든 증권사도 같은 모양(사용자 2026-10-29) — 상대편을 몰라 순매매 = 제 금액(매수 +·매도 −) */}
            {/* 괄호(순매매)는 강조하지 않는다 — 강조는 막대 위 제 칸 금액(사용자 2026-10-29) */}
            <span className={`ml-1 text-[10.5px] font-normal tabular-nums ${net > 0 ? "text-rose-600" : net < 0 ? "text-blue-600" : "text-gray-500"}`}>({net > 0 ? "+" : net < 0 ? "−" : ""}{eokWon(Math.abs(net))})</span></span>
        </div>
        {(() => {
          // 막대 위 금액 — 앞 조각(제 칸 금액, 제 색)은 왼쪽 끝, 뒤 조각(반대편, 회색)은 막대 오른쪽 끝
          const firstTxt = k === "ask" ? `−${eokWon(ask)}` : `+${eokWon(bid)}`;
          const secondTxt = k === "ask" ? `+${eokWon(bid)}` : `−${eokWon(ask)}`;
          return (
            <div className="relative h-[14px] text-[10.5px] leading-[14px] tabular-nums">
              <span className={`absolute left-0 font-bold text-[11.5px] ${k === "ask" ? "text-blue-700" : "text-rose-700"}`}>{firstTxt}</span>
              {both && <span className="absolute text-gray-400" style={{ right: `calc(100% - ${w(bid + ask)})` }}>{secondTxt}</span>}
            </div>
          );
        })()}
        <div className="relative h-[10px] mt-0.5">
          {both ? (<>
            {(() => {
              // 반대편 몫은 회색 — 막대·숫자 모두(사용자 2026-10-29 "매도는 빨간색 바와 숫자를 회색으로", "매수는 반대")
              const [first, second] = k === "ask" ? [{ v: ask, c: "bg-blue-300" }, { v: bid, c: "bg-gray-300" }] : [{ v: bid, c: "bg-rose-400" }, { v: ask, c: "bg-gray-300" }];
              return <>
                <span className={`absolute inset-y-0 left-0 rounded-l-sm ${first.c}`} style={{ width: w(first.v) }} />
                <span className={`absolute inset-y-0 rounded-r-sm ${second.c}`} style={{ left: w(first.v), width: w(second.v) }} />
              </>;
            })()}
          </>) : (
            <span className={`absolute inset-y-0 left-0 rounded-sm ${k === "ask" ? "bg-blue-300" : "bg-rose-400"}`} style={{ width: w(b.val) }} />
          )}
        </div>
      </div>
    );
  };
  const fnet = br ? br.foreign.bidVal - br.foreign.askVal : 0;
  return (
    <div className={`${BOX} ${className}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800">거래원</span>
        <span className="text-[11px] text-gray-400">증권사 창구별 오늘 매도·매수 상위 5 · 30초마다{br?.updatedAt ? ` · ${br.updatedAt.slice(11, 16)}` : ""}</span>
      </div>
      {/* 칸 높이가 정해져 있다 — 넘치는 내용(순간 매매 등)은 칸 안에서 스크롤(사용자 2026-11-11 "화면이 깨져") */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {!br ? <div className="text-gray-400 text-[12px] mt-2">{error ? `⚠️ ${(error as Error).message}` : "불러오는 중…"}</div> : (<>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div>
            <div className="text-[10.5px] text-blue-700 font-bold px-1">매도 상위</div>
            {br.rows.map((r, i) => <div key={"a" + i}>{side(r.ask, "ask")}</div>)}
          </div>
          <div>
            <div className="text-[10.5px] text-rose-700 font-bold px-1">매수 상위</div>
            {br.rows.map((r, i) => <div key={"b" + i}>{side(r.bid, "bid")}</div>)}
          </div>
        </div>
        {/* 외국계 합계 — 장중 외국인 매매의 가장 빠른 어림 */}
        <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11.5px] tabular-nums">
          <div className="flex items-baseline justify-between">
            <span className="font-bold text-gray-800">🌐 외국계 창구 합계</span>
            <b className={up(fnet)}>{fnet >= 0 ? "순매수" : "순매도"} {eokWon(Math.abs(fnet))}</b>
          </div>
          <div className="flex justify-between text-gray-600"><span>매수 <b className="text-rose-700">{eokWon(br.foreign.bidVal)}</b></span><span>매도 <b className="text-blue-700">{eokWon(br.foreign.askVal)}</b></span></div>
        </div>
        <MemberTicks code={code} />
        <div className="pt-1 text-[10.5px] text-gray-400 leading-snug">창구 = 주문을 낸 증권사. 외국계 창구가 곧 외국인은 아니지만, 장 마감 뒤 나오는 외국인 순매수를 장중에 가장 빨리 짐작하는 수치.</div>
      </>)}
      </div>
    </div>
  );
}

// ── 프로그램 + 투자자 — 오늘·5일·20일 한 표(억원). 프로그램은 주 → 현재가로 환산
// 장중 추정(한국투자) — 외국인·기관 가집계 누계(주 × 현재가 = 억원). 입력 차수(1~4차)별 마지막 값을 '오늘 장중' 으로
function KisEstimateRows({ code, price }: { code: string; price?: number }) {
  const q = useQuery({ queryKey: ["kis-inv-est", code], queryFn: () => fetchKisInvestorEstimate(code), refetchInterval: 5 * 60_000, staleTime: 2 * 60_000, retry: 1 });
  if (q.error) return <div className="text-[10.5px] text-amber-700 mt-1">⚠️ 장중 추정: {(q.error as Error).message}</div>;
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const eok = (qty?: number) => qty == null || !price ? null : (qty * price) / 1e8;
  const f = (v: number | null) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString()}억`;
  const fe = eok(last.frgn), oe = eok(last.orgn);
  return (
    <div className="mt-1 rounded border border-emerald-200 bg-emerald-50/50 px-1.5 py-1 text-[11px] tabular-nums"
         title={"한국투자 장중 추정(증권사 집계 누계) — 외국인 09:30·11:20·13:20·14:30 / 기관 10:00·11:20·13:20·14:30 입력. 확정치와 다를 수 있다\n" +
           rows.map(r => `${r.seq}차 외국인 ${r.frgn?.toLocaleString() ?? "-"}주 · 기관 ${r.orgn?.toLocaleString() ?? "-"}주`).join("\n")}>
      <span className="font-bold text-emerald-800">장중 추정</span>
      <span className="text-[10px] text-gray-400 ml-1">{rows.length}차 · 한투</span>
      <span className="ml-2">외국인 <b className={up(fe ?? 0)}>{f(fe)}</b></span>
      <span className="ml-2">기관 <b className={up(oe ?? 0)}>{f(oe)}</b></span>
    </div>
  );
}

export function ProgramInvestorBox({ code, price }: { code: string; price?: number }) {
  const { data: hist = [] } = useInvestors(code);
  const { data: prog = [] } = useProgram(code);
  const won = (r: Investor, v: number) => (v * (r.종가 || price || 0)) / 1e8;
  const ROWS: { label: string; net: (r: Investor) => number; gs?: "개인" | "외국인" | "기관" }[] = [
    { label: "개인", net: r => r.개인, gs: "개인" },
    { label: "외국인", net: r => r.외국인, gs: "외국인" },
    { label: "기관(금투 제외)", net: r => r.기관 - r.금융투자, gs: "기관" },
    { label: "연기금", net: r => r.연기금 },
  ];
  const sum = (n: number, f: (r: Investor) => number) => hist.slice(0, n).reduce((a, r) => a + won(r, f(r)), 0);
  const psum = (n: number) => prog.slice(0, n).reduce((a, r) => a + r.net, 0) * (price ?? 0) / 1e8;
  const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString()}`;
  const cell = (v: number) => <td className={`text-right ${up(v)}`}>{fmt(v)}</td>;
  const today = hist[0];
  const kisOn = kisFutAvailable();   // 한국투자 연동(앱) — 장중 추정 줄
  return (
    <div className={BOX}>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800">프로그램 · 투자자</span>
        <span className="text-[11px] text-gray-400">억원 · 오늘은 잠정치(장중 개인 0) · 프로그램은 주 × 현재가</span>
      </div>
      <table className="w-full tabular-nums text-[11.5px] mt-1">
        <thead><tr className="text-gray-500 text-[10.5px] border-b">
          <th className="text-left font-normal"></th><th className="text-right font-normal">오늘</th><th className="text-right font-normal">5일</th><th className="text-right font-normal">20일</th>
        </tr></thead>
        <tbody>
          <tr className="border-b border-gray-100 bg-indigo-50/40">
            <td className="py-1 font-bold">프로그램 <span className="font-normal text-[10px] text-gray-400">전체</span></td>
            {cell(psum(1))}{cell(psum(5))}{cell(psum(Math.min(10, prog.length)))}
          </tr>
          {ROWS.map(x => (
            <tr key={x.label} className="border-b border-gray-100">
              <td className="py-1 font-bold">{x.label}</td>
              {cell(today ? won(today, x.net(today)) : 0)}{cell(sum(5, x.net))}{cell(sum(20, x.net))}
            </tr>
          ))}
        </tbody>
      </table>
      {kisOn && <KisEstimateRows code={code} price={price} />}
      {prog.length > 0 && (
        <div className="text-[10.5px] text-gray-500 mt-1">
          프로그램 오늘 — 비차익 <b className={up(prog[0].nonArbNet)}>{fmt(prog[0].nonArbNet)}주</b> · 차익 <b className={up(prog[0].arbNet)}>{fmt(prog[0].arbNet)}주</b>
          <span className="text-gray-400"> (20일 칸은 최근 {Math.min(10, prog.length)}일)</span>
        </div>
      )}
      {/* 날짜별 — 순매수 + 그 아래 매수·매도(개인·외국인·기관 총계) */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-1.5">
        <table className="w-full tabular-nums text-[11px]">
          <thead><tr className="text-gray-500 text-[10px] border-b">
            <th className="text-left font-normal">날짜</th><th className="text-right font-normal">프로그램</th>
            {ROWS.slice(0, 3).map(x => <th key={x.label} className="text-right font-normal">{x.label.replace("(금투 제외)", "")}</th>)}
          </tr></thead>
          <tbody>
            {hist.slice(0, 20).map(r => {
              const p = prog.find(x => x.date === r.date);
              return (
                <tr key={r.date} className="border-b border-gray-100 align-top">
                  <td className="py-0.5 text-gray-500">{r.date?.slice(5).replace("-", "/")}</td>
                  <td className={`text-right ${p ? up(p.net) : "text-gray-300"}`}>{p ? fmt((p.net * (r.종가 || price || 0)) / 1e8) : "—"}</td>
                  {ROWS.slice(0, 3).map(x => {
                    const g = x.gs ? r.매수매도?.[x.gs] : undefined;
                    return (
                      <td key={x.label} className="text-right">
                        <span className={up(won(r, x.net(r)))}>{fmt(won(r, x.net(r)))}</span>
                        {g && (g[0] > 0 || g[1] > 0) && x.gs !== "기관" && (
                          <span className="block text-[9px] leading-tight text-gray-400">
                            <span className="text-rose-500">{Math.round(won(r, g[0])).toLocaleString()}</span>·<span className="text-blue-500">{Math.round(won(r, g[1])).toLocaleString()}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 새 소식 — 네이버 뉴스 + 공시를 시각순으로 한 줄씩. 1시간 안 = NEW
type FeedItem = { kind: "news" | "disc"; t: number; title: string; sub: string; url: string; id: string };
// kind — 뉴스만 / 공시만(사용자 요청 2026-10-23: 뉴스 · 공시 · 토스 · 네이버 4칸 한 줄). 생략하면 둘 다 섞어서
export function FeedBox({ code, name, kind, className = "" }: { code: string; name: string; kind?: "news" | "disc"; className?: string }) {
  const news = useQuery({ queryKey: ["popup-news", code], queryFn: () => fetchNaverNews(code, 20), refetchInterval: 60_000, staleTime: 30_000, enabled: kind !== "disc" });
  const disc = useQuery({ queryKey: ["popup-disc", code], queryFn: () => fetchNaverRecentDisclosures(code, 20), refetchInterval: 60_000, staleTime: 30_000, enabled: kind !== "news" });
  // 네이버 뉴스 datetime = "YYYYMMDDHHmm"(KST), 공시 = "YYYY-MM-DDTHH:mm:ss"(KST)
  const kst = (y: string, mo: string, d: string, h: string, mi: string) => Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`);
  const items: FeedItem[] = [
    ...(kind === "disc" ? [] : news.data ?? []).flatMap(n => n.datetime.length >= 12 ? [{ kind: "news" as const, id: "n" + n.id, title: n.title, sub: n.press, url: n.url,
      t: kst(n.datetime.slice(0, 4), n.datetime.slice(4, 6), n.datetime.slice(6, 8), n.datetime.slice(8, 10), n.datetime.slice(10, 12)) }] : []),
    ...(kind === "news" ? [] : disc.data ?? []).map(d => ({ kind: "disc" as const, id: "d" + d.id, title: d.title, sub: "공시", url: d.url, t: Date.parse(`${d.datetime}+09:00`) })),
  ].filter(x => Number.isFinite(x.t)).sort((a, b) => b.t - a.t).slice(0, 30);
  const now = Date.now();
  const todayKst = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
  const when = (t: number) => {
    const d = new Date(t + 9 * 3600_000).toISOString();
    return d.slice(0, 10) === todayKst ? d.slice(11, 16) : `${+d.slice(5, 7)}/${+d.slice(8, 10)} ${d.slice(11, 16)}`;
  };
  const fresh = items.filter(x => now - x.t < NEW_MIN * 60_000).length;
  return (
    <div className={`${BOX} ${className}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800">{kind === "news" ? "📰 뉴스" : kind === "disc" ? "📋 공시" : `${name} 새 소식`}</span>
        <span className="text-[11px] text-gray-400">{kind ? "" : "뉴스 + 공시 · "}시간순 · 1분마다{fresh ? ` · 1시간 안 ${fresh}건` : ""}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto mt-1">
        {(kind === "disc" ? disc.isLoading : kind === "news" ? news.isLoading : news.isLoading && disc.isLoading) ? <div className="text-gray-400 text-[12px]">불러오는 중…</div>
          : !items.length ? <div className="text-gray-400 text-[12px]">새 소식이 없습니다</div>
          : items.map(x => {
            const isNew = now - x.t < NEW_MIN * 60_000;
            return (
              <a key={x.id} href={x.url} target="_blank" rel="noopener noreferrer"
                 className="flex gap-2 py-1 border-b border-gray-100 hover:bg-gray-50 text-[12px]">
                {/* 시간 칸을 따로 두지 않는다 — 칸이 좁아 제목이 잘렸다. 뉴스는 신문사 뒤, 공시는 제목 뒤에 작게(사용자 2026-11-09) */}
                <span className={`shrink-0 px-1 rounded text-[10px] font-bold leading-[18px] ${x.kind === "disc" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>
                  {x.kind === "disc" ? "공시" : "뉴스"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`leading-snug line-clamp-2 ${isNew ? "font-bold text-gray-900" : "text-gray-800"}`}>
                    {isNew && <span className="mr-1 px-1 rounded bg-rose-500 text-white text-[9px] align-middle">NEW</span>}
                    {x.title}
                    {x.kind === "disc" && <span className="ml-1 text-[10px] font-normal text-gray-400 tabular-nums whitespace-nowrap">{when(x.t)}</span>}
                  </span>
                  {x.kind === "news" && <span className="block text-[10.5px] text-gray-400">{x.sub}<span className="ml-1.5 tabular-nums">{when(x.t)}</span></span>}
                </span>
                {x.kind === "disc" && (
                  <button type="button" title="이 공시를 구글 AI 로 요약"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); openGoogleAi(discAiQuery(name, code, x.title, when(x.t), x.url)); }}
                          className="self-start shrink-0 px-1 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold leading-[18px]">
                    AI
                  </button>
                )}
              </a>
            );
          })}
      </div>
    </div>
  );
}

// ── 커뮤니티 칸 — 토스·네이버 각각(새 소식과 3등분). 패널 자체는 CommunityDialog 것 그대로
export function CommunityPane({ code, kind }: { code: string; kind: "toss" | "naver" }) {
  const refreshTs = useLastRefresh();
  return (
    <div className="pg-card rounded-lg min-h-0 min-w-0 [&>div]:h-full">
      {kind === "toss" ? <TossPane ticker={code} refreshTs={refreshTs} /> : <NaverPane ticker={code} refreshTs={refreshTs} />}
    </div>
  );
}

// ── 거래원 순간 매매(한투 실시간 거래원, 앱 + 한국투자만) — HTS [0127] 거래원 순간거래량처럼 "몇 시, 어느 창구가 몇 주"(사용자 2026-11-10)
function MemberTicks({ code }: { code: string }) {
  const [, setV] = useState(0);
  const [onlyForeign, setOnlyForeign] = useState(true);
  useEffect(() => {
    if (!memberFlowAvailable()) return;
    const off = onMemberFlow(code, () => setV(v => v + 1));
    const unsub = watchMembers(code);
    return () => { off(); unsub(); };
  }, [code]);
  if (!memberFlowAvailable()) return null;
  const mf = memberFlow(code);
  const rows = mf.ticks.filter(t => !onlyForeign || t.foreign).slice(0, 60);
  return (
    <div className="mt-2 rounded border border-indigo-200 bg-indigo-50/40 px-2 py-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <b className="text-indigo-800">⚡ 순간 매매</b>
        <span className="text-[10px] text-gray-400">한투 실시간 · 상위 5 창구 누적의 변화</span>
        <label className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={onlyForeign} onChange={e => setOnlyForeign(e.target.checked)} />🌐 외국계만
        </label>
      </div>
      {mf.glob && (
        <div className="text-[10.5px] text-gray-600 tabular-nums">외국계 누적 매수 {mf.glob.buy.toLocaleString()}주 · 매도 {mf.glob.sell.toLocaleString()}주 · 순 <b className={up(mf.glob.net)}>{mf.glob.net > 0 ? "+" : ""}{mf.glob.net.toLocaleString()}주</b></div>
      )}
      {!rows.length ? <div className="text-gray-400 py-1">아직 없어요 — 창구 상위 5의 수량이 바뀌면 여기 쌓입니다</div> : (
        <div className="max-h-40 overflow-y-auto mt-0.5">
          <table className="w-full tabular-nums">
            <tbody>
              {rows.map((t, i) => (
                <tr key={i} className="border-b border-indigo-100/70 last:border-0">
                  <td className="py-0.5 text-gray-500 w-[4.6em]">{t.t}</td>
                  <td className="truncate max-w-[7em]">{t.name}{t.foreign && <span className="ml-0.5 text-[10px]">🌐</span>}</td>
                  <td className={`text-right font-bold ${t.side === "BUY" ? "text-rose-600" : "text-blue-600"}`}>{t.side === "BUY" ? "매수" : "매도"} {t.qty.toLocaleString()}</td>
                  <td className="text-right text-gray-500 pl-1">{t.cum.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
