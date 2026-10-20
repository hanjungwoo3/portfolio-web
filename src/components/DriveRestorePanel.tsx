// Drive 이전 버전에서 복구 — PC 설정(SettingsDialog)·모바일 설정(MobileSimpleView) 공용.
//   새 기기의 빈 데이터가 Drive 를 덮은 사고(2026-10-20) 같은 때, Drive 가 보관한 이전 버전(revision)을 골라 되돌린다.
//   목록(시각·크기)은 한 콜로 **바로** 띄우고, 종목·거래 수는 버전마다 내용을 받아야 해서 2개씩 동시에 채워 넣는다.
//   (처음엔 40개를 하나씩 순서대로 다 받은 뒤 띄워 한참 '불러오는 중' 에 멈춰 있었다)
import { useState } from "react";
import { listDriveBackups, summarizeDriveBackup, restoreDriveBackup, type DriveBackup, type DriveBackupSummary } from "../lib/syncManager";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtSize = (b: number) => (b >= 1024 ? `${(b / 1024).toFixed(0)}KB` : `${b}B`);
const PARALLEL = 2;   // 4 면 Drive 속도 제한(403)에 자주 걸린다 — 재시도와 함께 2개씩

export function DriveRestorePanel({ onRestored }: { onRestored?: () => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<DriveBackup[] | null>(null);
  const [sums, setSums] = useState<Record<string, DriveBackupSummary | "err">>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    setOpen(true); setBusy("버전 목록 불러오는 중…"); setMsg(""); setSums({});
    let revs: DriveBackup[];
    try { revs = await listDriveBackups(); setList(revs); }
    catch (e) { setMsg(`⚠️ ${(e as Error).message}`); setBusy(""); return; }
    setBusy("");
    // 종목 수 채우기 — 최신부터 2개씩 동시에. 다 받기 전에도 '이 버전으로 복구' 는 누를 수 있다.
    let next = 0;
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      for (;;) {
        const r = revs[next++];
        if (!r) return;
        try { const s = await summarizeDriveBackup(r.id); setSums(m => ({ ...m, [r.id]: s })); }
        catch { setSums(m => ({ ...m, [r.id]: "err" })); }
      }
    }));
  };
  const restore = async (b: DriveBackup) => {
    const s = sums[b.id];
    const desc = s && s !== "err" ? `종목 ${s.holdings}·거래 ${s.trades}` : fmtSize(b.size);
    if (!window.confirm(`${fmtTime(b.modifiedTime)} 버전(${desc})으로 되돌릴까요?\n이 기기의 지금 데이터는 이 버전으로 바뀌고, Drive 최신본도 이 버전이 됩니다.`)) return;
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
        <span className="text-[11px] text-gray-500">Drive 가 덮어쓰기 전 내용을 보관합니다(약 30일). 종목 수가 맞는 버전을 고르세요 — 크기가 큰 쪽이 데이터가 든 버전입니다.</span>
        <button onClick={() => setOpen(false)} className="ml-auto text-gray-400 hover:text-gray-700">✕</button>
      </div>
      {busy && <div className="text-gray-500">{busy}</div>}
      {msg && <div className={msg.startsWith("✅") ? "text-emerald-700" : "text-rose-700"}>{msg}</div>}
      {list && list.length === 0 && !busy && <div className="text-gray-500">보관된 이전 버전이 없습니다.</div>}
      {list && list.length > 0 && (
        <div className="max-h-72 overflow-auto divide-y divide-amber-100 rounded border border-amber-200 bg-white">
          {list.map((b, i) => {
            const s = sums[b.id];
            const empty = s && s !== "err" && s.holdings === 0;
            return (
              <div key={b.id} className="flex items-center gap-2 px-2 py-1">
                <span className="tabular-nums w-32 shrink-0">{fmtTime(b.modifiedTime)}{i === 0 ? " (지금)" : ""}</span>
                <span className="text-gray-500 tabular-nums w-12 text-right shrink-0">{fmtSize(b.size)}</span>
                <span className={`tabular-nums ${empty ? "text-rose-600 font-bold" : "text-gray-800"}`}>
                  {!s ? <span className="text-gray-400">확인 중…</span>
                    : s === "err" ? <span className="text-gray-400">내용 확인 실패</span>
                    : `종목 ${s.holdings} · 거래 ${s.trades} · 메모 ${s.memos} · 그룹 ${s.groups}`}
                </span>
                {i > 0 && !empty && (
                  <button disabled={!!busy} onClick={() => void restore(b)}
                          className="ml-auto px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 shrink-0">
                    이 버전으로 복구
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
