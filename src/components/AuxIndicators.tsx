// 카드 통계 박스 보조 지표 (PC/모바일 공용)
// — 3개월 등락률 / 변동성 / 외인비율 추세
// — 거래일엔 접힘 (default), 비거래일엔 펼침. 클릭으로 토글.
// — 통계 박스 우측 하단에 별도 네모 블럭으로 표시
// — 부모 박스에 `relative` 클래스 필요

import { useEffect, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Investor } from "../types";
import { signColor } from "../lib/format";
import { fetchKrPriceHistory, fetchYahooPriceHistory, fetchEtfKeyIndicator } from "../lib/api";

// 1년 종가 → 마지막 종가 기준 기간 전 대비 수익률(%). ETF 카드용 (1주일·1·3·6개월·1년).
function periodReturns(h: { date: string; close: number }[]): { label: string; pct: number }[] {
  if (h.length < 2) return [];
  const last = h[h.length - 1].close;
  const lastDate = new Date(h[h.length - 1].date);
  const atDate = (target: Date): number | null => {
    let base: number | null = null;
    for (let i = h.length - 1; i >= 0; i--) {
      if (new Date(h[i].date) <= target) { base = h[i].close; break; }
    }
    if (base == null) base = h[0].close;
    return base > 0 ? ((last - base) / base) * 100 : null;
  };
  const monthsAgo = (m: number) => { const t = new Date(lastDate); t.setMonth(t.getMonth() - m); return t; };
  const daysAgo = (d: number) => { const t = new Date(lastDate); t.setDate(t.getDate() - d); return t; };
  const periods: [string, Date][] = [
    ["1주일", daysAgo(7)], ["1개월", monthsAgo(1)], ["3개월", monthsAgo(3)],
    ["6개월", monthsAgo(6)], ["1년", monthsAgo(12)],
  ];
  const out: { label: string; pct: number }[] = [];
  for (const [label, target] of periods) {
    const v = atDate(target);
    if (v != null) out.push({ label, pct: v });
  }
  return out;
}

function fmtShares(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(1)}천만`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000)}만`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

interface Props {
  chart?: number[];
  investorHistory?: Investor[] | null;
  isTradingDay: boolean;
  textSize?: "xs" | "10";    // PC: xs (11px), 모바일: 10 (10px)
  defaultOpen?: boolean;     // true 면 항상 펼친 상태로 시작 (관심종목 등 우측 패널 빈 경우)
  etfTicker?: string;        // ETF 면 ticker 전달 — 외국인/기관/연기금 대신 1·3·6·12개월 수익률 표시
  usTicker?: string;         // 미국 개별주 면 심볼 전달 — 기간수익률 표시(총보수 없음). ETF 는 etfTicker 사용
  // 한국 일반 종목 코드. 주면 수급 옆(왼쪽 칸)에 기간수익률을 같이 띄운다.
  //   ETF·미국과 달리 **펼쳤을 때만** 1년 일봉을 받는다 — 종목당 1콜이라 접힌 카드까지
  //   받으면 그룹 전체보기에서 수십 콜이 그냥 나간다.
  krTicker?: string;
}

