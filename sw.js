// 홈 화면 앱(PWA) 설치용. 아무것도 저장(캐시)하지 않는다: 화면·데이터는 늘 서버에서 새로 받는다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
