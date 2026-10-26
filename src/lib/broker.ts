// 증권사 공식 API 연결 — 웹 쪽 얇은 래퍼. 실제 키·토큰·요청은 **데스크톱 앱 네이티브**(desktop/src-tauri/src/broker.rs)만 다룬다.
//   웹(브라우저)·안드로이드에서는 아무것도 못 한다 — isBrokerAvailable() 이 false. 설정 화면은 안내만 보여 준다.
//   계획서: docs/broker-api-integration-plan.md
import { isDesktopApp } from "./nativeProxy";

export type BrokerId = "toss" | "kis";   // kis = 한국투자증권(KIS Developers)

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

export interface BrokerStatus { configured: boolean; clientIdHint: string; mode?: KisMode }
export type KisMode = "real" | "paper";

export async function brokerStatus(broker: BrokerId): Promise<BrokerStatus> {
  const inv = tauriInvoke();
  if (!inv) return { configured: false, clientIdHint: "" };
  const r = await inv("broker_status", { broker }) as { configured: boolean; client_id_hint: string; mode?: string | null };
  return { configured: r.configured, clientIdHint: r.client_id_hint, mode: r.mode === "paper" ? "paper" : r.mode === "real" ? "real" : undefined };
}

/** 키 저장(OS 비밀 보관함). mode 는 한국투자만(실전 real / 모의 paper) */
export async function brokerSet(broker: BrokerId, clientId: string, clientSecret: string, mode?: KisMode): Promise<void> {
  const inv = tauriInvoke();
  if (!inv) throw new Error("데스크톱 앱에서만 연결할 수 있습니다");
  await inv("broker_set", { broker, clientId, clientSecret, mode: mode ?? null });
}

export async function brokerClear(broker: BrokerId): Promise<void> {
  const inv = tauriInvoke();
  if (!inv) return;
  await inv("broker_clear", { broker });
}

/** 원시 요청 — 상태·본문·(한국투자) tr_cont 응답 헤더까지. 토스는 account, 한국투자는 trId/trCont */
export async function brokerRequest(broker: BrokerId, path: string, opt: { account?: string; trId?: string; trCont?: string } = {}): Promise<{ status: number; body: string; json: unknown; trCont: string }> {
  const inv = tauriInvoke();
  if (!inv) throw new BrokerError(0, "unavailable", "데스크톱 앱에서만 쓸 수 있습니다");
  const r = await inv("broker_fetch", { broker, path, account: opt.account ?? null, trId: opt.trId ?? null, trCont: opt.trCont ?? null }) as { status: number; body: string; tr_cont?: string | null };
  let json: unknown = null;
  try { json = r.body ? JSON.parse(r.body) : null; } catch { /* 본문이 JSON 이 아님 */ }
  return { status: r.status, body: r.body, json, trCont: r.tr_cont ?? "" };
}

/** 조회(GET) — path 는 "/api/v1/..." (쿼리 포함). 토스 오류 envelope 는 BrokerError 로 던진다 */
export async function brokerGet<T>(broker: BrokerId, path: string, account?: string): Promise<T> {
  const inv = tauriInvoke();
  if (!inv) throw new BrokerError(0, "unavailable", "데스크톱 앱에서만 쓸 수 있습니다");
  const r = await inv("broker_fetch", { broker, path, account: account ?? null, trId: null, trCont: null }) as { status: number; body: string };
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

// ─── 한국투자증권(KIS) — 연결 상태(비밀 아님): 실전/모의·종합계좌번호(8)·상품코드(2)·켜짐. 기기별(localStorage) ───
//   공식 예제: github.com/koreainvestment/open-trading-api (examples_llm). 응답은 { rt_cd:"0", msg_cd, msg1, output|output1|output2 },
//   업무 오류는 HTTP 200 에 rt_cd "1" 로도 온다 → kisGet 이 걸러 BrokerError 로. 이어받기는 응답 헤더 tr_cont "F"/"M" + ctx_area_*.
const KEY_KIS_ENABLED = "broker_kis_enabled";
const KEY_KIS_CANO = "broker_kis_cano";
const KEY_KIS_PRDT = "broker_kis_prdt";
const KEY_KIS_MODE = "broker_kis_mode";
export function getKisEnabled(): boolean { try { return localStorage.getItem(KEY_KIS_ENABLED) === "1"; } catch { return false; } }
export function setKisEnabled(on: boolean): void { try { localStorage.setItem(KEY_KIS_ENABLED, on ? "1" : "0"); } catch { /* noop */ } }
export function getKisAccount(): { cano: string; prdt: string } {
  try { return { cano: localStorage.getItem(KEY_KIS_CANO) ?? "", prdt: localStorage.getItem(KEY_KIS_PRDT) ?? "01" }; } catch { return { cano: "", prdt: "01" }; }
}
export function setKisAccount(cano: string, prdt: string): void {
  try { localStorage.setItem(KEY_KIS_CANO, cano.replace(/\D/g, "").slice(0, 8)); localStorage.setItem(KEY_KIS_PRDT, (prdt.replace(/\D/g, "") || "01").slice(0, 2).padStart(2, "0")); } catch { /* noop */ }
}
export function getKisMode(): KisMode { try { return localStorage.getItem(KEY_KIS_MODE) === "paper" ? "paper" : "real"; } catch { return "real"; } }
export function setKisMode(m: KisMode): void { try { localStorage.setItem(KEY_KIS_MODE, m); } catch { /* noop */ } }
export function isKisLinkOn(): boolean { return isBrokerAvailable() && getKisEnabled(); }
/** 모의투자면 tr_id 첫 글자를 V 로(공식 kis_auth 규칙: T·J·C 로 시작하는 실전 tr_id) */
export function kisTrId(real: string): string {
  return getKisMode() === "paper" && /^[TJC]/.test(real) ? `V${real.slice(1)}` : real;
}

interface KisEnvelope { rt_cd?: string; msg_cd?: string; msg1?: string }
/** 한국투자 GET — params 는 쿼리로, trId 는 실전 기준(모의면 자동 V). 업무 오류(rt_cd≠0)도 BrokerError */
export async function kisGet<T extends KisEnvelope>(path: string, trIdReal: string, params: Record<string, string>, trCont = ""): Promise<{ body: T; trCont: string }> {
  const q = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const r = await brokerRequest("kis", `${path}?${q}`, { trId: kisTrId(trIdReal), trCont });
  const env = (r.json ?? {}) as KisEnvelope;
  if (r.status < 200 || r.status >= 300 || (env.rt_cd && env.rt_cd !== "0")) {
    const code = env.msg_cd ?? String(r.status);
    const msg = env.msg1?.trim() || (r.body ? r.body.slice(0, 160) : `요청 실패 (${r.status})`);
    throw new BrokerError(r.status, code, `한국투자: ${msg} [${code}]`);
  }
  return { body: r.json as T, trCont: r.trCont };
}
