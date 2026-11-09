// 외부 이미지 도구 없이 앱 아이콘(PNG)을 직접 그려서 public/icons 에 저장한다.
// 디자인: 보라색 배경 + 흰색 달력 + 강조 점. 나중에 원하는 이미지로 교체해도 된다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [79, 70, 229];
const WHITE = [255, 255, 255];
const ACCENT = [251, 191, 36];

// 중심 (cx, cy), 반폭/반높이 (hw, hh), 모서리 반지름 r 의 둥근 사각형 안인가
function inRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  if (dx <= 0 || dy <= 0) return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh;
  return dx * dx + dy * dy <= r * r;
}

// scale: 달력 그림 크기 비율 (maskable 은 안전 영역 때문에 작게)
function colorAt(u, v, scale, rounded) {
  // u, v 는 0..1
  if (rounded && !inRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22)) return null;

  const s = (n) => 0.5 + (n - 0.5) * scale;
  const calHw = 0.31 * scale;
  const calHh = 0.28 * scale;
  const calCy = s(0.54);
  const inCalendar = inRoundRect(u, v, 0.5, calCy, calHw, calHh, 0.06 * scale);

  if (!inCalendar) {
    // 달력 위쪽 고리 두 개
    for (const rx of [0.5 - 0.15 * scale, 0.5 + 0.15 * scale]) {
      if (inRoundRect(u, v, rx, calCy - calHh, 0.02 * scale, 0.05 * scale, 0.02 * scale)) return WHITE;
    }
    return BG;
  }

  // 달력 윗부분 띠는 배경색(구분선 효과), 아래는 흰색
  const bandBottom = calCy - calHh + 0.1 * scale;
  if (v < bandBottom) return WHITE;
  if (v < bandBottom + 0.018 * scale) return BG;

  // 강조 점 (이번 주 표시)
  const dotCx = 0.5 + 0.1 * scale;
  const dotCy = calCy + 0.09 * scale;
  if ((u - dotCx) ** 2 + (v - dotCy) ** 2 <= (0.07 * scale) ** 2) return ACCENT;

  return WHITE;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, { scale = 1, rounded = false } = {}) {
  const SS = 3; // 3x3 슈퍼샘플링으로 가장자리를 부드럽게
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // 첫 바이트는 필터 타입(0)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, scale, rounded);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const o = 1 + x * 4;
      if (a) {
        row[o] = Math.round(r / a);
        row[o + 1] = Math.round(g / a);
        row[o + 2] = Math.round(b / a);
      }
      row[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'icon-192.png': png(192, { rounded: true }),
  'icon-512.png': png(512, { rounded: true }),
  // maskable 은 OS 가 모양을 잘라내므로 전체를 채우고 그림은 안쪽 80% 안에 둔다
  'icon-maskable-512.png': png(512, { scale: 0.8 }),
  // iOS 는 투명 배경을 검게 채우므로 꽉 채운 정사각형을 쓴다
  'apple-touch-icon.png': png(180),
};

for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), data);
  console.log(`public/icons/${name} (${data.length} bytes)`);
}
