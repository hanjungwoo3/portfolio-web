// 거래원 순간 매매 — 한투 실시간 거래원(회원사)의 창구별 **누적 수량 차이**로 "몇 시 몇 분, 어느 창구가 몇 주 샀나"를 쌓는다
//   (HTS [0127] 거래원 순간거래량처럼, 사용자 2026-11-10). 앱 + 한국투자 연동만. 시각은 받은 때(필드에 시각이 없다).
//   상위 5 창구만 오므로 5위 밖으로 밀린 창구의 매매는 못 본다. 오늘치는 localStorage 에(날짜 바뀌면 버림).
import { subscribeKisMembers, kisWsAvailable, type KisMembers } from "./kisWs";

export interface MemberTick { t: string; name: string; side: "BUY" | "SELL"; qty: number; cum: number; foreign: boolean }
interface Box { date: string; last: Record<string, number>; ticks: MemberTick[]; glob?: { buy: number; sell: number; net: number } }

const kst = () => new Date(Date.now() + 9 * 3600_000).toISOString();
const key = (code: string) => `kis_member_flow_${code}`;
const boxes = new Map<string, Box>();
const listeners = new Map<string, Set<() => void>>();

function box(code: string): Box {
  const today = kst().slice(0, 10);
  let b = boxes.get(code);
  if (b && b.date === today) return b;
  try { const v = JSON.parse(localStorage.getItem(key(code)) ?? "null") as Box | null; if (v && v.date === today) b = v; else b = undefined; } catch { b = undefined; }
  b ??= { date: today, last: {}, ticks: [] };
  boxes.set(code, b);
  return b;
}
let saveT: Record<string, ReturnType<typeof setTimeout>> = {};
function save(code: string) {
  clearTimeout(saveT[code]);
  saveT[code] = setTimeout(() => { try { localStorage.setItem(key(code), JSON.stringify(box(code))); } catch { /* 용량 — 화면은 그대로 */ } }, 1500);
}

export function ingestMembers(code: string, m: KisMembers) {
  const b = box(code), t = kst().slice(11, 19);
  let changed = false;
  for (const [sideArr, side] of [[m.buy, "BUY"], [m.sell, "SELL"]] as const) {
    for (const x of sideArr) {
      const k = `${side}|${x.name}`;
      const prev = b.last[k];
      b.last[k] = x.qty;
      if (prev != null && x.qty > prev) {   // 처음 본 값은 기준만(그 전까지 쌓인 걸 한 번에 '순간'으로 세지 않게)
        b.ticks.unshift({ t, name: x.name, side, qty: x.qty - prev, cum: x.qty, foreign: x.foreign });
        changed = true;
      }
    }
  }
  b.glob = { buy: m.globBuy, sell: m.globSell, net: m.globNet };
  b.ticks = b.ticks.slice(0, 400);
  save(code);
  void changed;
  listeners.get(code)?.forEach(f => f());   // 외국계 합계도 바뀌므로 늘 알린다
}

export function memberFlow(code: string): Box { return box(code); }
export function onMemberFlow(code: string, f: () => void): () => void {
  (listeners.get(code) ?? listeners.set(code, new Set()).get(code)!).add(f);
  return () => { listeners.get(code)?.delete(f); };
}
/** 화면이 켜져 있는 동안 구독(배경 수집 종목은 이미 받고 있어 중복 구독돼도 같은 통에 한 번씩만 반영 — 누적 차이라 두 번 와도 0) */
export function watchMembers(code: string): () => void {
  return subscribeKisMembers(code, m => ingestMembers(code, m));
}
export const memberFlowAvailable = kisWsAvailable;
