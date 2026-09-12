// undo/redo — 스냅샷 방식.
//
// 명령(command) 방식보다 스냅샷이 맞다고 봤다. 그리기 목록은 수십 개 규모라 통째로
//   복사해도 싸고, "드래그 한 번 = 이력 한 건"(사양서 §5.6) 같은 묶음을 호출부가
//   시작/끝만 정해주면 되기 때문이다. 명령 방식이면 이동·삭제·일괄삭제마다 역연산을
//   따로 만들어야 하고, 그 역연산이 틀리면 조용히 어긋난다.

import type { Drawing } from "./types";

const LIMIT = 100;

export class DrawingHistory {
  private past: Drawing[][] = [];
  private future: Drawing[][] = [];

  private current: Drawing[];
  constructor(initial: Drawing[] = []) { this.current = initial; }

  get value(): Drawing[] { return this.current; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /** 되돌릴 수 있는 변경 한 건. */
  commit(next: Drawing[]): void {
    this.past.push(this.current);
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
    this.current = next;
  }

  /** 이력에 남기지 않는 갱신(종목·주기 전환으로 목록을 새로 읽을 때). */
  reset(next: Drawing[]): void {
    this.past = [];
    this.future = [];
    this.current = next;
  }

  undo(): Drawing[] {
    const prev = this.past.pop();
    if (!prev) return this.current;
    this.future.push(this.current);
    this.current = prev;
    return this.current;
  }

  redo(): Drawing[] {
    const next = this.future.pop();
    if (!next) return this.current;
    this.past.push(this.current);
    this.current = next;
    return this.current;
  }
}
