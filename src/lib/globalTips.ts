// 앱 전체 마우스 설명 — 브라우저 기본 툴팁(title)을 흰 레이어로 바꾼다(사용자 2026-11-04 "hover 시 메시지는 레이어로 다 변경").
//   기본 툴팁은 1초쯤 늦게, 작은 회색으로 떠 읽기 어렵다. 요소마다 고치면 수백 곳이라 한 곳에서:
//   마우스가 title 이 있는 요소에 들어가면 title 을 data-tip 으로 옮겨(기본 툴팁 끔) 레이어를 띄우고, 나가면 되돌린다.
//   첫 줄은 굵게. 화면 밖이면 위로. 터치(모바일)는 건드리지 않는다.
let box: HTMLDivElement | null = null;
let cur: HTMLElement | null = null;

function show(el: HTMLElement, text: string) {
  if (!box) {
    box = document.createElement("div");
    box.className = "fixed z-[2000] rounded-lg border border-gray-300 bg-white shadow-xl px-2 py-1.5 text-[11px] leading-snug text-gray-600 pointer-events-none pg-card";
    box.style.maxWidth = "340px";
    document.body.appendChild(box);
  }
  const [head, ...rest] = text.split("\n");
  box.replaceChildren();
  const h = document.createElement("div"); h.className = "font-bold text-[12px] text-gray-800"; h.textContent = head; box.appendChild(h);
  for (const l of rest) { const d = document.createElement("div"); d.textContent = l; box.appendChild(d); }
  box.style.display = "block";
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8));
  const top = r.bottom + 4 + b.height > window.innerHeight ? Math.max(8, r.top - b.height - 4) : r.bottom + 4;
  box.style.left = `${left}px`; box.style.top = `${top}px`;
}
function hide() {
  if (cur && cur.dataset.tip != null) { cur.setAttribute("title", cur.dataset.tip); delete cur.dataset.tip; }
  cur = null;
  if (box) box.style.display = "none";
}

export function startGlobalTips(): void {
  if (typeof window === "undefined" || !window.matchMedia?.("(hover: hover)").matches) return;
  document.addEventListener("mouseover", e => {
    const el = (e.target as Element | null)?.closest?.("[title]") as HTMLElement | null;
    if (el === cur) return;
    hide();
    if (!el) return;
    const t = el.getAttribute("title");
    if (!t || !t.trim()) return;
    cur = el; el.dataset.tip = t; el.removeAttribute("title");
    show(el, t);
  }, true);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("blur", hide);
}
