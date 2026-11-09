// 등락률 비교 차트 창 하나 — openCompare(lib/compareNav) 이벤트를 받아 연다. App·Mobile 최상위에 하나씩
import { useEffect, useState } from "react";
import { OPEN_COMPARE_EVENT, type CompareRequest } from "../lib/compareNav";
import { EtfCompareChartDialog } from "./EtfCompareChartDialog";

export function CompareHost() {
  const [req, setReq] = useState<(CompareRequest & { n: number }) | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<CompareRequest>).detail; if (d) setReq(r => ({ ...d, n: (r?.n ?? 0) + 1 })); };
    window.addEventListener(OPEN_COMPARE_EVENT, h);
    return () => window.removeEventListener(OPEN_COMPARE_EVENT, h);
  }, []);
  if (!req) return null;
  // key = 열 때마다 새로(seed 반영)
  return <EtfCompareChartDialog key={req.n} isOpen onClose={() => setReq(null)} seed={req.items} title={req.title} initialMode="day" />;
}
