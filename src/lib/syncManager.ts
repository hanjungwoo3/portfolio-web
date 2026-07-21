// Google Drive sync 매니저 — 3 모드 + 충돌 감지 + 자동 sync (debounce)
//
// 상태:
//   undefined → 설정없음 (default, 첫 방문)
//   "on"      → 자동 sync 활성
//   "off"     → 일시 중지 (수동 ↑↓ 만)

import { exportAll, replaceAllHoldings, replaceAllPeaks, replaceAllMemos, replaceAllTrades, applyImportedSettings } from "./db";
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

// 로그인 + 모드 OFF 로 시작 (자동 sync 는 사용자가 명시적으로 ON 해야 활성)
// — signIn() 은 redirect 라 호출 후 페이지가 google 로 이동, 돌아오면 token 저장됨
// — 사전 setSyncMode("off") 해두면 redirect 후 이미 OFF 상태 유지
export async function enableSync(): Promise<void> {
  setSyncMode("off");
  signIn();  // redirect — 이 시점 이후 코드는 페이지 navigate 로 실행 안 됨
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

// ─── 로그인 redirect 후 자동 재개할 동작 ──────────────────────
// 미로그인 상태에서 저장/불러오기 클릭 → 동작을 저장하고 signIn() redirect.
// 돌아온 뒤 설정이 다시 열리면 이 값을 읽어 그 동작을 자동 실행한다.
const KEY_PENDING = "gdrive_pending_action";
export type PendingSyncAction = "upload" | "download";
export function setPendingSyncAction(a: PendingSyncAction): void {
  try { localStorage.setItem(KEY_PENDING, a); } catch { /* noop */ }
}
export function peekPendingSyncAction(): PendingSyncAction | null {
  try {
    const v = localStorage.getItem(KEY_PENDING);
    return v === "upload" || v === "download" ? v : null;
  } catch { return null; }
}
export function clearPendingSyncAction(): void {
  try { localStorage.removeItem(KEY_PENDING); } catch { /* noop */ }
}

// ─── 수동 업로드 / 다운로드 ──────────────────────────────────

// 다운로드 직후엔 IndexedDB === Drive 라 자동 sync 가 redundant upload 일으킴.
let suppressNextAutoSync = false;

// 내용 정규화 — exported_at 같은 noise 제외, 정렬로 결정적 직렬화
// 주의: 새 동기화 필드 추가 시 반드시 여기에 포함시켜야 함 (안 그러면 변경이 silent skip 됨)
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
  // memos — updatedAt 은 noise (저장 시점 차이) 라 정규화에서 제외, 콘텐츠만 비교
  const memos = [...(p.memos ?? [])]
    .map(m => ({
      ticker: m.ticker,
      text: m.text ?? "",
      targetPrice: m.targetPrice ?? null,
      stopPrice: m.stopPrice ?? null,
      priceBasis: m.priceBasis ?? "",
      tag: m.tag ?? "",
      color: m.color ?? "",
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  // trades(거래기록) — id 기준 정렬, 콘텐츠 비교 (거래기록만 바뀌어도 업로드되도록)
  const trades = [...(p.trades ?? [])]
    .map(t => ({
      id: t.id, ticker: t.ticker, account: t.account ?? "",
      type: t.type, date: t.date, qty: t.qty, amount: t.amount,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  // settings 도 비교에 포함 — 그룹폴더/예수금/탭표시 등만 바뀌어도 업로드되도록 (skip 방지)
  const s = p.settings ?? {};
  const depKeys = Object.keys(s.deposits ?? {}).sort();
  const deposits: Record<string, number> = {};
  for (const k of depKeys) deposits[k] = s.deposits![k];
  const pendKeys = Object.keys(s.pendingBuys ?? {}).sort();
  const pendingBuys: Record<string, unknown> = {};
  for (const k of pendKeys) pendingBuys[k] = s.pendingBuys![k];   // 건별 배열 그대로(직렬화로 비교)
  const groupFolders = [...(s.groupFolders ?? [])]
    .map(f => ({ name: f.name, groups: [...f.groups].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const settings = {
    independentGroups: !!s.independentGroups,
    deposits,
    pendingBuys,
    groupFolders,
    tabVisibility: s.tabVisibility ?? null,
    dimSleeping: s.dimSleeping ?? null,
    personalProxyUrl: s.personalProxyUrl ?? null,
    personalProxies: s.personalProxies ?? null,
    personalPollMs: s.personalPollMs ?? null,
  };
  return JSON.stringify({ holdings, peaks, memos, trades, settings });
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
  // memos — 구버전 payload 에 없으면 빈 배열 (= 메모 없음 상태로 동기화)
  await replaceAllMemos(data.memos ?? []);
  // trades(거래기록) — 구버전 payload 에 없으면 빈 배열로 동기화
  await replaceAllTrades(data.trades ?? []);
  applyImportedSettings(data.settings);   // 독립 모드 등 동기화 대상 설정
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
