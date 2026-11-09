// 헤드리스 Chrome(DevTools Protocol)으로 HTML 을 이미지로 그린다. 외부 이미지 라이브러리 없이 사진 자르기·아이콘 합성에 쓴다.
// 페이지를 임시 파일로 저장해 file:// 로 열기 때문에, HTML 안에서 file:// 사진을 <img> 로 불러올 수 있다.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME_CANDIDATES = [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(port, profile) {
  for (const bin of CHROME_CANDIDATES) {
    const child = spawn(
      bin,
      ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
      { stdio: 'ignore' },
    );
    let spawnFailed = false;
    child.on('error', () => (spawnFailed = true));
    for (let i = 0; i < 40 && !spawnFailed; i++) {
      try {
        const targets = await (await fetch(`http://localhost:${port}/json`)).json();
        const page = targets.find((t) => t.type === 'page');
        if (page) return { child, wsUrl: page.webSocketDebuggerUrl };
      } catch {
        await sleep(250);
      }
    }
    child.kill();
  }
  throw new Error('Chrome 을 찾지 못했습니다. google-chrome 또는 chromium 을 설치하거나 CHROME_BIN 환경변수로 경로를 알려주세요.');
}

/**
 * @param {{ html: string, width: number, height: number, format?: 'png'|'jpeg', quality?: number }[]} jobs
 * @returns {Promise<Buffer[]>} png 는 투명 배경을 유지한다
 */
export async function renderImages(jobs, { port = 9444 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'render-'));
  const profile = join(root, 'profile');
  const { child, wsUrl } = await launch(port, profile);
  try {
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)));
        ws.send(JSON.stringify({ id: i, method, params }));
      });

    await send('Page.enable');
    const out = [];
    for (const [n, { html, width, height, format = 'png', quality = 88 }] of jobs.entries()) {
      const file = join(root, `job-${n}.html`);
      writeFileSync(file, html);
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      await send('Page.navigate', { url: pathToFileURL(file).href });
      await sleep(300);
      // 페이지가 다 열리고 모든 이미지가 디코딩될 때까지 기다린다
      const ready = await send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `new Promise((res) => {
          const go = () => Promise.all([...document.images].map((i) => i.decode().then(() => true, () => false))).then((r) => res(r.every(Boolean)));
          document.readyState === 'complete' ? go() : addEventListener('load', go);
        })`,
      });
      if (ready.result?.value !== true) throw new Error(`job ${n}: 이미지를 불러오지 못했습니다 (경로 확인)`);
      const shot = await send('Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
        clip: { x: 0, y: 0, width, height, scale: 1 },
        fromSurface: true,
      });
      out.push(Buffer.from(shot.data, 'base64'));
    }
    ws.close();
    return out;
  } finally {
    // Chrome 이 완전히 끝난 뒤에 임시 폴더를 지운다 (아직 쓰는 중이면 ENOTEMPTY)
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await Promise.race([exited, sleep(3000)]);
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
