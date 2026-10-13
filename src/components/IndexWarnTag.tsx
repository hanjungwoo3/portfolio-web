// 지수 탭 카드의 경고 책갈피 — 투자주의·투자경고·투자위험. PC·모바일이 같이 쓴다.
//   누르면 내 종목 카드와 같은 시장조치 공시 팝업이 뜬다.
import { useState } from "react";
import { MarketAlertDialog } from "./MarketAlertDialog";
import type { AlertLevel } from "../lib/marketAlerts";

// 색은 종목 카드(StockCard WARN_BG)와 같은 체계
const BG: Record<AlertLevel, string> = {
  투자위험: "bg-red-700", 투자경고: "bg-orange-600", 투자주의: "bg-amber-500",
};

export function IndexWarnTag({ ticker, name, level, shift }: {
  ticker: string; name: string; level: AlertLevel;
  shift?: boolean;   // ETF 책갈피가 같은 자리에 있으면 오른쪽으로 비킨다
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
              title={`${name} — 거래소 ${level} 지정. 눌러서 시장조치 공시 보기`}
              className={`absolute -top-2 ${shift ? "left-9" : "left-1"} z-20 px-1.5 py-0 rounded
                          text-[10px] font-bold leading-tight text-white ${BG[level]}`}>
        {level}
      </button>
      {open && <MarketAlertDialog ticker={ticker} name={name} warning={level} onClose={() => setOpen(false)} />}
    </>
  );
}
