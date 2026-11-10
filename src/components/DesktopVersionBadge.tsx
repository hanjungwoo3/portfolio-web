// 데스크톱 앱 버전 표시 — "앱 v0.1.16"(새 버전이 있으면 "→ v0.1.17" 도). 앱이 아니면 아무것도 안 그린다
import { useEffect, useState } from "react";
import { desktopAppInfo, type DesktopUpdate } from "../lib/desktopApp";

export function DesktopVersionBadge({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<DesktopUpdate | null>(null);
  useEffect(() => { let alive = true; void desktopAppInfo().then(v => { if (alive) setInfo(v); }); return () => { alive = false; }; }, []);
  if (!info?.current) return null;
  const newer = info.latest && info.latest !== info.current ? info.latest : null;
  return (
    <span className={`text-[11px] text-gray-500 tabular-nums whitespace-nowrap ${className}`}
          title={newer ? `새 버전 v${newer} 이 있어요 — 앱을 다시 켜면 업데이트 안내가 뜹니다` : "지금 깔린 데스크톱 앱 버전(최신)"}>
      앱 v{info.current}{newer && <b className="ml-1 text-rose-600">→ v{newer}</b>}
    </span>
  );
}
