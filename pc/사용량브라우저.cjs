// Supabase Usage 화면 값 가져오기(hong 11-08): 개인 토큰은 /platform 주소에서 거절(401)되므로,
// 이 PC 전용 브라우저 프로필(%USERPROFILE%\.sonik-supabase-browser)에 hong 이 한 번 로그인해 두고
// 중계가 1시간마다 그 프로필로 Usage 화면을 열어 대시보드가 받는 값(/platform/organizations/{org}/usage)을 그대로 읽는다.
// 처음 로그인·다시 로그인: 소통\사용량로그인.cmd (창이 뜨면 로그인 → 「확인됨」이 나오면 자동으로 닫힘)
// 로그인 정보는 이 프로필 폴더에만 남는다(저장소·DB 에 올리지 않음).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

const ORG = 'wpfrlcrxrglffxvxkmln';
const PROFILE = path.join(os.homedir(), '.sonik-supabase-browser');
const USAGE_URL = 'https://supabase.com/dashboard/org/' + ORG + '/usage';

// Playwright: PC 는 웹 자동검증 lib.cjs 의 것(설치된 Chrome), 없으면 일반 playwright
function browserType() {
  const lib = path.join(__dirname, '..', '웹테스트', '자동검증', 'lib.cjs');
  if (fs.existsSync(lib)) { try { return { pw: require(lib).playwright(), channel: 'chrome' }; } catch (_) { /* 아래로 */ } }
  return { pw: require('playwright'), channel: undefined };
}

const isUsage = (u) => u.includes('/platform/organizations/' + ORG + '/usage') && !/project_ref=|projectRef=/.test(u);
const isSub = (u) => u.includes('/platform/organizations/' + ORG + '/billing/subscription');

// 반환: { usage, sub } (둘 다 대시보드가 받은 JSON). 로그인 안 됨 → Error('LOGIN')
// opt.headless=false + opt.waitLoginMin: 로그인 창 모드(사용자가 로그인할 때까지 기다림)
async function fetchUsage(opt = {}) {
  const headless = opt.headless !== false;
  const { pw, channel } = browserType();
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, {
    channel, headless, viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const got = {};
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('response', async (r) => {
      const u = r.url();
      if (!r.ok() || r.request().method() !== 'GET') return;
      try {
        if (isUsage(u) && !got.usage) got.usage = await r.json();
        else if (isSub(u) && !got.sub) got.sub = await r.json();
      } catch (_) { /* 본문 못 읽음 → 무시 */ }
    });
    await page.goto(USAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const until = Date.now() + (headless ? 45000 : (opt.waitLoginMin || 10) * 60000);
    while (Date.now() < until) {
      if (got.usage && got.sub) break;
      if (page.isClosed()) break;
      const url = page.url();
      if (headless && /\/sign-in|\/sign-up|\/login/.test(url)) throw new Error('LOGIN');
      // 로그인 직후 다른 화면으로 가면 Usage 화면으로 다시 보낸다
      if (!headless && url.includes('/dashboard/') && !url.includes('/usage') && !/sign-in|login/.test(url)) {
        await page.goto(USAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    // 구독 정보는 화면에 따라 안 부를 수 있어 사용량만 있어도 된다
    if (!got.usage) throw new Error(headless && /sign-in|login/.test(page.isClosed() ? '' : page.url()) ? 'LOGIN' : 'USAGE_NOT_SEEN');
    return got;
  } finally { await ctx.close().catch(() => {}); }
}

module.exports = { fetchUsage, PROFILE, ORG, USAGE_URL };
