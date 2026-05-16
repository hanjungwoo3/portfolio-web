import { useState } from "react";

// 개발자 후원 모달 — PC + 모바일 공통.
// 카카오페이 / 계좌이체 두 옵션을 탭으로 분리 (QR 동시 노출 방지)

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "kakaopay" | "bank";

const KAKAOPAY_URL = "https://qr.kakaopay.com/FCscirjeF";
const KAKAOPAY_QR_IMG =
  `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(KAKAOPAY_URL)}`;

// 토스뱅크 계좌이체 — free4qr 페이지로 연결 (스캔/클릭 시 송금 앱 deep link).
// 계좌번호·예금주는 페이지에서 노출되므로 사이트엔 직접 표시하지 않음.
const BANK_LINK_URL =
  "https://free4qr.com/qr-result?s=portfolio-web&b=092&a=100-0422-5246&h=%ED%95%9C%EC%A0%95%EC%9A%B0";
const BANK_QR_IMG =
  `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(BANK_LINK_URL)}`;

export function DonateDialog({ isOpen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("kakaopay");
  if (!isOpen) return null;

  const tabBtn = (key: Tab, label: string) => (
    <button onClick={() => setTab(key)}
            className={`flex-1 px-3 py-2 text-sm font-medium border-b-2 transition-colors
                        ${tab === key
                          ? "border-blue-500 text-blue-700 bg-white"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                    bg-black/40 p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 text-center my-auto"
           onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">☕ 후원해주셔서 감사합니다</h2>
        <p className="text-xs text-gray-600 leading-relaxed mb-4">
          모인 후원금은 <b>Cloudflare Worker 운영비</b>,
          <br />그리고 <b>꾸준한 기능 개발·유지보수</b>에 사용됩니다.
        </p>

        {/* 탭 헤더 */}
        <div className="flex border-b border-gray-200 mb-4">
          {tabBtn("kakaopay", "💛 카카오페이")}
          {tabBtn("bank", "🏦 계좌이체")}
        </div>

        {/* ① 카카오페이 ─────────────────────────── */}
        {tab === "kakaopay" && (
          <>
            <div className="hidden sm:inline-block bg-[#FEE500] rounded-lg p-4 mb-2">
              <img src={KAKAOPAY_QR_IMG} alt="카카오페이 QR" width={200} height={200}
                   className="block mx-auto" />
            </div>
            <p className="hidden sm:block text-[11px] text-gray-500 mb-2">
              카카오톡 앱의 QR 스캔이 가장 빠릅니다 (카메라·토스 스캔도 가능)
            </p>
            <a href={KAKAOPAY_URL}
               target="_blank" rel="noopener noreferrer"
               className="block px-4 py-3 sm:py-2 rounded font-bold text-[#191919]
                          hover:brightness-95 text-base sm:text-sm"
               style={{ backgroundColor: "#FEE500" }}>
              💛 카카오페이로 후원하기
            </a>
          </>
        )}

        {/* ② 토스뱅크 계좌이체 ─────────────────────── */}
        {tab === "bank" && (
          <>
            <div className="hidden sm:inline-block bg-blue-50 rounded-lg p-4 mb-2
                            border border-blue-100">
              <img src={BANK_QR_IMG} alt="계좌이체 QR" width={200} height={200}
                   className="block mx-auto" />
            </div>
            <p className="hidden sm:block text-[11px] text-gray-500 mb-2">
              스캔 시 송금 앱으로 자동 연결됩니다 (토스·카뱅 등)
            </p>
            <a href={BANK_LINK_URL}
               target="_blank" rel="noopener noreferrer"
               className="block px-4 py-3 sm:py-2 rounded font-bold text-white
                          hover:brightness-95 text-base sm:text-sm
                          bg-blue-600 hover:bg-blue-700">
              🏦 토스 계좌로 이체하기
            </a>
          </>
        )}

        <button onClick={onClose}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700">
          닫기
        </button>
      </div>
    </div>
  );
}
