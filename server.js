const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body)});
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
  const cleaned = String(value || '').normalize('NFKC').replace(/[\\/:*?"<>|#%{}^~[\]`;\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (!groups.some((group) => group.id === 'default')) groups.unshift({id: 'default', name: '未分组'});
  return {
    groups: groups.map((group) => ({id: String(group.id || makeId('group')), name: cleanGroupName(group.name) || '未分组'})),
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
  return groupId && metadata.groups.some((group) => group.id === groupId) ? groupId : 'default';
}
function resolveSaveDir(dir) {
  if (!ALLOW_CUSTOM_SAVE_DIR) {
    const subdir = sanitizeName(dir || '');
    return subdir ? path.join(DEFAULT_SAVE_DIR, subdir) : DEFAULT_SAVE_DIR;
  }
  return path.resolve(dir || DEFAULT_SAVE_DIR);
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
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件不在视频库目录中');
  return relative;
}
function resolveVideoPath(relativePath) {
  const resolved = path.resolve(DEFAULT_SAVE_DIR, relativePath || '');
  if (resolved !== DEFAULT_SAVE_DIR && !resolved.startsWith(`${DEFAULT_SAVE_DIR}${path.sep}`)) throw new Error('视频路径不合法');
  if (!isVideoFile(resolved)) throw new Error('只允许访问视频文件');
  return resolved;
}
function videoTitleFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/-\d+$/, '');
}
function listVideoFiles(dir = DEFAULT_SAVE_DIR, bucket = [], metadata = readMetadata()) {
  if (!fs.existsSync(dir)) return bucket;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listVideoFiles(fullPath, bucket, metadata);
      continue;
    }
    if (!entry.isFile() || !isVideoFile(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    const relativePath = getRelativeVideoPath(fullPath);
    const itemMeta = metadata.videos[relativePath] || {};
    const groupId = ensureGroup(metadata, itemMeta.groupId);
    const group = metadata.groups.find((item) => item.id === groupId);
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
function requestUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      reject(new Error('只支持 http/https 链接'));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        referer: 'https://item.taobao.com/',
        accept: 'video/mp4,video/*,*/*;q=0.8',
      },
    }, (response) => {
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && location) {
        response.resume();
        if (redirectCount > 5) {
          reject(new Error('重定向次数过多'));
          return;
        }
        requestUrl(new URL(location, parsed).toString(), redirectCount + 1).then(resolve, reject);
        return;
      }
      resolve(response);
    });
    req.setTimeout(45000, () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}
async function downloadVideo({videoUrl, productName, saveDir, groupId, productPrice, productLink, shopName}) {
  if (!videoUrl || typeof videoUrl !== 'string') throw new Error('请粘贴视频链接');
  const parsed = new URL(videoUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('视频链接必须以 http 或 https 开头');
  const dir = resolveSaveDir(saveDir || DEFAULT_SAVE_DIR);
  fs.mkdirSync(dir, {recursive: true});
  const extFromPath = path.extname(parsed.pathname).toLowerCase();
  const ext = ['.mp4', '.mov', '.m4v', '.webm'].includes(extFromPath) ? extFromPath : '.mp4';
  const outputPath = uniquePath(dir, sanitizeName(productName), ext);
  const response = await requestUrl(videoUrl);
  if (!response.statusCode || response.statusCode >= 400) {
    response.resume();
    throw new Error(`下载失败，HTTP ${response.statusCode}`);
  }
  const totalBytes = Number(response.headers['content-length'] || 0);
  let downloadedBytes = 0;
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    response.on('data', (chunk) => { downloadedBytes += chunk.length; });
    response.pipe(file);
    response.on('error', reject);
    file.on('error', reject);
    file.on('finish', () => file.close(resolve));
  });
  if (downloadedBytes < 1024) throw new Error('下载到的文件太小，可能链接已过期或需要重新复制');
  let video = null;
  try {
    const relativePath = getRelativeVideoPath(outputPath);
    const metadata = readMetadata();
    metadata.videos[relativePath] = {
      title: cleanText(productName || videoTitleFromPath(outputPath), 160),
      productPrice: cleanText(productPrice, 80),
      productLink: cleanText(productLink, 500),
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
  return {filePath: outputPath, fileName: path.basename(outputPath), folder: dir, bytes: downloadedBytes, totalBytes, video};
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
  if (!Array.isArray(relativePaths) || !relativePaths.length) throw new Error('请选择要删除的视频');
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
  const baseHeaders = {'accept-ranges': 'bytes', 'content-type': contentType, 'content-disposition': `${attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedName}`};
  const range = req.headers.range;
  if (range && !attachment) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start <= end && end < stat.size) {
        res.writeHead(206, {...baseHeaders, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1});
        fs.createReadStream(filePath, {start, end}).pipe(res);
        return;
      }
    }
  }
  res.writeHead(200, {...baseHeaders, 'content-length': stat.size});
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
      sendJson(res, 200, {defaultSaveDir: DEFAULT_SAVE_DIR, allowCustomSaveDir: ALLOW_CUSTOM_SAVE_DIR, authRequired: Boolean(APP_PASSWORD), authed: isAuthed(req)});
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/login') {
      const body = await parseJsonBody(req);
      if (!APP_PASSWORD || body.password === APP_PASSWORD) {
        res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'set-cookie': `${AUTH_COOKIE}; Path=/; HttpOnly; SameSite=Lax`});
        res.end(JSON.stringify({ok: true}));
        return;
      }
      sendJson(res, 401, {error: '密码不正确'});
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/logout') {
      res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'set-cookie': 'taobao_video_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'});
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
      sendJson(res, 200, await downloadVideo(body));
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
module.exports = {DEFAULT_SAVE_DIR, listVideoFiles, sanitizeName, resolveVideoPath, server};