export function AuxIndicators({
  chart, investorHistory, isTradingDay, textSize = "xs", defaultOpen, etfTicker, usTicker, krTicker,
}: Props) {
  const [expanded, setExpanded] = useState(defaultOpen ?? !isTradingDay);
  const sizeCls = textSize === "10" ? "text-[10px]" : "text-[11px]";
  const isEtf = !!etfTicker;
  const isUs = !!usTicker;                 // 미국 개별주 — 기간수익률만(총보수·수급 없음)
  const isKrStock = !isEtf && !isUs && !!krTicker;   // 한국 일반 종목 — 수급 + 기간수익률 둘 다
  const histSymbol = etfTicker ?? usTicker ?? krTicker;
  const showReturns = isEtf || isUs || isKrStock;    // 기간수익률 블록을 그릴지
  // ETF·미국은 그 블록이 카드의 본문이라 항상 받는다. 한국 일반 종목은 **펼쳤을 때만**.
  const retEnabled = !!histSymbol && (isEtf || isUs || expanded);

  // 1년 히스토리로 1주일·1·3·6·12개월 수익률 (KR 6자리=한투, 그 외=야후)
  const { data: etfHist } = useQuery({
    queryKey: ["aux-ret-1y", histSymbol],
    queryFn: () => /^[\dA-Za-z]{6}$/.test(histSymbol!)   // KR 6자리(영숫자, 신형 ETF 포함)
      ? fetchKrPriceHistory(histSymbol!, "1y")
      : fetchYahooPriceHistory(histSymbol!, "1y"),
    enabled: retEnabled,
    staleTime: 60 * 60_000,
  });
  const etfRets = showReturns ? periodReturns(etfHist ?? []) : [];
  // ETF 총보수 — 맨 위 표시용
  const { data: etfKey } = useQuery({
    queryKey: ["etf-key-indicator", etfTicker],
    queryFn: () => fetchEtfKeyIndicator(etfTicker!),
    enabled: isEtf,
    staleTime: 6 * 60 * 60_000,
  });

  // 외부 일괄 토글 이벤트 — 닫기 / 열기
  useEffect(() => {
    const onClose = () => setExpanded(false);
    const onOpen = () => setExpanded(true);
    window.addEventListener("aux:closeAll", onClose);
    window.addEventListener("aux:openAll", onOpen);
    return () => {
      window.removeEventListener("aux:closeAll", onClose);
      window.removeEventListener("aux:openAll", onOpen);
    };
  }, []);

  // 두 칸으로 나눈다 — 왼쪽 기간수익률 / 오른쪽 변동성·수급.
  //   한국 일반 종목은 둘 다 있고, ETF·미국은 왼쪽만, 수급만 있는 경우는 오른쪽만 그린다.
  const retLines: ReactElement[] = [];
  const flowLines: ReactElement[] = [];
  const lines = flowLines;   // 아래 기존 push 들이 쓰는 이름(수급·변동성 쪽)

  if (chart && chart.length >= 2) {
    const first = chart[0];
    const last = chart[chart.length - 1];
    // 기간수익률 블록에 3개월이 들어 있으면 단독 3개월 라인은 생략
    if (first > 0 && etfRets.length === 0) {
      const pct = ((last - first) / first) * 100;
      lines.push(
        <div key="m3" className={`${sizeCls} leading-tight flex items-baseline justify-between gap-3`}>
          <span className="text-gray-500">3개월 </span>
          <span className={`font-medium ${signColor(pct)}`}>
            {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
          </span>
        </div>
      );
    }

    const returns: number[] = [];
    for (let i = 1; i < chart.length; i++) {
      const p = chart[i - 1];
      if (p > 0) returns.push(((chart[i] - p) / p) * 100);
    }
    if (returns.length >= 5 && !isEtf && !isUs) {   // ETF·미국 은 변동성 제외(기간수익률만)
      const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
      const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
      const vol = Math.sqrt(variance);
      lines.push(
        <div key="vol" className={`${sizeCls} leading-tight flex items-baseline justify-between gap-3`}>
          <span className="text-gray-500">변동성 </span>
          <span className="text-gray-700 font-medium">
            ±{vol.toFixed(2)}%/일
          </span>
        </div>
      );
    }
  }

  // 기간수익률 — ETF 는 맨 위에 총보수·거래량도(미국·한국 일반주는 총보수 없음).
  if (showReturns) {
    if (etfKey?.totalFee != null) {
      retLines.unshift(
        <div key="fee" className={`${sizeCls} leading-tight flex items-baseline justify-between gap-3`}>
          <span className="text-gray-500">총보수 </span>
          <span className="text-blue-600 font-bold">{etfKey.totalFee}%</span>
        </div>
      );
    }
    for (const r of etfRets) {
      const hl = r.label === "1주일";   // 1주일 — 연한 노랑 배경 강조
      retLines.push(
        <div key={`ret-${r.label}`}
             className={`${sizeCls} leading-tight flex items-baseline justify-between gap-3
                         ${hl ? "bg-yellow-100/70 rounded px-1 -mx-1" : ""}`}>
          <span className="text-gray-500">{r.label} </span>
          <span className={`font-medium ${signColor(r.pct)}`}>
            {r.pct >= 0 ? "+" : ""}{r.pct.toFixed(2)}%
          </span>
        </div>
      );
    }
  }
  // 수급 — 한국 일반 종목만. ETF·미국은 여기 값을 안 받거나 의미가 달라 그대로 둔다.
  if (!isEtf && !isUs && investorHistory && investorHistory.length >= 2) {
    const days = investorHistory.length;

    // 외국인 60일 누적 순매수 (주)
    const foreignerSum = investorHistory.reduce((s, inv) => s + (inv.외국인 ?? 0), 0);
    if (foreignerSum !== 0) {
      lines.push(
        <div key="foreigner" className={`${sizeCls} leading-tight flex items-baseline justify-between gap-3`}>
          <span className="text-gray-500">외국인 ({days}일) </span>
          <span className={`font-medium ${signColor(foreignerSum)}`}>
            {fmtShares(foreignerSum)}
          </span>
        </div>
      );
    }

    // 기관 60일 누적 순매수 (주)
    const instSum = investorHistory.reduce((s, inv) => s + (inv.기관 ?? 0), 0);
    if (instSum !== 0) {
      lines.push(
        <div key="inst" className={`${sizeCls} leading-tight flex items-baseline justify-between gap-3`}>
          <span className="text-gray-500">기관 ({days}일) </span>
          <span className={`font-medium ${signColor(instSum)}`}>
            {fmtShares(instSum)}
          </span>
        </div>
      );
    }

    // 연기금 60일 누적 순매수 (주)
    const pensionSum = investorHistory.reduce((s, inv) => s + (inv.연기금 ?? 0), 0);
    if (pensionSum !== 0) {
      lines.push(
        <div key="pension" className={`${sizeCls} leading-tight flex items-baseline justify-between gap-3`}>
          <span className="text-gray-500">연기금 ({days}일) </span>
          <span className={`font-medium ${signColor(pensionSum)}`}>
            {fmtShares(pensionSum)}
          </span>
        </div>
      );
    }
  }

  if (retLines.length === 0 && flowLines.length === 0) return null;

  // 우측 하단 별도 네모 블럭
  return (
    <div className="absolute bottom-1 right-1 z-10">
      {expanded ? (
        <div onClick={() => setExpanded(false)}
             title="클릭해 접기"
             className="border border-gray-300 rounded bg-white/95 px-1.5 py-0.5
                        shadow-sm cursor-pointer hover:bg-gray-50">
          {/* 두 칸 — 기간수익률(좌) | 변동성·수급(우). 한쪽만 있으면 그 칸만. */}
          <div className="flex items-start gap-2 tabular-nums">
            {retLines.length > 0 && <div className="space-y-0">{retLines}</div>}
            {retLines.length > 0 && flowLines.length > 0 && (
              <div className="self-stretch w-px bg-gray-200" />
            )}
            {flowLines.length > 0 && <div className="space-y-0">{flowLines}</div>}
          </div>
        </div>
      ) : (
        <button type="button"
                onClick={() => setExpanded(true)}
                title={`추가지표 (${retLines.length + flowLines.length}개) 펼치기`}
                className="border border-gray-300 rounded bg-white/95 px-1.5 py-0.5
                           text-[8px] text-gray-500 hover:text-gray-700 shadow-sm
                           cursor-pointer leading-none">
          ▲
        </button>
      )}
    </div>
  );
}
