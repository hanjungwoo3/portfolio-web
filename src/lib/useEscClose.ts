import { useEffect, useId, useRef } from "react";

// ESC 키 → onClose 호출 hook. isOpen 일 때만 keydown listener 등록.
//
// ★ 겹쳐 뜬 모달은 **맨 위 것만** 닫는다. 열린 순서를 스택으로 들고 마지막 것만 반응한다.
//   (예전엔 열린 모달 전부가 리스너를 달아 Esc 한 번에 다 닫혔고, 먼저 등록된 쪽이 먼저
//    불려서 위가 아니라 아래 모달이 닫혔다.)
//
// ★ 스택 등록을 onClose 와 분리한다. 호출부는 보통 `onClose={() => setX(null)}` 처럼
//   인라인 함수를 넘기는데, 그러면 부모가 리렌더될 때마다 effect 가 다시 돌아 그 모달이
//   스택 맨 위로 올라간다. 실제로 종목을 두세 번 여닫으면 **뒤에 있던 팝업이 위로 튀어
//   먼저 닫혔다.** 그래서 등록은 [isOpen] 에만 걸고, 콜백은 ref 로 최신값을 읽는다.
const stack: string[] = [];

export function useEscClose(isOpen: boolean, onClose: () => void): void {
  const id = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!isOpen) return;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stack[stack.length - 1] !== id) return;   // 내 위에 다른 모달이 있다
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [isOpen, id]);
}
