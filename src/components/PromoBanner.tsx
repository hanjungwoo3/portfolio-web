// 제휴 광고 배너 — 개발자 초대(추천) 링크. PC·모바일 공용.
//
// 광고라는 사실은 "광고" 라벨과 rel="sponsored" 로 밝힌다.
// 닫으면 로컬에 기억해 다시 띄우지 않는다(브라우저·기기별). 새 프로모션은 ID 를 바꾸면 다시 뜬다.
// dismissible={false} 면 닫기 없이 상시 노출한다 — 후원 페이지처럼 광고가 늘 보여야 하는 자리.

import { useState } from "react";
import { X } from "lucide-react";

const PROMO_ID = "kakaopay-sec-2608";
const PROMO_URL =
  "https://kko.kakao.com/P_FTF_SEC_2608V1?invite_code=0RDS86F2RC7MA&sb=y";
const DISMISS_KEY = `promo_dismissed__${PROMO_ID}`;

function isDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; }
  catch { return false; }
}

interface Props {
  /** false 면 닫기 버튼 없이 상시 노출 (후원 페이지 등). 기본 true. */
  dismissible?: boolean;
}

export function PromoBanner({ dismissible = true }: Props = {}) {
  const [hidden, setHidden] = useState(isDismissed);
  if (dismissible && hidden) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* 시크릿 모드 등 — 이번 세션만 숨김 */ }
    setHidden(true);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg
                    bg-amber-50 border border-amber-200 text-[12px]">
      <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold
                       text-amber-800 bg-amber-200/70 border border-amber-300">
        광고
      </span>
      {/* 두 줄 — 제목 / 설명. ↗ 는 붙임공백(nbsp)으로 앞말에 묶어 혼자 다음 줄로 떨어지지 않게 한다. */}
      <a href={PROMO_URL} target="_blank" rel="noopener noreferrer sponsored"
         className="min-w-0 flex-1 leading-snug text-amber-900 hover:underline">
        <b className="text-rose-700">삼성전자 SK하이닉스 주식 무료로 받기</b>
        <span className="block text-amber-800">
          카카오페이증권에서 100% 당첨 뽑기로 제공합니다{"\u00a0"}
          <span className="text-amber-700">↗</span>
        </span>
      </a>
      {dismissible && (
        <button onClick={dismiss} title="다시 보지 않기"
                className="shrink-0 p-1 rounded text-amber-700 hover:bg-amber-200/60 transition">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
