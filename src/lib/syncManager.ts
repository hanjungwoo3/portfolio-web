// Google Drive sync 매니저 — 3 모드 + 충돌 감지 + 자동 sync (debounce)
//
// 상태:
//   undefined → 설정없음 (default, 첫 방문)
//   "on"      → 자동 sync 활성
//   "off"     → 일시 중지 (수동 ↑↓ 만)

import { exportAll, replaceAllHoldings, replaceAllPeaks } from "./db";
import type { ExportPayload } from "./db";
import { isSignedIn, signIn, signOut, wasSignedIn, getAccessToken } from "./googleAuth";
import { downloadFile, uploadFile, getFileMeta, deleteFile } from "./googleDrive";

type SyncMode = "on" | "off";
const KEY_MODE = "gdrive_sync_mode";
const KEY_LAST_SYNCED_TS = "gdrive_last_synced_ts";  // 마지막으로 가져온 Drive modifiedTime
const KEY_LAST_SYNCED_AT = "gdrive_last_synced_at";  // 마지막 sync 수행 시각 (UI 표시)

export type SyncState = "unconfigured" | "on" | "off";

export function getSyncState(): SyncState {
  try {
    const m = localStorage.getItem(KEY_MODE);
    if (m === "on") return "on";
    if (m === "off") return "off";
    return "unconfigured";
  } catch {
    return "unconfigured";
  }
}

export function setSyncMode(mode: SyncMode): void {
  try { localStorage.setItem(KEY_MODE, mode); } catch { /* noop */ }
}

export function getLastSyncedAt(): string | null {
  try { return localStorage.getItem(KEY_LAST_SYNCED_AT); } catch { return null; }
}

function setLastSynced(driveTs: string): void {
  try {
    localStorage.setItem(KEY_LAST_SYNCED_TS, driveTs);
    localStorage.setItem(KEY_LAST_SYNCED_AT, new Date().toISOString());
  } catch { /* noop */ }
}

function getLastSyncedTs(): string | null {
  try { return localStorage.getItem(KEY_LAST_SYNCED_TS); } catch { return null; }
}

// 로그인 + 모드 ON 활성화
export async function enableSync(): Promise<void> {
  await signIn();
  setSyncMode("on");
}

// 로그아웃 + 상태 초기화
export async function disableSync(): Promise<void> {
  await signOut();
  try {
    localStorage.removeItem(KEY_MODE);
    localStorage.removeItem(KEY_LAST_SYNCED_TS);
    localStorage.removeItem(KEY_LAST_SYNCED_AT);
  } catch { /* noop */ }
}

// 모드만 토글 (로그인 유지)
export function pauseSync(): void { setSyncMode("off"); }
export function resumeSync(): void { setSyncMode("on"); }

// ─── 수동 업로드 / 다운로드 ──────────────────────────────────

// 다운로드 직후엔 IndexedDB === Drive 라 자동 sync 가 redundant upload 일으킴.
let suppressNextAutoSync = false;

// 내용 정규화 — exported_at 같은 noise 제외, 정렬로 결정적 직렬화
function normalize(p: ExportPayload): string {
  const holdings = [...(p.holdings ?? [])]
    .map(s => ({
      ticker: s.ticker, name: s.name,
      shares: s.shares, avg_price: s.avg_price,
      buy_date: s.buy_date ?? "",
      market: s.market ?? "",
      account: s.account ?? "",
    }))
    .sort((a, b) => `${a.ticker}|${a.account}`.localeCompare(`${b.ticker}|${b.account}`));
  const peakKeys = Object.keys(p.peaks ?? {}).sort();
  const peaks: Record<string, number> = {};
  for (const k of peakKeys) peaks[k] = p.peaks[k];
  return JSON.stringify({ holdings, peaks });
}

export async function uploadToDrive(): Promise<void> {
  const local = await exportAll();
  // Drive 와 내용이 같으면 업로드 skip — modifiedTime advance 방지 (핑퐁 차단)
  try {
    const remote = await downloadFile<ExportPayload>();
    if (remote && normalize(local) === normalize(remote.data)) {
      setLastSynced(remote.modifiedTime);
      return;
    }
  } catch { /* 다운로드 실패 시 그냥 업로드 진행 */ }
  const ts = await uploadFile<ExportPayload>(local);
  setLastSynced(ts);
}

