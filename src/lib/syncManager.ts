// Google Drive sync 매니저 — 수동 ↑↓ + **양방향 자동 동기화**(옵션) + 충돌 감지
//
// 상태:
//   undefined → 설정없음 (default, 첫 방문)
//   "on"      → 자동 sync 활성
//   "off"     → 일시 중지 (수동 ↑↓ 만)

import { exportAll, replaceAllHoldings, replaceAllPeaks, replaceAllMemos, replaceAllTrades, applyImportedSettings, loadPeaks } from "./db";
import type { ExportPayload } from "./db";
import { signIn, signOut, wasSignedIn, getAccessToken } from "./googleAuth";
import { downloadFile, uploadFile, getFileMeta, deleteFile, listRevisions, downloadRevision } from "./googleDrive";

type SyncMode = "on" | "off";
const KEY_MODE = "gdrive_sync_mode";
const KEY_LAST_SYNCED_TS = "gdrive_last_synced_ts";  // 마지막으로 가져온 Drive modifiedTime
const KEY_LAST_SYNCED_AT = "gdrive_last_synced_at";  // 마지막 sync 수행 시각 (UI 표시)
// ★ 마지막으로 Drive 와 맞춰졌을 때의 **로컬 내용 지문**.
//   이게 있어야 "이 기기에서 바뀐 게 있나" 를 네트워크 없이 판별할 수 있고,
//   그래야 자동으로 받아올 때 내 편집을 조용히 덮어쓰는 사고를 막는다.
const KEY_LAST_SYNCED_HASH = "gdrive_last_synced_hash";

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

function setLastSynced(driveTs: string, hash?: string): void {
  try {
    localStorage.setItem(KEY_LAST_SYNCED_TS, driveTs);
    localStorage.setItem(KEY_LAST_SYNCED_AT, new Date().toISOString());
    if (hash != null) localStorage.setItem(KEY_LAST_SYNCED_HASH, hash);
  } catch { /* noop */ }
}

function getLastSyncedTs(): string | null {
  try { return localStorage.getItem(KEY_LAST_SYNCED_TS); } catch { return null; }
}

function getLastSyncedHash(): string | null {
  try { const h = localStorage.getItem(KEY_LAST_SYNCED_HASH); return h == null ? null : upgradeSyncedHash(h); } catch { return null; }
}
/** 옛 지문(2026-10-27 이전: peaks·연동 메타 전체 포함) → 지금 형식. 저장된 '지문'은 normalize 결과 JSON 그대로라 바꿔 읽을 수 있다.
 *  안 바꾸면 업데이트 직후 모든 기기가 "로컬이 바뀌었다"로 보고 한 번 더 충돌을 물었다. */
export function upgradeSyncedHash(h: string): string {
  try {
    const o = JSON.parse(h) as { holdings?: unknown; peaks?: unknown; memos?: unknown; trades?: unknown; settings?: Record<string, unknown> };
    const lg = o.settings?.linkedGroups as Record<string, { broker?: string; accountSeq?: string }> | null | undefined;
    const slim = lg && typeof lg === "object"
      ? Object.fromEntries(Object.keys(lg).sort().map(g => [g, { broker: lg[g].broker, accountSeq: lg[g].accountSeq }])) : lg;
    if (!("peaks" in o) && JSON.stringify(slim) === JSON.stringify(lg)) return h;   // 이미 새 형식
    const settings = o.settings ? { ...o.settings, linkedGroups: slim ?? null } : o.settings;
    return JSON.stringify({ holdings: o.holdings, memos: o.memos, trades: o.trades, settings });
  } catch { return h; }
}

// 로그인 + 모드 OFF 로 시작 (자동 sync 는 사용자가 명시적으로 ON 해야 활성)
// — signIn() 은 redirect 라 호출 후 페이지가 google 로 이동, 돌아오면 token 저장됨
// — 사전 setSyncMode("off") 해두면 redirect 후 이미 OFF 상태 유지
export async function enableSync(): Promise<void> {
  setSyncMode("off");
  // 웹은 redirect — 이 시점 이후 코드는 페이지 navigate 로 실행 안 됨(Promise 가 안 끝난다).
  //   데스크톱 앱은 브라우저 로그인 뒤 제자리에서 끝난다 → 호출측이 이어서 첫 저장/불러오기를 한다.
  const ok = await signIn();
  if (!ok) throw new Error("Google 로그인 실패·취소");
}

