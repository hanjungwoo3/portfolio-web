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
// → modifiedTime advance → 다음 conflict check 시 false-positive 충돌 발생.
// 이를 방지하기 위해 "다음 1회 autoSync 억제" 플래그.
let suppressNextAutoSync = false;

export async function uploadToDrive(): Promise<void> {
  const payload = await exportAll();
  const ts = await uploadFile<ExportPayload>(payload);
  setLastSynced(ts);
}

export async function downloadFromDrive(): Promise<boolean> {
  const result = await downloadFile<ExportPayload>();
  if (!result) return false;  // 파일 없음
  const { data, modifiedTime } = result;
  if (data.holdings) await replaceAllHoldings(data.holdings);
  if (data.peaks) await replaceAllPeaks(data.peaks);
  setLastSynced(modifiedTime);
  // IndexedDB 변경 → reloadKey++ → scheduleAutoSync 트리거 가능 → 억제
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
    if (!meta) return { kind: "ok" };  // Drive 에 파일 없음 (처음 sync)
    const lastTs = getLastSyncedTs();
    if (!lastTs) {
      // 한 번도 sync 한 적 없음 — 이미 Drive 에 파일 있음 (다른 기기에서 만든 것)
      return { kind: "conflict", driveTs: meta.modifiedTime, lastTs: null };
    }
    if (meta.modifiedTime > lastTs) {
      return { kind: "conflict", driveTs: meta.modifiedTime, lastTs };
    }
    return { kind: "ok" };
  } catch {
    return { kind: "skip" };  // 네트워크 오류 등 — 편집 진행 허용
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
