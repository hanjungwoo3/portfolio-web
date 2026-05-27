import { useEffect, useState } from "react";

interface Props {
  dataUpdatedAt: number;        // ms epoch (TanStack Query 의 dataUpdatedAt)
  refetchIntervalMs: number;    // 다음 fetch 까지 ms (0 = 수동)
  label?: string;               // 기본 "갱신"
  onRefresh?: () => void;       // 클릭 시 수동 갱신
}

function fmt(date: Date): string {
  // HH:MM:SS (24h)
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function RefreshIndicator({ dataUpdatedAt, refetchIntervalMs, label = "갱신", onRefresh }: Props) {
  const [now, setNow] = useState(Date.now());
  const manual = refetchIntervalMs <= 0;

  useEffect(() => {
    if (manual) return;                 // 수동 모드엔 카운트다운 타이머 불필요
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [manual]);

  const interactive = onRefresh
    ? "cursor-pointer hover:text-blue-600 hover:underline"
    : "";
  const baseCls = `text-xs tabular-nums whitespace-nowrap shrink-0 ${interactive}`;
  const timeStr = dataUpdatedAt ? fmt(new Date(dataUpdatedAt)) : "—";

  // 수동 모드 — 카운트다운 대신 "🔄 ... (수동)", 클릭하여 갱신
  if (manual) {
    return (
      <span onClick={onRefresh}
            title={onRefresh ? "클릭하여 지금 갱신 (수동 모드)" : "수동 모드"}
            className={`${baseCls} text-gray-500`}>
        🔄 {label} <span className="font-mono">{timeStr}</span>
        <span className="text-gray-400"> (수동)</span>
      </span>
    );
  }

  if (!dataUpdatedAt) {
    return (
      <span onClick={onRefresh} title={onRefresh ? "클릭하여 지금 갱신" : undefined}
            className={`${baseCls} text-gray-400`}>{label}: —</span>
    );
  }

  const elapsedSec = Math.floor((now - dataUpdatedAt) / 1000);
  const intervalSec = Math.max(1, Math.floor(refetchIntervalMs / 1000));
  const remaining = Math.max(0, intervalSec - elapsedSec);

  return (
    <span onClick={onRefresh} title={onRefresh ? "클릭하여 지금 갱신" : undefined}
          className={`${baseCls} text-gray-500`}>
      {label}: <span className="font-mono">{timeStr}</span>
      <span className="text-gray-400"> ({remaining}초)</span>
    </span>
  );
}
