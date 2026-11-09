// VAPID 키 쌍을 만들고 public/config.json 에 공개키를 넣는다.
// 비공개키는 저장소에 커밋하지 않고 .vapid.local.json 에만 저장한다 (gitignore 됨).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateVAPIDKeys } from 'web-push';

const LOCAL = new URL('../.vapid.local.json', import.meta.url);
const CONFIG = new URL('../public/config.json', import.meta.url);

if (existsSync(LOCAL) && !process.argv.includes('--force')) {
  console.error('.vapid.local.json 이 이미 있습니다. 새로 만들면 기존 구독이 모두 무효가 됩니다.');
  console.error('정말 새로 만들려면: npm run vapid -- --force');
  process.exit(1);
}

const keys = generateVAPIDKeys();
writeFileSync(LOCAL, `${JSON.stringify(keys, null, 2)}\n`);

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
config.vapidPublicKey = keys.publicKey;
writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

console.log('public/config.json 에 공개키를 넣었습니다 (커밋해도 됩니다).');
console.log('\nGitHub 저장소 Settings > Secrets and variables > Actions 에 아래 Secret 을 등록하세요:');
console.log(`  VAPID_PUBLIC_KEY  = ${keys.publicKey}`);
console.log(`  VAPID_PRIVATE_KEY = ${keys.privateKey}`);
console.log('\n비공개키는 .vapid.local.json 에도 저장되어 있습니다 (커밋 금지).');
