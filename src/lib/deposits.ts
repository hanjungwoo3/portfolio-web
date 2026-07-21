// 그룹(account)별 예수금 + 구매대기 — localStorage 기반 (브라우저별).
// { [account: string]: number } 형태. 0 이하는 저장하지 않고 삭제.
// · 예수금(가용)     : portfolio_deposits
// · 구매대기(묶임)   : portfolio_pending_buys — 미체결 매수에 묶여 못 쓰는 현금(체결 전, 취소 시 예수금 복귀).
//   총자산 = 평가액 + 예수금 + 구매대기. 구매대기도 현금성이라 총자산엔 포함, 손익엔 미반영.
// export/import 동기화는 exportAll.settings.deposits / pendingBuys 로 함께 처리.

const KEY_DEPOSIT = "portfolio_deposits";
const KEY_PENDING = "portfolio_pending_buys";

function readMap(key: string): Record<string, number> {
  try {
    const v = localStorage.getItem(key);
    if (!v) return {};
    const obj: unknown = JSON.parse(v);
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAmount(key: string, account: string, amount: number): void {
  try {
    const all = readMap(key);
    if (Number.isFinite(amount) && amount > 0) all[account] = Math.round(amount);
    else delete all[account];
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* noop */
  }
}

function replaceMap(key: string, map?: Record<string, number>): void {
  try {
    if (!map || typeof map !== "object") return;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) clean[k] = Math.round(v);
    }
    localStorage.setItem(key, JSON.stringify(clean));
  } catch {
    /* noop */
  }
}

// ── 예수금(가용) ──────────────────────────────────────────────
export function getDeposits(): Record<string, number> { return readMap(KEY_DEPOSIT); }
export function getDeposit(account: string): number {
  const d = getDeposits()[account];
  return Number.isFinite(d) ? d : 0;
}
// 모든 그룹 예수금 합 — 합산(내주식) 탭용
export function getTotalDeposits(): number {
  return Object.values(getDeposits()).reduce((a, b) => a + b, 0);
}
export function setDeposit(account: string, amount: number): void { writeAmount(KEY_DEPOSIT, account, amount); }
// import 시 통째로 교체 (Drive 동기화)
export function replaceAllDeposits(map?: Record<string, number>): void { replaceMap(KEY_DEPOSIT, map); }

// ── 구매대기(미체결 매수에 묶인 현금) — 그룹별 '여러 건' 목록(수량×단가) ──────────
//   각 건 = { id, name?, qty, price }. 카드엔 총합만, 관리는 팝업에서 건별 추가/삭제.
export interface PendingBuyItem {
  id: string;
  name?: string;   // 종목명/메모 (선택)
  qty: number;
  price: number;
}

// 저장형: Record<account, PendingBuyItem[]>. 레거시 단일 number 는 1건으로 마이그레이션.
function readPendingMap(): Record<string, PendingBuyItem[]> {
  try {
    const v = localStorage.getItem(KEY_PENDING);
    if (!v) return {};
    const obj: unknown = JSON.parse(v);
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, PendingBuyItem[]> = {};
    for (const [acc, val] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) {
        out[acc] = [{ id: `legacy-${acc}`, qty: 1, price: Math.round(val) }];   // 레거시 금액 → 1건
      } else if (Array.isArray(val)) {
        const items = val
          .filter((x): x is PendingBuyItem =>
            !!x && typeof x === "object"
            && typeof (x as PendingBuyItem).qty === "number" && (x as PendingBuyItem).qty > 0
            && typeof (x as PendingBuyItem).price === "number" && (x as PendingBuyItem).price > 0)
          .map(x => ({
            id: typeof x.id === "string" ? x.id : `p-${acc}-${x.qty}-${x.price}`,
            name: typeof x.name === "string" ? x.name : undefined,
            qty: x.qty, price: Math.round(x.price),
          }));
        if (items.length) out[acc] = items;
      }
    }
    return out;
  } catch {
    return {};
  }
}
function writePendingMap(map: Record<string, PendingBuyItem[]>): void {
  try {
    const clean: Record<string, PendingBuyItem[]> = {};
    for (const [acc, items] of Object.entries(map)) {
      const valid = (items ?? []).filter(x => x && x.qty > 0 && x.price > 0);
      if (valid.length) clean[acc] = valid;
    }
    localStorage.setItem(KEY_PENDING, JSON.stringify(clean));
  } catch {
    /* noop */
  }
}
const itemAmount = (x: PendingBuyItem) => Math.round(x.qty * x.price);

export function getPendingItems(account: string): PendingBuyItem[] { return readPendingMap()[account] ?? []; }
export function setPendingItems(account: string, items: PendingBuyItem[]): void {
  const all = readPendingMap();
  if (items && items.length) all[account] = items;
  else delete all[account];
  writePendingMap(all);
}
// 그룹 구매대기 총합(수량×단가 합) — 카드 표시용. 시그니처 유지(기존 호출부 호환).
export function getPendingBuy(account: string): number {
  return getPendingItems(account).reduce((a, x) => a + itemAmount(x), 0);
}
export function getTotalPendingBuys(): number {
  return Object.values(readPendingMap()).reduce((a, items) => a + items.reduce((s, x) => s + itemAmount(x), 0), 0);
}
// 그룹 삭제/이름변경 — 예수금과 동일 인터페이스(setPendingBuy(acc,0) = 비우기, 그 외는 무시).
export function setPendingBuy(account: string, amount: number): void {
  if (!(amount > 0)) setPendingItems(account, []);   // 0 = 그룹 구매대기 전체 삭제
}
export function movePendingItems(from: string, to: string): void {
  const all = readPendingMap();
  const src = all[from];
  if (!src || !src.length) return;
  all[to] = [...(all[to] ?? []), ...src];
  delete all[from];
  writePendingMap(all);
}
// import — Record<account, PendingBuyItem[]> 통째 교체(레거시 number 도 read 에서 흡수).
export function getPendingBuys(): Record<string, PendingBuyItem[]> { return readPendingMap(); }
export function replaceAllPendingBuys(map?: Record<string, PendingBuyItem[] | number>): void {
  try {
    if (!map || typeof map !== "object") return;
    localStorage.setItem(KEY_PENDING, JSON.stringify(map));
    writePendingMap(readPendingMap());   // 정규화(레거시 흡수·검증)
  } catch {
    /* noop */
  }
}
