// 라니(기본 표정)로 앱 아이콘 PNG 를 만든다 → public/icons/
// SVG 를 PNG 로 바꾸는 데 헤드리스 Chrome 을 쓴다 (scripts/lib/render.mjs).
import { writeFileSync } from 'node:fs';
import { renderSvg } from './generate-rani.mjs';
import { renderImages } from './lib/render.mjs';

const OUT = new URL('../public/icons/', import.meta.url);
const BG = '#4f46e5';

// SVG(240칸) 안에서 얼굴은 가로 176칸(x 32~208), 중심은 (120, 128)
const FACE_W = 176;
const FACE_CENTER = { x: 120, y: 128 };

// face   : 얼굴 폭이 아이콘 폭에서 차지하는 비율
// rounded: 모서리를 둥글게 (일반 아이콘)
// 마스커블은 OS 가 모양을 잘라내므로 배경을 전체에 채우고, 얼굴은 중앙 안전 영역(지름 80%) 안에 둔다.
// 애플 터치 아이콘은 iOS 가 직접 둥글게 만들므로 꽉 채운 정사각형이다.
function iconHtml({ size, face, rounded }) {
  const px = (size * face * 240) / FACE_W; // SVG 전체를 그릴 한 변 길이
  const unit = px / 240;
  const left = size / 2 - FACE_CENTER.x * unit;
  const top = size / 2 - FACE_CENTER.y * unit + size * 0.02; // 눈·코가 정중앙보다 살짝 아래로
  const svg = renderSvg('neutral').replace(
    '<svg ',
    `<svg width="${px}" height="${px}" style="position:absolute;left:${left}px;top:${top}px;overflow:visible" `,
  );
  const radius = rounded ? `border-radius:${size * 0.22}px;` : '';
  return `<body style="margin:0;background:transparent"><div style="position:relative;width:${size}px;height:${size}px;overflow:hidden;background:${BG};${radius}">${svg}</div></body>`;
}

const specs = [
  ['icon-192.png', { size: 192, face: 0.7, rounded: true }],
  ['icon-512.png', { size: 512, face: 0.7, rounded: true }],
  ['icon-maskable-512.png', { size: 512, face: 0.56, rounded: false }],
  ['apple-touch-icon.png', { size: 180, face: 0.7, rounded: false }],
];

const pngs = await renderImages(specs.map(([, o]) => ({ html: iconHtml(o), width: o.size, height: o.size, format: 'png' })));
specs.forEach(([name], i) => {
  writeFileSync(new URL(name, OUT), pngs[i]);
  console.log(`public/icons/${name} (${pngs[i].length} bytes)`);
});
