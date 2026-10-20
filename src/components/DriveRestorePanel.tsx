// Drive 이전 버전에서 복구 — PC 설정(SettingsDialog)·모바일 설정(MobileSimpleView) 공용.
//   새 기기의 빈 데이터가 Drive 를 덮은 사고(2026-10-20) 같은 때, Drive 가 보관한 이전 버전(revision)을 골라 되돌린다.
//   목록을 열 때만 받는다(버전마다 내용을 받아 종목·거래 수를 보여주므로 호출이 여러 번).
import { useState } from "react";
import { listDriveBackups, restoreDriveBackup, type DriveBackup } from "../lib/syncManager";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtSize = (b: number) => (b >= 1024 ? `${(b / 1024).toFixed(0)}KB` : `${b}B`);

export function DriveRestorePanel({ onRestored }: { onRestored?: () => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<DriveBackup[] | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    setOpen(true); setBusy("이전 버전 불러오는 중…"); setMsg("");
    try { setList(await listDriveBackups()); }
    catch (e) { setMsg(`⚠️ ${(e as Error).message}`); }
    finally { setBusy(""); }
  };
  const restore = async (b: DriveBackup) => {
    if (!window.confirm(`${fmtTime(b.modifiedTime)} 버전(종목 ${b.holdings}·거래 ${b.trades})으로 되돌릴까요?\n이 기기의 지금 데이터는 이 버전으로 바뀌고, Drive 최신본도 이 버전이 됩니다.`)) return;
    setBusy("복구 중…"); setMsg("");
    try {
      await restoreDriveBackup(b.id);
      setMsg(`✅ ${fmtTime(b.modifiedTime)} 버전으로 복구했습니다`);
      onRestored?.();
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); }
    finally { setBusy(""); }
  };

  if (!open) {
    return (
      <button onClick={() => void load()}
              className="px-3 py-1.5 text-xs rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100">
        🕘 Drive 이전 버전에서 복구
      </button>
    );
  }
  return (
    <div className="rounded border border-amber-300 bg-amber-50/50 p-2 space-y-1.5 text-[12px]">
      <div className="flex items-center gap-2">
        <b className="text-amber-800">🕘 Drive 이전 버전</b>
        <span className="text-[11px] text-gray-500">Drive 가 덮어쓰기 전 내용을 보관합니다(약 30일). 종목 수가 맞는 버전을 고르세요.</span>
        <button onClick={() => setOpen(false)} className="ml-auto text-gray-400 hover:text-gray-700">✕</button>
      </div>
      {busy && <div className="text-gray-500">{busy}</div>}
      {msg && <div className={msg.startsWith("✅") ? "text-emerald-700" : "text-rose-700"}>{msg}</div>}
      {list && list.length === 0 && !busy && <div className="text-gray-500">보관된 이전 버전이 없습니다.</div>}
      {list && list.length > 0 && (
        <div className="max-h-72 overflow-auto divide-y divide-amber-100 rounded border border-amber-200 bg-white">
          {list.map((b, i) => (
            <div key={b.id} className="flex items-center gap-2 px-2 py-1">
              <span className="tabular-nums w-28 shrink-0">{fmtTime(b.modifiedTime)}{i === 0 ? " (지금)" : ""}</span>
              <span className={`tabular-nums ${b.holdings === 0 ? "text-rose-600 font-bold" : "text-gray-800"}`}>
                {b.holdings < 0 ? "읽기 실패" : `종목 ${b.holdings} · 거래 ${b.trades} · 메모 ${b.memos} · 그룹 ${b.groups}`}
              </span>
              <span className="text-gray-400 tabular-nums">{fmtSize(b.size)}</span>
              {i > 0 && b.holdings > 0 && (
                <button disabled={!!busy} onClick={() => void restore(b)}
                        className="ml-auto px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                  이 버전으로 복구
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
