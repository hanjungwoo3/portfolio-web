// BarTime ↔ lightweight-charts Time 변환, 그리고 한국시간 표기.
//
// ★ 분봉은 UTC 초를 그대로 쓴다. 라이브러리 기본 표시는 UTC 라서 그냥 두면 09:00 장 시작이
//   00:00 으로 보인다. 시각을 +9h 밀어 저장하면 화면은 맞지만 저장된 앵커가 거짓이 된다.
//   그래서 **데이터는 진짜 UTC 로 두고 표시 포맷터만 Asia/Seoul 로** 바꾼다.

import type { Time, UTCTimestamp } from "lightweight-charts";
import type { BarTime } from "./types";

export const toLwTime = (t: BarTime): Time =>
  t.kind === "date" ? (t.value as Time) : (t.value as UTCTimestamp);

export const fromLwTime = (t: Time): BarTime | null => {
  if (typeof t === "number") return { kind: "unix", value: t };
  if (typeof t === "string") return { kind: "date", value: t };
  if (t && typeof t === "object" && "year" in t) {
    const b = t as { year: number; month: number; day: number };
    const p = (n: number) => String(n).padStart(2, "0");
    return { kind: "date", value: `${b.year}-${p(b.month)}-${p(b.day)}` };
  }
  return null;
};

const KST = "Asia/Seoul";
const hm = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST, hour: "2-digit", minute: "2-digit", hour12: false,
});
const mdhm = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** 축 눈금 — 분봉은 HH:mm, 일봉 이상은 날짜 그대로. */
export function tickLabel(t: Time): string {
  if (typeof t === "number") return hm.format(t * 1000);
  const b = fromLwTime(t);
  return b?.kind === "date" ? b.value.slice(2) : String(t);
}

/** 툴팁 — 분봉은 MM/DD HH:mm, 일봉 이상은 YYYY-MM-DD. */
export function fullLabel(b: BarTime): string {
  if (b.kind === "unix") return mdhm.format(b.value * 1000).replace(/\. /g, "/").replace(/\.$/, "");
  return b.value;
}

export const fmtKrw = (v: number): string => `${Math.round(v).toLocaleString()}원`;
