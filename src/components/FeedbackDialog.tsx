import { useEffect, useRef } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// 기능 요청 / 건의사항 게시판 — Padlet 임베드 모달.
// 사용자 가입 없이 익명 글쓰기 가능 (Padlet 보드 설정에서 visitor write 허용).
const PADLET_EMBED_URL = "https://padlet.com/embed/1ic66ugihbh8segk";
const PADLET_OPEN_URL = "https://padlet.com/hanjungwoo/padlet-1ic66ugihbh8segk";

export function FeedbackDialog({ isOpen, onClose }: Props) {
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) downOnBackdropRef.current = true; }}
      onMouseUp={e => {
        if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
        downOnBackdropRef.current = false;
      }}
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center
                 justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-4xl h-full sm:h-[85vh]
                      rounded-none sm:rounded-lg shadow-xl flex flex-col">
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
          <h2 className="text-base font-bold">💡 기능 요청 / 건의사항</h2>
          <span className="text-[11px] text-gray-500 truncate">
            가입 없이 익명으로 의견 남기기
          </span>
          <a href={PADLET_OPEN_URL}
             target="_blank" rel="noopener noreferrer"
             title="새 탭에서 Padlet 열기"
             className="ml-auto inline-flex items-center gap-1 px-2 py-1
                        border border-blue-200 rounded
                        text-[11px] text-blue-700 bg-blue-50/50
                        hover:bg-blue-100/70">
            새 탭으로 열기 ↗
          </a>
          <button onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        <div className="flex-1 relative">
          <iframe
            src={PADLET_EMBED_URL}
            title="기능 요청 / 건의사항"
            className="absolute inset-0 w-full h-full border-0"
            allow="camera; microphone; geolocation; display-capture; clipboard-write"
            loading="lazy" />
        </div>
      </div>
    </div>
  );
}
