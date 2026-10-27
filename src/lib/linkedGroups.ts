// 증권사 연동 그룹 — "어느 그룹이 어느 증권사 계좌의 거울인가" 메타.
//   그룹 이름(🔗 같은 표식)에 의존하면 이름을 바꾸는 순간 깨진다 → 설정 메타로 두고 Drive 동기화에 포함한다
//   (db.exportAll settings.linkedGroups / syncManager normalize). 그래서 휴대폰도 "연동 그룹"임을 알고 읽기 전용으로 보여 줄 수 있다.
//   ★ 키·토큰은 절대 여기 두지 않는다(OS 비밀 보관함 — desktop broker.rs). 여기는 비밀 아닌 것만.
//
//   연동 그룹 규칙(사용자 결정 2026-10-26):
//   · 토스에서 가져온(sync) 보유만 잠근다(수정·삭제·매수·매도 불가) — 보유 행의 `source: "toss"` 로 구분
//   · 같은 그룹에 손으로 넣은 종목은 지금처럼 수정·삭제 가능
//   · 예수금은 토스 값(cashBuyingPower)으로 고정
//   · 갱신은 설정의 '지금 갱신' 버튼 + 자동(앱 켤 때·주기)
import type { BrokerId } from "./broker";
import { getGroupFolders, setGroupFolders } from "./groupFolders";

export interface LinkedGroupMeta {
  broker: BrokerId;
  accountSeq: string;
  lastSyncAt?: string;     // ISO — 보유·예수금 마지막 갱신
  lastTradeSyncAt?: string; // ISO — 거래 이력 마지막 증분 가져오기
  lastError?: string;      // 마지막 갱신 실패 이유(성공하면 지움)
  /** 미국 보유 평단 환산 기억 — 달러 평단·수량이 그대로면 원화 평단을 다시 환산하지 않는다(환율 따라 매일 흔들리지 않게) */
  usdAvg?: Record<string, { usd: number; qty: number; krw: number }>;
}
export type LinkedGroups = Record<string, LinkedGroupMeta>;

const KEY = "portfolio_linked_groups";
export const LINKED_GROUPS_EVENT = "linked-groups-changed";
export const DEFAULT_TOSS_GROUP = "토스";
export const DEFAULT_KIS_GROUP = "한국투자";
/** 연동 그룹을 담는 폴더 — 지수 탭 바로 오른쪽에 고정(사용자 결정 2026-10-26). 증권사별 그룹(토스·한국투자…)이 이 안에 */
export const BROKER_FOLDER = "증권사연결";

/** '증권사연결' 폴더는 자동 관리 — 연동 그룹이 폴더 밖에 있으면 넣고(없으면 폴더 생성), 수동 그룹이 들어 있으면 뺀다.
 *  들어가는 것도 나가는 것도 자동(사용자 2026-10-27: "증권사연결에서는 삭제도 자동아냐?"). 바꾼 게 있으면 true */
export function ensureLinkedGroupsInFolder(): boolean {
  const linkedSet = new Set(Object.keys(getLinkedGroups()));
  const folders = getGroupFolders();
  let changed = false;
  const bf = folders.find(f => f.name === BROKER_FOLDER);
  if (bf) {
    const kept = bf.groups.filter(g => linkedSet.has(g));
    if (kept.length !== bf.groups.length) { bf.groups = kept; changed = true; }
  }
  const inAny = new Set(folders.flatMap(f => f.groups));
  const missing = [...linkedSet].filter(g => !inAny.has(g));
  if (missing.length) {
    const target = bf ?? { name: BROKER_FOLDER, groups: [] as string[] };
    if (!bf) folders.push(target);
    target.groups = Array.from(new Set([...target.groups, ...missing]));
    changed = true;
  }
  if (changed) setGroupFolders(folders);
  return changed;
}
/** 그룹 이름이 바뀔 때 연동 메타 키도 따라간다(db.renameGroup 이 부른다) */
export function moveLinkedGroupName(oldName: string, newName: string): void {
  const all = getLinkedGroups();
  if (!(oldName in all) || oldName === newName) return;
  all[newName] = all[oldName];
  delete all[oldName];
  setLinkedGroups(all);
}

export function getLinkedGroups(): LinkedGroups {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) as unknown : null;
    return v && typeof v === "object" && !Array.isArray(v) ? v as LinkedGroups : {};
  } catch { return {}; }
}
export function setLinkedGroups(all: LinkedGroups): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
  try { window.dispatchEvent(new Event(LINKED_GROUPS_EVENT)); } catch { /* noop */ }
}
export function setLinkedGroup(group: string, meta: LinkedGroupMeta): void {
  const all = getLinkedGroups();
  all[group] = meta;
  setLinkedGroups(all);
}
export function removeLinkedGroup(group: string): void {
  const all = getLinkedGroups();
  if (group in all) { delete all[group]; setLinkedGroups(all); }
  // 연동 해제 → 이제 수동 그룹이므로 자동 관리 폴더에서도 뺀다(보유 row 는 그대로, 폴더 밖 일반 탭으로)
  const folders = getGroupFolders();
  const bf = folders.find(f => f.name === BROKER_FOLDER);
  if (bf && bf.groups.includes(group)) { bf.groups = bf.groups.filter(g => g !== group); setGroupFolders(folders); }
}
export function isLinkedGroup(group: string | null | undefined): boolean {
  return !!group && group in getLinkedGroups();
}
/** 증권사 표시 이름 — 카드·합계줄의 🔗 라벨 */
export function brokerLabel(broker: BrokerId | string | undefined): string {
  return broker === "kis" ? "한국투자" : broker === "toss" ? "토스" : "연동";
}
/** 그룹 이름으로 연동 메타 */
export function linkedGroupByName(group: string | null | undefined): LinkedGroupMeta | null {
  return group ? (getLinkedGroups()[group] ?? null) : null;
}
/** 이 증권사에 연결된 그룹(지금은 증권사당 하나) */
export function linkedGroupOf(broker: BrokerId): { group: string; meta: LinkedGroupMeta } | null {
  for (const [group, meta] of Object.entries(getLinkedGroups())) if (meta.broker === broker) return { group, meta };
  return null;
}
/** 증권사에서 가져온 보유인가 — 잠금 대상 */
export function isSyncedHolding(s: { source?: string } | null | undefined): boolean {
  return !!s?.source && s.source !== "";
}

// Drive 에서 받은 값 적용 — 형태만 가볍게 검증(비밀은 애초에 없음)
export function sanitizeLinkedGroups(v: unknown): LinkedGroups | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: LinkedGroups = {};
  for (const [g, m] of Object.entries(v as Record<string, unknown>)) {
    if (!m || typeof m !== "object") continue;
    const x = m as Partial<LinkedGroupMeta>;
    if ((x.broker !== "toss" && x.broker !== "kis") || typeof x.accountSeq !== "string") continue;
    out[g] = {
      broker: x.broker, accountSeq: x.accountSeq,
      ...(typeof x.lastSyncAt === "string" ? { lastSyncAt: x.lastSyncAt } : {}),
      ...(typeof x.lastTradeSyncAt === "string" ? { lastTradeSyncAt: x.lastTradeSyncAt } : {}),
      ...(typeof x.lastError === "string" ? { lastError: x.lastError } : {}),
      ...(x.usdAvg && typeof x.usdAvg === "object" ? { usdAvg: x.usdAvg } : {}),
    };
  }
  return out;
}