// 로그아웃 + 상태 초기화
export async function disableSync(): Promise<void> {
  await signOut();
  try {
    localStorage.removeItem(KEY_MODE);
    localStorage.removeItem(KEY_LAST_SYNCED_TS);
    localStorage.removeItem(KEY_LAST_SYNCED_AT);
    localStorage.removeItem(KEY_LAST_SYNCED_HASH);
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

// 내용 정규화 — exported_at 같은 noise 제외, 정렬로 결정적 직렬화
// 주의: 새 동기화 필드 추가 시 반드시 여기에 포함시켜야 함 (안 그러면 변경이 silent skip 됨)
export function normalize(p: ExportPayload): string {
  const holdings = [...(p.holdings ?? [])]
    .map(s => ({
      ticker: s.ticker, name: s.name,
      shares: s.shares, avg_price: s.avg_price,
      buy_date: s.buy_date ?? "",
      market: s.market ?? "",
      account: s.account ?? "",
      source: s.source ?? "",   // 증권사 연동 표식 — 빠지면 Drive 왕복 뒤 잠금이 풀린다(테스트 있음)
    }))
    .sort((a, b) => `${a.ticker}|${a.account}`.localeCompare(`${b.ticker}|${b.account}`));
  // peaks(최고가)는 **지문에서 뺀다** — 가격이 오를 때마다 기기마다 스스로 갱신해, 앱과 웹을 같이 켜 두면 양쪽 다 '바뀜'이
  //   되어 아무것도 안 고쳤는데 매번 "Drive 와 다르다, 가져올까?" 를 물었다(사용자 2026-10-27). 값은 payload 로 계속 오가고,
  //   받을 때 기기 값과 **큰 쪽**을 남긴다(downloadFromDrive) — 앞으로만 가는 값이라 합쳐도 잃는 게 없다.
  // memos — updatedAt 은 noise (저장 시점 차이) 라 정규화에서 제외, 콘텐츠만 비교
  //
  // ⚠️ **Memo 에 필드를 추가하면 여기에도 반드시 넣어야 한다.** 빠뜨리면 그 필드만 바꿨을 때
  //   지문이 그대로라 autoPush 가 "변경 없음" 으로 건너뛰고, 나중에 autoPull 이 그 필드가 없는
  //   Drive 버전으로 로컬을 덮어써서 **값이 사라진다.** entryPrice(기대가)가 실제로 그랬다.
  //   빠짐을 막는 테스트가 src/lib/__tests__/syncNormalize.test.ts 에 있다.
  const memos = [...(p.memos ?? [])]
    .map(m => ({
      ticker: m.ticker,
      text: m.text ?? "",
      targetPrice: m.targetPrice ?? null,
      stopPrice: m.stopPrice ?? null,
      entryPrice: m.entryPrice ?? null,
      priceBasis: m.priceBasis ?? "",
      tag: m.tag ?? "",
      color: m.color ?? "",
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  // trades(거래기록) — id 기준 정렬, 콘텐츠 비교 (거래기록만 바뀌어도 업로드되도록)
  const trades = [...(p.trades ?? [])]
    .map(t => ({
      id: t.id, ticker: t.ticker, account: t.account ?? "",
      type: t.type, date: t.date, qty: t.qty, amount: t.amount, fee: t.fee ?? 0,
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
    // 증권사 연동 그룹 — **어떤 계좌가 어느 그룹인지만**. 갱신 시각(lastSyncAt·lastTradeSyncAt)·오류·평단 환산 기억(usdAvg)은
    //   앱이 5분마다 스스로 바꾸는 값이라 지문에 넣으면 앱 쪽이 늘 '바뀜'이 되어 충돌 질문이 반복됐다(위 peaks 와 같은 사고).
    //   받을 때도 그 값들은 이 기기 것을 지킨다(db.applyImportedSettings → mergeLinkedGroups).
    linkedGroups: s.linkedGroups
      ? Object.fromEntries(Object.keys(s.linkedGroups).sort().map(g => [g, { broker: s.linkedGroups![g].broker, accountSeq: s.linkedGroups![g].accountSeq }]))
      : null,
  };
  return JSON.stringify({ holdings, memos, trades, settings });
}

// ─── 빈 데이터 덮어쓰기 방지 ─────────────────────────────────
// ★ 2026-10-20 사고: 새 폰에 앱을 깔고 로그인했더니 Drive 의 기존 데이터가 사라졌다.
//   비어 있는 기기의 내용이 데이터가 든 Drive 파일을 덮은 것. 경로가 여럿이라(자동 올리기의 '기준 시각 없음'
//   예외·수동 ↑·충돌 배너 '이 기기 것') 업로드 직전에 한 곳에서 막는다.
//   종목·거래·메모가 **하나도 없는** 로컬로 **무언가 있는** Drive 를 덮으려 하면 거부한다.
//   (정말 비우고 싶으면 Drive 파일 삭제 기능을 쓰면 된다 — 실수로 비는 경우가 압도적으로 많다)
const countOf = (p?: Partial<ExportPayload> | null) =>
  (p?.holdings?.length ?? 0) + (p?.trades?.length ?? 0) + (p?.memos?.length ?? 0);
export class EmptyOverwriteError extends Error {
  constructor() { super("이 기기에 종목·거래 데이터가 없어 Drive 의 기존 데이터를 덮어쓰지 않았습니다 — 먼저 Drive 에서 불러오세요"); }
}
async function guardedUpload(local: ExportPayload): Promise<string> {
  if (countOf(local) === 0) {
    const remote = await downloadFile<ExportPayload>();   // 실패하면 던진다 — 확인 못 하면 올리지 않는다
    if (remote && countOf(remote.data) > 0) throw new EmptyOverwriteError();
  }
  return uploadFile<ExportPayload>(local);
}

export async function uploadToDrive(): Promise<void> {
  const local = await exportAll();
  // Drive 와 내용이 같으면 업로드 skip — modifiedTime advance 방지 (핑퐁 차단)
  try {
    const remote = await downloadFile<ExportPayload>();
    if (remote && normalize(local) === normalize(remote.data)) {
      setLastSynced(remote.modifiedTime, normalize(local));
      return;
    }
  } catch { /* 다운로드 실패 시 그냥 업로드 진행 — 단 빈 데이터면 guardedUpload 가 다시 확인한다 */ }
  const ts = await guardedUpload(local);
  setLastSynced(ts, normalize(local));
}

export async function downloadFromDrive(): Promise<boolean> {
  const result = await downloadFile<ExportPayload>();
  if (!result) return false;
  const { data, modifiedTime } = result;
  if (data.holdings) await replaceAllHoldings(data.holdings);
  if (data.peaks) {   // 최고가는 큰 쪽을 남긴다(지문 밖 — normalize 주석). 이전 버전 복구(restoreDriveBackup)는 통째로 되돌린다
    const mine = await loadPeaks();
    const merged: Record<string, number> = { ...data.peaks };
    for (const [t, v] of mine) if (!(merged[t] >= v)) merged[t] = v;
    await replaceAllPeaks(merged);
  }
  // memos — 구버전 payload 에 없으면 빈 배열 (= 메모 없음 상태로 동기화)
  await replaceAllMemos(data.memos ?? []);
  // trades(거래기록) — 구버전 payload 에 없으면 빈 배열로 동기화
  await replaceAllTrades(data.trades ?? []);
  applyImportedSettings(data.settings);   // 독립 모드 등 동기화 대상 설정
  // 지문은 **적용 뒤 DB 를 다시 읽어서** 만든다. 원격 payload 를 그대로 해싱하면
  //   replaceAll* 가 손보는 필드(빈 문자열 정규화 등) 때문에 지문이 어긋나
  //   바로 다음 검사에서 "로컬이 바뀌었다" 로 오인해 쓸데없이 되올린다.
  setLastSynced(modifiedTime, normalize(await exportAll()));
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
  const token = await getAccessToken({ allowPopupRefresh: false });
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

// ─── 자동 동기화 (양방향) ─────────────────────────────────
// 규칙은 하나다: **내 편집은 절대 조용히 덮이지 않는다.**
//   올리기 — 로컬 지문이 마지막 sync 때와 다르면 올린다. 같으면 네트워크를 아예 안 쓴다.
//   받기   — Drive 가 앞서 있고 **이 기기엔 안 올라간 변경이 없을 때만** 조용히 적용한다.
//            양쪽 다 바뀌었으면 손대지 않고 SYNC_CONFLICT_EVENT 를 쏴서 사용자에게 묻는다.
//
// 주기: 올릴 게 있나 15초(로컬만 확인 — 대부분 0콜), 받을 게 있나 5분 + 탭 복귀할 때마다.
//   폰에서 고치고 PC 를 다시 보는 순간이 바로 '탭 복귀' 라 체감은 즉시에 가깝다.
//
// ※ 예전의 debounce 방식(scheduleAutoSync)은 지웠다 — 호출처가 한 곳도 없어 죽어 있었고,
//   데이터 변경 지점마다 훅을 심어야 해서 localStorage 에 있는 설정 변경은 어차피 놓쳤다.
//   지문 비교는 출처를 가리지 않는다.

export const SYNC_PULLED_EVENT = "gdrive-pulled";       // 자동으로 받아와 DB 가 바뀜 → UI 새로고침
export const SYNC_CONFLICT_EVENT = "gdrive-conflict";   // 양쪽 다 바뀜 → 사용자 결정 필요

const PUSH_CHECK_MS = 15_000;
const PULL_CHECK_MS = 5 * 60_000;

let conflictPending = false;   // 배너가 떠 있는 동안 또 쏘지 않는다

function emitConflict(): void {
  if (conflictPending) return;
  conflictPending = true;
  window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT));
}
export function clearConflictFlag(): void { conflictPending = false; }

/** 이 기기에 아직 Drive 로 안 올라간 변경이 있나 (네트워크 안 씀) */
export async function hasLocalChanges(): Promise<boolean> {
  const h = getLastSyncedHash();
  if (h == null) return true;       // 기준이 없으면 '있다' 쪽으로 — 덮어쓰기보다 묻는 게 낫다
  return normalize(await exportAll()) !== h;
}

/** 바뀐 게 있으면 올린다. 올리기 전에 Drive 가 앞서 있지 않은지 본다. */
export async function autoPush(): Promise<"pushed" | "none" | "conflict" | "skip"> {
  if (getSyncState() !== "on") return "skip";
  const local = await exportAll();
  const h = normalize(local);
  if (h === getLastSyncedHash()) return "none";          // ← 여기서 대부분 끝난다(0콜)
  const token = await getAccessToken({ allowPopupRefresh: false });
  if (!token) return "skip";
  const meta = await getFileMeta();
  const lastTs = getLastSyncedTs();
  // ★ 기준 시각이 없는데(이 기기는 Drive 와 한 번도 맞춘 적 없음 — 새 설치) Drive 에 파일이 있으면 **올리지 않는다**.
  //   예전엔 `lastTs &&` 조건 때문에 이 경우 검사를 건너뛰고 그대로 올려 남의(=다른 기기의) 데이터를 덮었다.
  if (meta && (!lastTs || meta.modifiedTime > lastTs)) {
    emitConflict();                                      // Drive 도 앞섰다 — 내가 올리면 저쪽이 사라진다
    return "conflict";
  }
  const ts = await guardedUpload(local);
  setLastSynced(ts, h);
  return "pushed";
}

/** Drive 가 앞서 있고 내 변경이 없으면 조용히 받아 적용한다. */
export async function autoPull(): Promise<"applied" | "none" | "conflict" | "skip"> {
  if (getSyncState() !== "on") return "skip";
  const token = await getAccessToken({ allowPopupRefresh: false });
  if (!token) return "skip";
  const meta = await getFileMeta();
  if (!meta) return "none";                              // Drive 에 아직 파일 없음
  const lastTs = getLastSyncedTs();
  if (lastTs && meta.modifiedTime <= lastTs) return "none";
  const remote = await downloadFile<ExportPayload>();
  if (!remote) return "none";
  const localNorm = normalize(await exportAll());
  const remoteNorm = normalize(remote.data);
  if (localNorm === remoteNorm) {                        // 내용은 같고 시각만 앞선 경우
    setLastSynced(remote.modifiedTime, localNorm);
    return "none";
  }
  const lastHash = getLastSyncedHash();
  if (lastHash == null || localNorm !== lastHash) {
    emitConflict();                                      // 양쪽 다 바뀜 — 손대지 않는다
    return "conflict";
  }
  await downloadFromDrive();
  window.dispatchEvent(new CustomEvent(SYNC_PULLED_EVENT));
  return "applied";
}

/** 충돌 배너의 선택 — "local" 은 이 기기 것을 올리고, "remote" 는 Drive 것을 받는다. */
export async function resolveConflict(side: "local" | "remote"): Promise<void> {
  clearConflictFlag();
  if (side === "remote") {
    await downloadFromDrive();
    window.dispatchEvent(new CustomEvent(SYNC_PULLED_EVENT));
    return;
  }
  const local = await exportAll();
  const ts = await guardedUpload(local);
  setLastSynced(ts, normalize(local));
}

/** 자동 동기화를 켤 때 한 번 — 양쪽을 맞춰 기준 지문을 세운다.
 *  Drive 에 파일이 없으면 올리고, 내용이 같으면 지문만 세우고, 다르면 묻는다.
 *  (이게 없으면 첫 검사에서 "이 기기가 바뀐 건지" 를 판별할 수 없어 매번 충돌로 뜬다) */
export async function reconcileOnEnable(): Promise<"pushed" | "insync" | "conflict" | "skip"> {
  // 사용자가 스위치를 켠 직후라 제스처가 살아 있다 → 팝업 갱신 허용.
  const token = await getAccessToken();
  if (!token) return "skip";
  const local = await exportAll();
  const h = normalize(local);
  const remote = await downloadFile<ExportPayload>();
  if (!remote) {
    const ts = await guardedUpload(local);
    setLastSynced(ts, h);
    return "pushed";
  }
  if (normalize(remote.data) === h) {
    setLastSynced(remote.modifiedTime, h);
    return "insync";
  }
  emitConflict();
  return "conflict";
}

// ─── 이전 버전에서 복구 ─────────────────────────────────────
export interface DriveBackup { id: string; modifiedTime: string; size: number }
export interface DriveBackupSummary { holdings: number; trades: number; memos: number; groups: number }
/** Drive 백업 파일의 이전 버전 목록(최신 먼저) — 메타데이터만, 한 콜이라 즉시. */
export async function listDriveBackups(): Promise<DriveBackup[]> {
  return (await listRevisions()).map(r => ({ id: r.id, modifiedTime: r.modifiedTime, size: Number(r.size ?? 0) }));
}
/** 한 버전의 내용 요약(종목·거래·메모·그룹 수) — 목록을 띄운 뒤 몇 개씩 동시에 채운다. */
export async function summarizeDriveBackup(id: string): Promise<DriveBackupSummary> {
  const d = await downloadRevision<ExportPayload>(id);
  return {
    holdings: d.holdings?.length ?? 0, trades: d.trades?.length ?? 0, memos: d.memos?.length ?? 0,
    groups: new Set((d.holdings ?? []).map(h => h.account ?? "")).size,
  };
}
/** 고른 버전으로 이 기기를 되돌리고, 그 내용을 다시 Drive 최신본으로 올린다(다른 기기도 받아가게). */
export async function restoreDriveBackup(revisionId: string): Promise<void> {
  const data = await downloadRevision<ExportPayload>(revisionId);
  if (countOf(data) === 0) throw new Error("이 버전은 비어 있습니다 — 다른 버전을 골라주세요");
  if (data.holdings) await replaceAllHoldings(data.holdings);
  if (data.peaks) await replaceAllPeaks(data.peaks);
  await replaceAllMemos(data.memos ?? []);
  await replaceAllTrades(data.trades ?? []);
  applyImportedSettings(data.settings);
  const local = await exportAll();
  const ts = await uploadFile<ExportPayload>(local);     // 복구본이 최신이 된다(빈 데이터가 아니라 guard 불필요)
  setLastSynced(ts, normalize(local));
}

let pushTimer: number | null = null;
let pullTimer: number | null = null;
let visHandler: (() => void) | null = null;
let running = false;

/** 앱 시작 시 1회 호출. 모드가 꺼져 있으면 아무것도 하지 않는다(내부에서 매번 다시 확인). */
export function startAutoSync(): void {
  if (running) return;
  running = true;
  const guard = (fn: () => Promise<unknown>) => () => {
    if (getSyncState() !== "on") return;
    void fn().catch(() => { /* 실패는 무음 — 다음 차례에 다시 시도 */ });
  };
  pushTimer = window.setInterval(guard(autoPush), PUSH_CHECK_MS);
  pullTimer = window.setInterval(guard(autoPull), PULL_CHECK_MS);
  visHandler = () => { if (document.visibilityState === "visible") guard(autoPull)(); };
  document.addEventListener("visibilitychange", visHandler);
  window.addEventListener("focus", visHandler);
  guard(autoPull)();                                     // 시작하자마자 한 번
}

export function stopAutoSync(): void {
  running = false;
  if (pushTimer !== null) { window.clearInterval(pushTimer); pushTimer = null; }
  if (pullTimer !== null) { window.clearInterval(pullTimer); pullTimer = null; }
  if (visHandler) {
    document.removeEventListener("visibilitychange", visHandler);
    window.removeEventListener("focus", visHandler);
    visHandler = null;
  }
}

// ─── 재방문 시 silent restore ─────────────────────────────
// 모드가 "on" 이고 이전 로그인 흔적 있으면 토큰 자동 갱신 시도
export async function tryRestoreSession(): Promise<boolean> {
  if (getSyncState() !== "on") return false;
  if (!wasSignedIn()) return false;
  // 설정 화면을 열 때 부른다(사용자 제스처) → 팝업 갱신 허용. 이게 토큰을 되살리는 지점이다.
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
