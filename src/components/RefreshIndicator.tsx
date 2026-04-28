import { useEffect, useState } from "react";

interface Props {
  dataUpdatedAt: number;        // ms epoch (TanStack Query 의 dataUpdatedAt)
  refetchIntervalMs: number;    // 다음 fetch 까지 ms
  label?: string;               // 기본 "갱신"
}

function fmt(date: Date): string {
  // HH:MM:SS (24h)
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function RefreshIndicator({ dataUpdatedAt, refetchIntervalMs, label = "갱신" }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!dataUpdatedAt) {
    return (
      <span className="text-xs text-gray-400">{label}: —</span>
    );
  }

  const elapsedSec = Math.floor((now - dataUpdatedAt) / 1000);
  const intervalSec = Math.max(1, Math.floor(refetchIntervalMs / 1000));
  const remaining = Math.max(0, intervalSec - elapsedSec);
  const timeStr = fmt(new Date(dataUpdatedAt));

  return (
    <span className="text-xs text-gray-500 tabular-nums">
      {label}: <span className="font-mono">{timeStr}</span>
      <span className="text-gray-400"> ({remaining}초)</span>
    </span>
  );
}
