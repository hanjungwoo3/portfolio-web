// 증권사 공식 API 연결 — 웹 쪽 얇은 래퍼. 실제 키·토큰·요청은 **데스크톱 앱 네이티브**(desktop/src-tauri/src/broker.rs)만 다룬다.
//   웹(브라우저)·안드로이드에서는 아무것도 못 한다 — isBrokerAvailable() 이 false. 설정 화면은 안내만 보여 준다.
//   계획서: docs/broker-api-integration-plan.md
import { isDesktopApp } from "./nativeProxy";

export type BrokerId = "toss";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
function tauriInvoke(): Invoke | null {
  const t = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  return t?.invoke ? t.invoke.bind(t) : null;
}

/** 증권사 연결을 쓸 수 있는 환경인가 — 데스크톱 앱(맥·윈도우)만 */
export function isBrokerAvailable(): boolean {
  return isDesktopApp() && !!tauriInvoke();
}

export class BrokerError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface BrokerStatus { configured: boolean; clientIdHint: string }

export async function brokerStatus(broker: BrokerId): Promise<BrokerStatus> {
  const inv = tauriInvoke();
  if (!inv) return { configured: false, clientIdHint: "" };
  const r = await inv("broker_status", { broker }) as { configured: boolean; client_id_hint: string };
  return { configured: r.configured, clientIdHint: r.client_id_hint };
}

export async function brokerSet(broker: BrokerId, clientId: string, clientSecret: string): Promise<void> {
  const inv = tauriInvoke();
  if (!inv) throw new Error("데스크톱 앱에서만 연결할 수 있습니다");
  await inv("broker_set", { broker, clientId, clientSecret });
}

export async function brokerClear(broker: BrokerId): Promise<void> {
  const inv = tauriInvoke();
  if (!inv) return;
  await inv("broker_clear", { broker });
}

/** 조회(GET) — path 는 "/api/v1/..." (쿼리 포함). 토스 오류 envelope 는 BrokerError 로 던진다 */
export async function brokerGet<T>(broker: BrokerId, path: string, account?: string): Promise<T> {
  const inv = tauriInvoke();
  if (!inv) throw new BrokerError(0, "unavailable", "데스크톱 앱에서만 쓸 수 있습니다");
  const r = await inv("broker_fetch", { broker, path, account: account ?? null }) as { status: number; body: string };
  let json: unknown = null;
  try { json = r.body ? JSON.parse(r.body) : null; } catch { /* 본문이 JSON 이 아님 */ }
  if (r.status < 200 || r.status >= 300) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    const code = err?.code ?? (r.status === 403 ? "edge-blocked" : String(r.status));
    // 403 — 허용 IP 문제가 흔하지만 전부는 아니다 → 토스가 보낸 code·message 를 같이 보여 준다(원인을 가리지 않게)
    const detail = err ? ` [${err.code ?? ""}${err.message ? ` · ${err.message}` : ""}]` : (r.body ? ` [${r.body.slice(0, 160)}]` : "");
    const msg = r.status === 403
      ? `토스가 요청을 막았습니다(403)${detail} — 허용 IP 미등록이면 이 PC 의 공인 IP 를 등록해 주세요`
      : `${err?.message ?? `요청 실패 (${r.status})`}${err?.code ? ` [${err.code}]` : ""}`;
    throw new BrokerError(r.status, code, msg);
  }
  // 토스 성공 응답은 { result: ... } envelope
  const res = (json as { result?: T } | null)?.result;
  return (res ?? json) as T;
}

// ─── 토스 — 계좌 ───
export interface TossAccount { accountNo: string; accountSeq: number; accountType: string }

export async function fetchTossAccounts(): Promise<TossAccount[]> {
  const r = await brokerGet<TossAccount[]>("toss", "/api/v1/accounts");
  return Array.isArray(r) ? r : [];
}

// ─── 연결 상태(비밀 아님) — 켜짐 스위치·고른 계좌. 기기별(localStorage). Drive 동기화엔 넣지 않는다 ───
const KEY_ENABLED = "broker_toss_enabled";
const KEY_ACCOUNT = "broker_toss_account";   // accountSeq

export function getTossEnabled(): boolean {
  try { return localStorage.getItem(KEY_ENABLED) === "1"; } catch { return false; }
}
export function setTossEnabled(on: boolean): void {
  try { localStorage.setItem(KEY_ENABLED, on ? "1" : "0"); } catch { /* noop */ }
}
export function getTossAccountSeq(): string {
  try { return localStorage.getItem(KEY_ACCOUNT) ?? ""; } catch { return ""; }
}
export function setTossAccountSeq(seq: string): void {
  try { localStorage.setItem(KEY_ACCOUNT, seq); } catch { /* noop */ }
}
/** 연동이 실제로 쓸 수 있는 상태인가 — 앱 + 키 있음 + 스위치 켬 (키 유무는 호출 쪽에서 brokerStatus 로 확인) */
export function isTossLinkOn(): boolean {
  return isBrokerAvailable() && getTossEnabled();
}

/** 계좌번호 가리기 — 뒤 4자리만 */
export function maskAccountNo(no: string): string {
  const s = (no ?? "").replace(/\D/g, "");
  return s.length > 4 ? `${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : no;
}
