// info.json 의 공연·문화 항목 중 썸네일(image)이 없는 것에 포스터·표지를 채운다.
//   npm run thumbs             빠진 것만 채움
//   npm run thumbs -- --force  이미 있는 것도 다시 찾음 (실패하면 기존 값 유지)
//   npm run thumbs -- --dry-run
// 매주 자동 조사(update-info.mjs)가 새 항목에는 알아서 하므로, 이 명령은 기존 항목을 채우거나 다시 시도할 때 쓴다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dropSharedImages, enrichWithThumbnails } from './lib/thumbnail.mjs';

const INFO_PATH = new URL('../public/data/info.json', import.meta.url);
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

const info = JSON.parse(readFileSync(INFO_PATH, 'utf8'));
const before = info.items.filter((i) => i.image).length;

const stats = await enrichWithThumbnails(info.items, { force });
const dropped = dropSharedImages(info.items);
const after = info.items.filter((i) => i.image).length;

console.log(`대상 ${stats.tried}건 → 성공 ${stats.ok}건, 실패 ${stats.failed.length}건`);
for (const f of stats.failed) console.log(`  실패: ${f.title.slice(0, 28)} — ${f.reason}\n        ${f.url}`);
if (dropped) console.log(`  사이트 기본 이미지로 보여 ${dropped}건 제외 (같은 이미지가 여러 항목에 붙음)`);
console.log(`썸네일이 있는 항목: ${before} → ${after} / 전체 ${info.items.length}건`);

if (dryRun) console.log('--dry-run: info.json 을 쓰지 않았습니다.');
else {
  writeFileSync(INFO_PATH, `${JSON.stringify(info, null, 2)}\n`);
  console.log('public/data/info.json 을 갱신했습니다.');
}
