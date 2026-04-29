// 글로벌 "마지막 갱신 시각" 트래커 — 헤더 RefreshIndicator 용
import { useEffect, useState } from "react";

let lastTs = 0;
const listeners = new Set<(ts: number) => void>();

export function reportRefresh(ts: number) {
  if (ts > lastTs) {
    lastTs = ts;
    listeners.forEach(fn => fn(ts));
  }
}

export function useLastRefresh(): number {
  const [ts, setTs] = useState(lastTs);
  useEffect(() => {
    listeners.add(setTs);
    return () => { listeners.delete(setTs); };
  }, []);
  return ts;
}
