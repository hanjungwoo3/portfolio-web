// 토스증권 WTS 점검 감지 — fetchTossPrices 가 HTTP 490 / unavailable.agency 를 받으면
// 점검 상태로 표시하고, App 에서 배너 + 폴링 백오프에 사용.
import { useEffect, useState } from "react";

export interface TossMaintenance {
  active: boolean;
  until?: string;     // "2026-05-24 07:30:00.000" 형태
  message?: string;
  naverWorking?: boolean;       // 네이버 fallback 으로 시세 표시 중
  needsWorkerUpdate?: boolean;  // 네이버 우회하려면 워커 업데이트 필요 (polling.finance.naver.com 미허용)
}

let state: TossMaintenance = { active: false };
const listeners = new Set<(s: TossMaintenance) => void>();

export function setTossMaintenance(next: TossMaintenance | null): void {
  const v = next ?? { active: false };
  if (v.active === state.active && v.until === state.until
      && v.naverWorking === state.naverWorking
      && v.needsWorkerUpdate === state.needsWorkerUpdate) { state = v; return; }
  state = v;
  listeners.forEach(fn => fn(state));
}

// 네이버 fallback 결과 반영 (점검 상태는 유지)
export function setNaverFallback(working: boolean, needsWorkerUpdate = false): void {
  if (!state.active) return;
  setTossMaintenance({ ...state, naverWorking: working, needsWorkerUpdate });
}

export function getTossMaintenance(): TossMaintenance {
  return state;
}

// 점검 응답(JSON) 파싱 — 맞으면 정보 반환, 아니면 null
export function parseTossMaintenance(body: unknown): TossMaintenance | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: { code?: string; message?: string; data?: { until?: string } } }).error;
  if (!err || err.code !== "unavailable.agency") return null;
  return { active: true, until: err.data?.until, message: err.message };
}

export function subscribeTossMaintenance(fn: (s: TossMaintenance) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

export function useTossMaintenance(): TossMaintenance {
  const [s, setS] = useState(state);
  useEffect(() => subscribeTossMaintenance(setS), []);
  return s;
}

// "2026-05-24 07:30:00.000" → "5/24 07:30"
export function fmtUntil(until?: string): string {
  if (!until) return "";
  const m = until.match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return until;
  return `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}`;
}
