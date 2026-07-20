import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * dist/ 를 서빙하는 최소 정적 서버.
 *
 * 의존성이 없어서 Railway에서 설치 실패로 배포가 깨질 일이 없다.
 * 나중에 멀티플레이 서버가 필요해지면 이 파일을 확장하는 지점이 된다.
 */

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  // 쿼리스트링 제거 + 상위 경로 탈출 차단
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (path.includes('..')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const file = join(ROOT, path === '/' ? 'index.html' : path);

  try {
    const body = await readFile(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    // 해시가 붙은 에셋은 오래 캐시해도 안전하고, index.html은 그러면 안 된다
    const cache = file.includes('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache }).end(body);
  } catch {
    // SPA는 아니지만 오타 경로에서 흰 화면 대신 앱이 뜨게 한다
    const fallback = await readFile(join(ROOT, 'index.html')).catch(() => null);
    if (fallback) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(fallback);
    } else {
      res.writeHead(404).end('Not found');
    }
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`serving dist/ on http://0.0.0.0:${PORT}`);
});
