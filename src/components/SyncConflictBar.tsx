// 자동 동기화 충돌 배너 — "이 기기와 Drive 가 모두 바뀌었습니다".
//
// 자동 동기화의 유일한 약속은 **내 편집은 조용히 덮이지 않는다** 이다. 그래서 양쪽이 다 바뀌면
//   기계가 고르지 않고 여기서 사람에게 묻는다. 닫기(나중에)를 눌러도 데이터는 그대로 두고,
//   다음 검사 때 다시 뜬다 — 해결할 때까지 자동 올리기·받기가 둘 다 멈춰 있기 때문이다.
import { useEffect, useState } from "react";
import { SYNC_CONFLICT_EVENT, resolveConflict, clearConflictFlag } from "../lib/syncManager";

export function SyncConflictBar({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"local" | "remote" | null>(null);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(SYNC_CONFLICT_EVENT, h);
    return () => window.removeEventListener(SYNC_CONFLICT_EVENT, h);
  }, []);

  if (!open) return null;

  const pick = async (side: "local" | "remote") => {
    setBusy(side);
    try {
      await resolveConflict(side);
      if (side === "remote") onChanged();
      setOpen(false);
    } catch (e) {
      alert(`❌ 동기화 실패\n\n${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,520px)]
                    rounded-xl border border-amber-300 bg-amber-50 shadow-lg px-3 py-2.5">
      <div className="text-xs font-bold text-amber-900 mb-0.5">⚠️ 이 기기와 Drive 가 모두 바뀌었습니다</div>
      <div className="text-[11px] text-amber-800 leading-snug mb-2">
        한쪽을 고르면 다른 쪽 변경은 사라집니다. 어느 쪽이 최신인지 모르겠으면
        <b> 나중에</b> 를 누르고 설정에서 ↑↓ 로 직접 확인하세요.
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => pick("local")} disabled={!!busy}
                className="px-2 py-1 rounded border border-amber-400 bg-white text-[11px] font-bold
                           text-amber-800 hover:bg-amber-100 disabled:opacity-50">
          {busy === "local" ? "올리는 중…" : "↑ 이 기기 것 올리기"}
        </button>
        <button onClick={() => pick("remote")} disabled={!!busy}
                className="px-2 py-1 rounded border border-amber-400 bg-white text-[11px] font-bold
                           text-amber-800 hover:bg-amber-100 disabled:opacity-50">
          {busy === "remote" ? "받는 중…" : "↓ Drive 것 받기"}
        </button>
        <button onClick={() => { clearConflictFlag(); setOpen(false); }} disabled={!!busy}
                className="ml-auto px-2 py-1 rounded border border-gray-300 bg-white text-[11px]
                           text-gray-600 hover:bg-gray-100 disabled:opacity-50">
          나중에
        </button>
      </div>
    </div>
  );
}
