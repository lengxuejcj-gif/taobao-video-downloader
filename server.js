const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFile} = require('child_process');
const {URL} = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_SAVE_DIR = path.resolve(process.env.STORAGE_ROOT || path.join(ROOT, 'outputs', 'taobao-videos'));
const METADATA_FILE = path.join(DEFAULT_SAVE_DIR, '.video-metadata.json');
const PORT = Number(process.env.PORT || 4177);
const HOST = process.env.HOST || '127.0.0.1';
const ALLOW_CUSTOM_SAVE_DIR = process.env.ALLOW_CUSTOM_SAVE_DIR === 'true';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_COOKIE = 'taobao_video_auth=ok';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 aweme/30.0.0';
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  return String(req.headers.cookie || '').split(';').map((item) => item.trim()).includes(AUTH_COOKIE);
}

function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  sendJson(res, 401, {error: '请先登录'});
  return false;
}

function sanitizeName(value) {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`;\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 120) || `taobao-video-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value, max = 300) {
  return String(value || '').replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanGroupName(value) {
  return cleanText(value, 80);
}

function normalizeMetadata(raw = {}) {
  const groups = Array.isArray(raw.groups) && raw.groups.length ? raw.groups : [{id: 'default', name: '未分组'}];
  if (!groups.some((group) => group.id === 'default')) {
    groups.unshift({id: 'default', name: '未分组'});
  }
  return {
    groups: groups.map((group) => ({
      id: String(group.id || makeId('group')),
      name: cleanGroupName(group.name) || '未分组',
    })),
    videos: raw.videos && typeof raw.videos === 'object' ? raw.videos : {},
  };
}

function readMetadata() {
  try {
    return normalizeMetadata(JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8')));
  } catch {
    return normalizeMetadata();
  }
}

function writeMetadata(metadata) {
  fs.mkdirSync(DEFAULT_SAVE_DIR, {recursive: true});
  fs.writeFileSync(METADATA_FILE, JSON.stringify(normalizeMetadata(metadata), null, 2));
}

function ensureGroup(metadata, groupId) {
  if (groupId && metadata.groups.some((group) => group.id === groupId)) return groupId;
  return 'default';
}

function resolveSaveDir(dir) {
  if (!ALLOW_CUSTOM_SAVE_DIR) {
    if (!cleanText(dir)) return DEFAULT_SAVE_DIR;
    const subdir = sanitizeName(dir);
    const resolved = subdir ? path.join(DEFAULT_SAVE_DIR, subdir) : DEFAULT_SAVE_DIR;
    return resolved;
  }
  const resolved = path.resolve(dir || DEFAULT_SAVE_DIR);
  return resolved;
}

function extractFirstHttpUrl(value) {
  const match = String(value || '').match(/https?:\/\/[^\s"'<>，。！？、]+/i);
  if (!match) return '';
  return match[0].replace(/[)\]}.,;!?。！？、，]+$/g, '');
}

function getPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('douyin.com') || host.includes('iesdouyin.com') || host.includes('amemv.com')) return 'douyin';
    if (host.includes('taobao.com') || host.includes('tmall.com') || host.includes('alicdn.com') || host.includes('cloudvideocdn')) return 'taobao';
  } catch {}
  return 'direct';
}

function isDirectVideoUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    return (
      ['.mp4', '.mov', '.m4v', '.webm'].includes(path.extname(pathname)) ||
      ((host.includes('cloudvideocdn') || host.includes('alicdn.com')) && /mp4|video|play/.test(pathname))
    );
  } catch {}
  return false;
}

