import { useEffect } from "react";

// ESC 키 → onClose 호출 hook. isOpen 일 때만 keydown listener 등록.
// 다이얼로그/모달 컴포넌트에서 일관된 ESC 닫기 UX 제공.
export function useEscClose(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);
}
