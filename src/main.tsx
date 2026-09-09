import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isNativeApp } from './lib/nativeProxy'

// 앱(네이티브)에서는 서비스워커를 쓰지 않는다.
//   앱은 배포된 웹을 원격으로 불러온다(capacitor.config server.url). 그런데 그 웹에는 PWA
//   서비스워커가 붙어 있어서, 그대로 두면 앱이 옛 번들을 캐시로 붙잡는다 —
//   "웹만 배포하면 앱도 따라온다" 는 전제가 깨지고, 사용자가 강제 갱신을 눌러야만 반영된다.
//   앱은 APK 로 갱신하지 SW 로 갱신하지 않으므로, 등록된 게 있으면 지우고 캐시도 비운다.
//   (index.html 의 자동 등록 스크립트는 그대로 두고 여기서 되돌린다 — 웹 갱신 흐름은 무손상)
if (isNativeApp() && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations()
    .then(regs => Promise.all(regs.map(r => r.unregister())))
    .then(() => (typeof caches !== 'undefined'
      ? caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      : undefined))
    .catch(() => { /* 지우기 실패해도 앱 동작에는 지장 없음 */ })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
