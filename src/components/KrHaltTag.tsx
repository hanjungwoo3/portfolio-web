// 지수 탭 한국 종목 카드의 '거래정지' 책갈피 — 시장경보 목록(크롤러)엔 투자주의·경고·위험만 있어 정지는 안 떴다(사용자 2026-10-27).
//   KrDaySparkline 이 이미 받는 토스 5분봉으로 판단(추가 호출 0): 이틀 내내 체결 0 이면 fetchKrDayCandles 가 halted.
//   같은 쿼리 키를 enabled:false 로 구독만 한다 — 24시간 그래프가 켜져 있을 때(그래프가 받았을 때)만 뜬다.
import { useQuery } from "@tanstack/react-query";
import { fetchKrDayCandles } from "../lib/api";

export function KrHaltTag({ code }: { code: string }) {
  const { data } = useQuery({ queryKey: ["kr-day-candles", code], queryFn: () => fetchKrDayCandles(code), enabled: false });
  if (!data?.halted) return null;
  return (
    <span title="최근 이틀 동안 체결이 없습니다 — 거래정지(매매거래정지) 중일 수 있어요"
          className="px-1.5 py-0 rounded text-[10px] font-bold leading-tight border text-white bg-gray-500 border-gray-600">
      거래정지
    </span>
  );
}