export async function downloadFromDrive(): Promise<boolean> {
  const result = await downloadFile<ExportPayload>();
  if (!result) return false;
  const { data, modifiedTime } = result;
  if (data.holdings) await replaceAllHoldings(data.holdings);
  if (data.peaks) await replaceAllPeaks(data.peaks);
  setLastSynced(modifiedTime);
  suppressNextAutoSync = true;
  return true;
}

// ─── 충돌 감지 — 편집 시작 전 호출 ──────────────────────────
// 반환:
//   "ok"          : 충돌 없음, 편집 진행 OK
//   "conflict"    : Drive 가 더 새로움, 사용자 결정 필요
//   "skip"        : sync OFF/unconfigured/로그아웃, 충돌 체크 안 함
export type ConflictResult =
  | { kind: "ok" }
  | { kind: "conflict"; driveTs: string; lastTs: string | null }
  | { kind: "skip" };

export async function checkConflict(): Promise<ConflictResult> {
  if (getSyncState() !== "on") return { kind: "skip" };
  const token = await getAccessToken();
  if (!token) return { kind: "skip" };
  try {
    const meta = await getFileMeta();
    if (!meta) return { kind: "ok" };  // Drive 에 파일 없음
    const lastTs = getLastSyncedTs();
    const tsAdvanced = !lastTs || meta.modifiedTime > lastTs;
    if (!tsAdvanced) return { kind: "ok" };
    // Drive 가 새로움 → 실제 내용도 다른지 확인 (modifiedTime 만 advance 한 ping-pong 차단)
    const remote = await downloadFile<ExportPayload>();
    if (!remote) return { kind: "ok" };
    const local = await exportAll();
    if (normalize(local) === normalize(remote.data)) {
      // 내용 동일 — silent ts 갱신, conflict 무시
      setLastSynced(remote.modifiedTime);
      return { kind: "ok" };
    }
    return { kind: "conflict", driveTs: meta.modifiedTime, lastTs };
  } catch {
    return { kind: "skip" };
  }
}

// ─── 자동 sync (debounce) ─────────────────────────────────
// 데이터 변경 후 호출 — 500ms 후 업로드 (연속 변경은 배칭, 사용자 체감 즉시)

let autoSyncTimer: number | null = null;
const AUTO_SYNC_DEBOUNCE_MS = 500;

export function scheduleAutoSync(): void {
  if (getSyncState() !== "on") return;
  // 다운로드 직후 — 1회 억제 (redundant upload 방지)
  if (suppressNextAutoSync) {
    suppressNextAutoSync = false;
    return;
  }
  if (autoSyncTimer !== null) {
    window.clearTimeout(autoSyncTimer);
  }
  autoSyncTimer = window.setTimeout(async () => {
    autoSyncTimer = null;
    if (getSyncState() !== "on") return;
    if (!isSignedIn()) {
      const t = await getAccessToken();
      if (!t) return;
    }
    try {
      await uploadToDrive();
    } catch {
      // 실패는 무음 처리 — 다음 변경 시 재시도
    }
  }, AUTO_SYNC_DEBOUNCE_MS);
}

// ─── 재방문 시 silent restore ─────────────────────────────
// 모드가 "on" 이고 이전 로그인 흔적 있으면 토큰 자동 갱신 시도
export async function tryRestoreSession(): Promise<boolean> {
  if (getSyncState() !== "on") return false;
  if (!wasSignedIn()) return false;
  const t = await getAccessToken();
  return !!t;
}

// 디버깅 — Drive 데이터 완전 삭제
export async function eraseDriveFile(): Promise<void> {
  await deleteFile();
  try {
    localStorage.removeItem(KEY_LAST_SYNCED_TS);
    localStorage.removeItem(KEY_LAST_SYNCED_AT);
  } catch { /* noop */ }
}