function uniquePath(dir, baseName, ext) {
  let filePath = path.join(dir, `${baseName}${ext}`);
  let counter = 2;
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${baseName}-${counter}${ext}`);
    counter += 1;
  }
  return filePath;
}

function isVideoFile(filePath) {
  return ['.mp4', '.mov', '.m4v', '.webm'].includes(path.extname(filePath).toLowerCase());
}

function getRelativeVideoPath(filePath) {
  const relative = path.relative(DEFAULT_SAVE_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('文件不在视频库目录中');
  }
  return relative;
}

function resolveVideoPath(relativePath) {
  const resolved = path.resolve(DEFAULT_SAVE_DIR, relativePath || '');
  if (resolved !== DEFAULT_SAVE_DIR && !resolved.startsWith(`${DEFAULT_SAVE_DIR}${path.sep}`)) {
    throw new Error('视频路径不合法');
  }
  if (!isVideoFile(resolved)) {
    throw new Error('只允许访问视频文件');
  }
  return resolved;
}

function videoTitleFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/-\d+$/, '');
}

function listVideoFiles(dir = DEFAULT_SAVE_DIR, bucket = []) {
  const metadata = readMetadata();
  if (!fs.existsSync(dir)) return bucket;
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listVideoFiles(fullPath, bucket);
      continue;
    }
    if (!entry.isFile() || !isVideoFile(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    const relativePath = getRelativeVideoPath(fullPath);
    const itemMeta = metadata.videos[relativePath] || {};
    const groupId = ensureGroup(metadata, itemMeta.groupId);
    const group = metadata.groups.find((entry) => entry.id === groupId);
    bucket.push({
      id: Buffer.from(relativePath).toString('base64url'),
      title: itemMeta.title || videoTitleFromPath(fullPath),
      fileName: path.basename(fullPath),
      relativePath,
      folder: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
      previewUrl: `/media?file=${encodeURIComponent(relativePath)}`,
      downloadUrl: `/download?file=${encodeURIComponent(relativePath)}`,
      productPrice: itemMeta.productPrice || '',
      productLink: itemMeta.productLink || '',
      shopName: itemMeta.shopName || '',
      platform: itemMeta.platform || '',
      sourceUrl: itemMeta.sourceUrl || '',
      groupId,
      groupName: group ? group.name : '未分组',
    });
  }
  return bucket.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('请求内容太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('JSON 格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function requestUrl(url, redirectCount = 0, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      reject(new Error('只支持 http/https 链接'));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const requestHeaders = {
      'user-agent': extraHeaders['user-agent'] || DEFAULT_USER_AGENT,
      referer: extraHeaders.referer || (getPlatform(url) === 'douyin' ? 'https://www.douyin.com/' : 'https://item.taobao.com/'),
      accept: extraHeaders.accept || 'video/mp4,video/*,*/*;q=0.8',
    };
    const req = client.get(
      parsed,
      {
        headers: requestHeaders,
      },
      (response) => {
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && location) {
          response.resume();
          if (redirectCount > 5) {
            reject(new Error('重定向次数过多'));
            return;
          }
          const nextUrl = new URL(location, parsed).toString();
          requestUrl(nextUrl, redirectCount + 1, extraHeaders).then(resolve, reject);
          return;
        }
        response.finalUrl = parsed.toString();
        resolve(response);
      }
    );
    req.setTimeout(extraHeaders.timeoutMs || 45000, () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

async function fetchText(url, maxBytes = 5 * 1024 * 1024, extraHeaders = {}) {
  const response = await requestUrl(url, 0, {
    accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    ...extraHeaders,
  });
  if (!response.statusCode || response.statusCode >= 400) {
    response.resume();
    throw new Error(`页面读取失败，HTTP ${response.statusCode}`);
  }
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    response.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('页面内容太大，无法解析'));
        response.destroy();
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', resolve);
    response.on('error', reject);
  });
  return {text: Buffer.concat(chunks).toString('utf8'), finalUrl: response.finalUrl || url};
}

function decodeCandidateUrl(value) {
  let decoded = String(value || '')
    .replace(/\\u003A/g, ':')
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003D/g, '=')
    .replace(/\\u003F/g, '?')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function decodeTextValue(value) {
  const decoded = decodeCandidateUrl(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return decoded.replace(/\\u([0-9a-fA-F]{4})/g, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanTaobaoTitle(value) {
  return cleanText(decodeTextValue(value), 160)
    .replace(/\s*[-_]\s*(淘宝网|淘宝|天猫Tmall\.com|天猫).*$/i, '')
    .trim();
}

function extractTaobaoTitle(html) {
  const source = String(html || '');
  const patterns = [
    /"itemTitle"\s*:\s*"([^"]{2,300})"/i,
    /"title"\s*:\s*"([^"]{2,300})"/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{2,300})["']/i,
    /<meta[^>]+name=["']title["'][^>]+content=["']([^"']{2,300})["']/i,
    /<title[^>]*>([^<]{2,300})<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const title = match ? cleanTaobaoTitle(match[1]) : '';
    if (title) return title;
  }
  return '';
}

function isTaobaoBlockedPage(html) {
  const source = String(html || '').toLowerCase();
  return /passport\.taobao|login|验证码|verify|punish|请登录|登录后查看/.test(source);
}

function extractDouyinAwemeId(value) {
  const source = String(value || '');
  const patterns = [
    /\/(?:share\/)?video\/(\d{10,30})/i,
    /[?&](?:aweme_id|modal_id|item_id)=(\d{10,30})/i,
    /"(?:aweme_id|modal_id|group_id)"\s*:\s*"?(\\?\d{10,30})"?/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1].replace(/\\/g, '');
  }
  return '';
}

function isDouyinBlockedPage(html) {
  const source = String(html || '').toLowerCase();
  return /data-sdk-glue-in|secsdk|captcha|verify|验证码|风控|login|请登录|_signature|x-bogus/.test(source);
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeout || 60000,
        maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({stdout, stderr});
      }
    );
  });
}

function findChromiumExecutable() {
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return '';
}

function scoreYtDlpFormat(format = {}) {
  let score = 0;
  const ext = String(format.ext || '').toLowerCase();
  const protocol = String(format.protocol || '').toLowerCase();
  if (ext === 'mp4') score += 100000;
  if (protocol.includes('m3u8') || protocol.includes('dash')) score -= 50000;
  if (format.vcodec && format.vcodec !== 'none') score += 10000;
  if (format.acodec && format.acodec !== 'none') score += 1000;
  score += Number(format.height || 0) * 10;
  score += Number(format.tbr || 0);
  score += Number(format.filesize || format.filesize_approx || 0) / 1024 / 1024;
  return score;
}

function selectYtDlpVideoUrl(info = {}) {
  const candidates = [];
  if (/^https?:\/\//i.test(info.url || '')) {
    candidates.push({url: info.url, score: scoreYtDlpFormat(info) + 1000000});
  }
  for (const format of Array.isArray(info.formats) ? info.formats : []) {
    if (!/^https?:\/\//i.test(format.url || '')) continue;
    if (format.vcodec === 'none') continue;
    candidates.push({url: format.url, score: scoreYtDlpFormat(format)});
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].url : '';
}

async function resolveDouyinWithBrowserYtDlp(shareUrl, input) {
  const chromium = findChromiumExecutable();
  if (!chromium) {
    throw new Error('当前部署未安装 Chromium，无法使用抖音浏览器兜底解析。请部署最新 Docker 镜像后再试。');
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-chromium-'));
  try {
    await execFileAsync(
      chromium,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--user-data-dir=${profileDir}`,
        '--window-size=390,844',
        '--virtual-time-budget=8000',
        '--dump-dom',
        shareUrl,
      ],
      {timeout: 20000, maxBuffer: 2 * 1024 * 1024}
    );

    const {stdout} = await execFileAsync(
      'yt-dlp',
      ['-J', '--no-warnings', '--no-playlist', '--cookies-from-browser', `chromium:${profileDir}`, shareUrl],
      {timeout: 60000, maxBuffer: 16 * 1024 * 1024}
    );
    const info = JSON.parse(stdout);
    const videoUrl = selectYtDlpVideoUrl(info);
    if (!videoUrl) {
      throw new Error('yt-dlp 未返回可直接下载的视频地址');
    }
    return {
      videoUrl,
      sourceUrl: shareUrl,
      platform: 'douyin',
      title: cleanText(info.title || extractTitleFromShare(input, ''), 160),
    };
  } catch (error) {
    const details = String(error.stderr || error.message || '');
    if (error.code === 'ENOENT') {
      throw new Error('当前部署未安装 yt-dlp，无法使用抖音兜底解析。请部署最新 Docker 镜像后再试。');
    }
    if (/fresh cookies/i.test(details)) {
      throw new Error('抖音仍要求更新鲜的浏览器 Cookie，当前服务器无法读取原视频地址。请重新复制分享链接后再试，或复制真实视频链接。');
    }
    throw new Error('抖音浏览器兜底解析失败。请重新复制分享链接后再试，或复制真实视频链接。');
  } finally {
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
}

