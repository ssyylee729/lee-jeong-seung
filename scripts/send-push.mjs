// 이번 주 정보를 요약해서 모든 구독자에게 웹 푸시를 보낸다.
// GitHub Actions 에서 실행되며, 필요한 값은 환경변수로 받는다:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT(선택)
//   PUSH_SUBSCRIPTIONS  구독 JSON 배열 (문자열)
//   SITE_URL            알림을 눌렀을 때 열 앱 주소
// 로컬 테스트: npm run notify -- --dry-run
import { existsSync, readFileSync } from 'node:fs';
import * as webpush from 'web-push';
import { buildPush } from '../public/lib/briefing.js';

const dryRun = process.argv.includes('--dry-run');
// 테스트용: --now=2026-11-09T09:00+09:00 로 기준 시각을 바꿀 수 있다
const nowArg = process.argv.find((a) => a.startsWith('--now='));
const now = nowArg ? new Date(nowArg.slice('--now='.length)) : new Date();

function fail(msg) {
  console.error(`오류: ${msg}`);
  process.exit(1);
}

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

function loadSubscriptions() {
  let raw = process.env.PUSH_SUBSCRIPTIONS;
  if (!raw && existsSync(new URL('../.subscriptions.local.json', import.meta.url))) {
    raw = readFileSync(new URL('../.subscriptions.local.json', import.meta.url), 'utf8');
  }
  if (!raw) fail('PUSH_SUBSCRIPTIONS 가 비어 있습니다. 구독 정보를 Secret 에 등록하세요.');

  let subs;
  try {
    subs = JSON.parse(raw);
  } catch {
    fail('PUSH_SUBSCRIPTIONS 가 올바른 JSON 이 아닙니다.');
  }
  if (!Array.isArray(subs)) fail('PUSH_SUBSCRIPTIONS 는 JSON 배열이어야 합니다. 예: [{...}, {...}]');
  return subs;
}

if (Number.isNaN(now.getTime())) fail('--now 값이 올바른 날짜가 아닙니다.');

const message = buildPush({
  info: readJson('../public/data/info.json'),
  diet: readJson('../public/data/diet.json'),
  now,
  siteUrl: process.env.SITE_URL || './',
});

console.log(`[${message.title}]\n${message.body}\n`);

if (dryRun) {
  console.log('--dry-run: 발송하지 않습니다.');
  process.exit(0);
}

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) fail('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 가 필요합니다.');
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const subs = loadSubscriptions();
const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url });

let failed = 0;
for (const [idx, sub] of subs.entries()) {
  // endpoint 에는 기기 토큰이 들어 있으므로 로그에는 호스트만 남긴다
  const host = (() => { try { return new URL(sub.endpoint).host; } catch { return '알 수 없음'; } })();
  try {
    const res = await webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24 });
    console.log(`#${idx + 1} (${host}) 발송 완료 [${res.statusCode}]`);
  } catch (err) {
    failed += 1;
    const gone = err.statusCode === 404 || err.statusCode === 410;
    console.error(
      `#${idx + 1} (${host}) 실패 [${err.statusCode ?? err.message}]` +
        (gone ? ' — 구독이 만료됐습니다. 해당 기기에서 알림을 다시 켜고 Secret 을 갱신하세요.' : ''),
    );
  }
}

if (failed) process.exit(1);