function extractTitleFromShare(input, html) {
  const shareText = cleanText(String(input || '').split(/https?:\/\//i)[0], 160);
  if (shareText) return shareText.replace(/^复制此链接.*$/g, '').trim();
  const titleMatch = String(html || '').match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? cleanText(titleMatch[1].replace(/ - 抖音$/, ''), 160) : '';
}

function scoreVideoUrl(url) {
  const value = url.toLowerCase();
  let score = 0;
  if (value.includes('cloudvideocdn')) score += 70;
  if (value.includes('taobao')) score += 20;
  if (value.includes('origin')) score += 90;
  if (value.includes('source')) score += 80;
  if (value.includes('1080')) score += 50;
  if (value.includes('720')) score += 30;
  if (value.includes('play_addr')) score += 20;
  if (value.includes('/play/')) score += 15;
  if (value.includes('playwm')) score -= 20;
  if (value.includes('watermark')) score -= 30;
  if (value.includes('.mp4')) score += 10;
  return score;
}

function extractVideoCandidates(html) {
  const source = String(html || '');
  const candidates = new Set();
  const patterns = [
    /https?:\\u002F\\u002F[^"'\s<>]+/g,
    /https?:%5C?%2F%5C?%2F[^"'\s<>]+/gi,
    /https?:\\?\/\\?\/[^"'\\\s<>]+/g,
    /\/\/(?:[^"'\\\s<>]+)(?:\.mp4|\/play)[^"'\\\s<>]*/g,
    /\\\/\\\/(?:[^"'\\\s<>]+)(?:\.mp4|\/play)[^"'\\\s<>]*/g,
    /"(?:videoUrl|video_url|videoPath|video_path|mainVideo|auctionVideo|itemVideo|firstVideo|url)"\s*:\s*"([^"]+)"/g,
    /"playAddr"\s*:\s*"([^"]+)"/g,
    /"play_addr"[\s\S]{0,1200}?"url_list"\s*:\s*\[([\s\S]*?)\]/g,
  ];
  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(source))) {
      const raw = match[1] || match[0];
      const nested = raw.match(/https?:\\u002F\\u002F[^"',\]\s<>]+|https?:\\?\/\\?\/[^"',\]\s<>]+/g) || [raw];
      for (const item of nested) {
        let decoded = decodeCandidateUrl(item);
        if (decoded.startsWith('//')) decoded = `https:${decoded}`;
        if (
          /^https?:\/\//i.test(decoded) &&
          (/\.mp4/i.test(decoded) ||
            /\/play/i.test(decoded) ||
            /playwm/i.test(decoded) ||
            /video\/tos/i.test(decoded) ||
            /cloudvideocdn/i.test(decoded)) &&
          !/mime_type=image|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)|\.gif(?:\?|$)/i.test(decoded)
        ) {
          candidates.add(decoded.replace(/\\u0026/g, '&'));
          if (decoded.includes('playwm')) candidates.add(decoded.replace('playwm', 'play'));
        }
      }
    }
  }
  return Array.from(candidates).sort((a, b) => scoreVideoUrl(b) - scoreVideoUrl(a));
}

async function resolveDouyinVideo(input) {
  const shareUrl = extractFirstHttpUrl(input);
  if (!shareUrl) throw new Error('请粘贴抖音分享文案或视频链接');
  const {text, finalUrl} = await fetchText(shareUrl);
  let candidates = extractVideoCandidates(text);
  const awemeId = extractDouyinAwemeId(finalUrl) || extractDouyinAwemeId(text) || extractDouyinAwemeId(input);
  if (!candidates.length && awemeId) {
    const detailUrls = [
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=${encodeURIComponent(awemeId)}`,
      `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(awemeId)}`,
    ];
    for (const detailUrl of detailUrls) {
      try {
        const detail = await fetchText(detailUrl, 2 * 1024 * 1024, {
          'user-agent': DESKTOP_USER_AGENT,
          referer: 'https://www.douyin.com/',
          accept: 'application/json,text/plain,*/*;q=0.8',
          timeoutMs: 12000,
        });
        candidates = extractVideoCandidates(detail.text);
        if (candidates.length) break;
      } catch {}
    }
  }
  if (!candidates.length) {
    return resolveDouyinWithBrowserYtDlp(shareUrl, input);
  }
  return {
    videoUrl: candidates[0],
    sourceUrl: finalUrl,
    platform: 'douyin',
    title: extractTitleFromShare(input, text),
  };
}

async function resolveTaobaoVideo(input) {
  const shareUrl = extractFirstHttpUrl(input);
  if (!shareUrl) throw new Error('请粘贴淘宝/天猫商品链接或视频链接');
  if (isDirectVideoUrl(shareUrl)) {
    return {videoUrl: shareUrl, sourceUrl: shareUrl, platform: 'taobao', title: ''};
  }
  const {text, finalUrl} = await fetchText(shareUrl, 8 * 1024 * 1024, {
    'user-agent': DESKTOP_USER_AGENT,
    referer: 'https://item.taobao.com/',
  });
  const candidates = extractVideoCandidates(text);
  if (!candidates.length) {
    if (isTaobaoBlockedPage(text)) {
      throw new Error('淘宝/天猫返回了登录或验证页面，服务器无法读取商品视频。请在商品页复制真实 MP4 视频链接后再下载。');
    }
    throw new Error('未能从淘宝/天猫商品页解析视频地址。请确认商品页公开视频可访问；如果页面需要登录，请复制真实 MP4 视频链接后再试。');
  }
  return {
    videoUrl: candidates[0],
    sourceUrl: finalUrl,
    platform: 'taobao',
    title: extractTaobaoTitle(text),
  };
}

async function resolveVideoInput(input) {
  const rawUrl = extractFirstHttpUrl(input);
  if (!rawUrl) throw new Error('请粘贴视频链接或分享文案');
  const platform = getPlatform(rawUrl);
  if (isDirectVideoUrl(rawUrl)) return {videoUrl: rawUrl, sourceUrl: rawUrl, platform, title: ''};
  if (platform === 'douyin') return resolveDouyinVideo(input);
  if (platform === 'taobao') return resolveTaobaoVideo(input);
  return {videoUrl: rawUrl, sourceUrl: rawUrl, platform, title: ''};
}

async function downloadVideo({videoUrl, productName, saveDir, groupId, productPrice, productLink, shopName}) {
  if (!videoUrl || typeof videoUrl !== 'string') {
    throw new Error('请粘贴视频链接');
  }
  const resolvedInput = await resolveVideoInput(videoUrl);
  const parsed = new URL(resolvedInput.videoUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('视频链接必须以 http 或 https 开头');
  }

  const dir = resolveSaveDir(saveDir);
  fs.mkdirSync(dir, {recursive: true});

  const extFromPath = path.extname(parsed.pathname).toLowerCase();
  const ext = ['.mp4', '.mov', '.m4v', '.webm'].includes(extFromPath) ? extFromPath : '.mp4';
  const finalProductName = productName || resolvedInput.title;
  const outputPath = uniquePath(dir, sanitizeName(finalProductName), ext);

  const response = await requestUrl(resolvedInput.videoUrl, 0, {
    referer: resolvedInput.platform === 'douyin' ? 'https://www.douyin.com/' : undefined,
  });
  if (!response.statusCode || response.statusCode >= 400) {
    response.resume();
    throw new Error(`下载失败，HTTP ${response.statusCode}`);
  }
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    response.resume();
    throw new Error('解析到的地址不是视频文件，请复制商品视频的真实 MP4 链接后再试');
  }

  const totalBytes = Number(response.headers['content-length'] || 0);
  let downloadedBytes = 0;
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    response.on('data', (chunk) => {
      downloadedBytes += chunk.length;
    });
    response.pipe(file);
    response.on('error', reject);
    file.on('error', reject);
    file.on('finish', () => file.close(resolve));
  });

  if (downloadedBytes < 1024) {
    throw new Error('下载到的文件太小，可能链接已过期或需要重新复制');
  }

  let video = null;
  try {
    const relativePath = getRelativeVideoPath(outputPath);
    const metadata = readMetadata();
    metadata.videos[relativePath] = {
      title: cleanText(finalProductName || videoTitleFromPath(outputPath), 160),
      platform: resolvedInput.platform,
      sourceUrl: cleanText(resolvedInput.sourceUrl, 500),
      productPrice: cleanText(productPrice, 80),
      productLink: cleanText(productLink || resolvedInput.sourceUrl, 500),
      shopName: cleanText(shopName, 160),
      groupId: ensureGroup(metadata, groupId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeMetadata(metadata);
    video = listVideoFiles().find((item) => item.relativePath === relativePath) || null;
  } catch {
    video = null;
  }

  return {
    filePath: outputPath,
    fileName: path.basename(outputPath),
    folder: dir,
    bytes: downloadedBytes,
    totalBytes,
    video,
  };
}

function listGroups() {
  return readMetadata().groups;
}

function createGroup(name) {
  const metadata = readMetadata();
  const cleanName = cleanGroupName(name);
  if (!cleanName) throw new Error('请输入分组名称');
  const existing = metadata.groups.find((group) => group.name === cleanName);
  if (existing) return existing;
  const group = {id: makeId('group'), name: cleanName};
  metadata.groups.push(group);
  writeMetadata(metadata);
  return group;
}

function renameGroup(id, name) {
  const metadata = readMetadata();
  const group = metadata.groups.find((entry) => entry.id === id);
  if (!group) throw new Error('分组不存在');
  if (group.id === 'default') throw new Error('默认分组不能重命名');
  group.name = cleanGroupName(name);
  if (!group.name) throw new Error('请输入分组名称');
  writeMetadata(metadata);
  return group;
}

function updateVideoMetadata(relativePath, updates) {
  resolveVideoPath(relativePath);
  const metadata = readMetadata();
  metadata.videos[relativePath] = {
    ...(metadata.videos[relativePath] || {}),
    title: cleanText(updates.title || videoTitleFromPath(relativePath), 160),
    productPrice: cleanText(updates.productPrice, 80),
    productLink: cleanText(updates.productLink, 500),
    shopName: cleanText(updates.shopName, 160),
    groupId: ensureGroup(metadata, updates.groupId),
    updatedAt: new Date().toISOString(),
  };
  writeMetadata(metadata);
  return listVideoFiles().find((video) => video.relativePath === relativePath);
}

function deleteVideos(relativePaths) {
  if (!Array.isArray(relativePaths) || !relativePaths.length) {
    throw new Error('请选择要删除的视频');
  }
  const metadata = readMetadata();
  const deleted = [];
  for (const relativePath of relativePaths) {
    const filePath = resolveVideoPath(relativePath);
    fs.rmSync(filePath, {force: true});
    delete metadata.videos[relativePath];
    deleted.push(relativePath);
  }
  writeMetadata(metadata);
  return deleted;
}

function serveVideo(req, res, attachment = false) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const filePath = resolveVideoPath(reqUrl.searchParams.get('file'));
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';
  const encodedName = encodeURIComponent(path.basename(filePath));
  const baseHeaders = {
    'accept-ranges': 'bytes',
    'content-type': contentType,
    'content-disposition': `${attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedName}`,
  };

  const range = req.headers.range;
  if (range && !attachment) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start <= end && end < stat.size) {
        res.writeHead(206, {
          ...baseHeaders,
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'content-length': end - start + 1,
        });
        fs.createReadStream(filePath, {start, end}).pipe(res);
        return;
      }
    }
  }

  res.writeHead(200, {
    ...baseHeaders,
    'content-length': stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html';
    res.writeHead(200, {'content-type': `${type}; charset=utf-8`});
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && reqUrl.pathname === '/api/config') {
      sendJson(res, 200, {
        defaultSaveDir: DEFAULT_SAVE_DIR,
        allowCustomSaveDir: ALLOW_CUSTOM_SAVE_DIR,
        authRequired: Boolean(APP_PASSWORD),
        authed: isAuthed(req),
      });
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/login') {
      const body = await parseJsonBody(req);
      if (!APP_PASSWORD || body.password === APP_PASSWORD) {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': `${AUTH_COOKIE}; Path=/; HttpOnly; SameSite=Lax`,
        });
        res.end(JSON.stringify({ok: true}));
        return;
      }
      sendJson(res, 401, {error: '密码不正确'});
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/logout') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': 'taobao_video_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      });
      res.end(JSON.stringify({ok: true}));
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/videos') {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {videos: listVideoFiles()});
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/groups') {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {groups: listGroups()});
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/groups') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req);
      sendJson(res, 200, {group: createGroup(body.name)});
      return;
    }
    if (req.method === 'PUT' && reqUrl.pathname === '/api/groups') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req);
      sendJson(res, 200, {group: renameGroup(body.id, body.name)});
      return;
    }
    if (req.method === 'PATCH' && reqUrl.pathname === '/api/videos') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req);
      sendJson(res, 200, {video: updateVideoMetadata(body.relativePath, body)});
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/videos/delete') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req);
      sendJson(res, 200, {deleted: deleteVideos(body.files)});
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/media') {
      if (!requireAuth(req, res)) return;
      serveVideo(req, res, false);
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/download') {
      if (!requireAuth(req, res)) return;
      serveVideo(req, res, true);
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      sendJson(res, 200, {ok: true});
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/download') {
      if (!requireAuth(req, res)) return;
      const body = await parseJsonBody(req);
      const result = await downloadVideo(body);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === 'GET') {
      serveStatic(req, res);
      return;
    }
    sendJson(res, 405, {error: 'Method not allowed'});
  } catch (error) {
    sendJson(res, 400, {error: error.message || '下载失败'});
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Taobao video downloader: http://${HOST}:${PORT}`);
    console.log(`Default save folder: ${DEFAULT_SAVE_DIR}`);
  });
}

module.exports = {
  DEFAULT_SAVE_DIR,
  extractDouyinAwemeId,
  extractFirstHttpUrl,
  extractTaobaoTitle,
  extractVideoCandidates,
  isDouyinBlockedPage,
  isTaobaoBlockedPage,
  listVideoFiles,
  resolveVideoInput,
  sanitizeName,
  selectYtDlpVideoUrl,
  resolveVideoPath,
  server,
};
