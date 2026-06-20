const form = document.querySelector('#downloadForm');
const videoUrl = document.querySelector('#videoUrl');
const productName = document.querySelector('#productName');
const saveDir = document.querySelector('#saveDir');
const saveDirLabel = document.querySelector('#saveDirLabel');
const result = document.querySelector('#result');
const button = document.querySelector('#downloadBtn');
const pasteButton = document.querySelector('#pasteBtn');
const clearButton = document.querySelector('#clearBtn');
const clearHistoryButton = document.querySelector('#clearHistory');
const historyList = document.querySelector('#historyList');
const videoGrid = document.querySelector('#videoGrid');
const librarySummary = document.querySelector('#librarySummary');
const refreshLibrary = document.querySelector('#refreshLibrary');
const previewDialog = document.querySelector('#previewDialog');
const previewTitle = document.querySelector('#previewTitle');
const previewVideo = document.querySelector('#previewVideo');
const closePreview = document.querySelector('#closePreview');
const loginPanel = document.querySelector('#loginPanel');
const loginForm = document.querySelector('#loginForm');
const passwordInput = document.querySelector('#passwordInput');
const loginButton = document.querySelector('#loginBtn');
const loginResult = document.querySelector('#loginResult');
const logoutButton = document.querySelector('#logoutBtn');

const historyKey = 'taobao-video-download-history';
let authRequired = false;
let authed = true;

function formatBytes(bytes) {
  if (!bytes) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function showResult(type, html) {
  result.hidden = false;
  result.className = `result ${type}`;
  result.innerHTML = html;
}

function showLoginResult(type, html) {
  loginResult.hidden = false;
  loginResult.className = `result ${type}`;
  loginResult.innerHTML = html;
}

function updateAuthUi() {
  const locked = authRequired && !authed;
  loginPanel.hidden = !locked;
  form.closest('.panel').hidden = locked;
  document.querySelector('.library-panel').hidden = locked;
  document.querySelector('.history-panel').hidden = locked;
  logoutButton.hidden = !authRequired || locked;
  if (locked) passwordInput.focus();
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(historyKey) || '[]');
  } catch {
    return [];
  }
}

function setHistory(items) {
  localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 20)));
  renderHistory();
}

function renderHistory() {
  const items = getHistory();
  historyList.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('li');
    empty.innerHTML = '<span>暂无记录</span>';
    historyList.appendChild(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${item.name}</strong>
      <span>${item.path}</span>
      <span>${item.size} · ${item.time}</span>
    `;
    historyList.appendChild(li);
  }
}

function openPreview(video) {
  previewTitle.textContent = video.title;
  previewVideo.src = video.previewUrl;
  if (typeof previewDialog.showModal === 'function') {
    previewDialog.showModal();
  } else {
    previewDialog.setAttribute('open', '');
  }
  previewVideo.play().catch(() => {});
}

function closePreviewDialog() {
  previewVideo.pause();
  previewVideo.removeAttribute('src');
  previewVideo.load();
  previewDialog.close();
}

function renderVideos(videos) {
  videoGrid.innerHTML = '';
  librarySummary.textContent = videos.length
    ? `共 ${videos.length} 个视频，按更新时间排序`
    : '暂无视频，下载成功后会显示在这里。';

  if (!videos.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-library';
    empty.textContent = '还没有已下载视频';
    videoGrid.appendChild(empty);
    return;
  }

  for (const video of videos) {
    const card = document.createElement('article');
    card.className = 'video-card';
    card.innerHTML = `
      <div class="thumb-wrap">
        <video class="thumb" src="${video.previewUrl}#t=0.2" preload="metadata" muted playsinline></video>
      </div>
      <div class="video-meta">
        <strong title="${video.fileName}">${video.title}</strong>
        <span>${formatBytes(video.bytes)} · ${formatTime(video.updatedAt)}</span>
        ${video.folder ? `<span>${video.folder}</span>` : ''}
      </div>
      <div class="card-actions">
        <button type="button" class="preview-btn">预览视频</button>
        <a class="download-link" href="${video.downloadUrl}">下载本地</a>
      </div>
    `;
    card.querySelector('.preview-btn').addEventListener('click', () => openPreview(video));
    videoGrid.appendChild(card);
  }
}

async function loadVideos() {
  if (authRequired && !authed) return;
  refreshLibrary.disabled = true;
  try {
    const response = await fetch('/api/videos');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取视频库失败');
    renderVideos(data.videos || []);
  } catch (error) {
    librarySummary.textContent = error.message || '读取视频库失败';
    videoGrid.innerHTML = '';
  } finally {
    refreshLibrary.disabled = false;
  }
}

async function loadConfig() {
  const response = await fetch('/api/config');
  const config = await response.json();
  authRequired = Boolean(config.authRequired);
  authed = Boolean(config.authed);
  updateAuthUi();
  if (authRequired && !authed) return;
  if (config.allowCustomSaveDir) {
    saveDirLabel.textContent = '保存文件夹';
    saveDir.value = config.defaultSaveDir;
    saveDir.placeholder = '/Users/name/Downloads/videos';
  } else {
    saveDirLabel.textContent = '服务器子文件夹';
    saveDir.value = '';
    saveDir.placeholder = '例如：夏季新品/直播素材';
  }
}

async function submitLogin(event) {
  event.preventDefault();
  loginResult.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = '登录中...';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({password: passwordInput.value}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录失败');
    authed = true;
    passwordInput.value = '';
    updateAuthUi();
    await loadConfig();
    await loadVideos();
  } catch (error) {
    showLoginResult('bad', error.message || '登录失败');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = '登录';
  }
}

async function logout() {
  await fetch('/api/logout', {method: 'POST'}).catch(() => {});
  authed = false;
  updateAuthUi();
}

async function submitDownload(event) {
  event.preventDefault();
  result.hidden = true;

  const payload = {
    videoUrl: videoUrl.value.trim(),
    productName: productName.value.trim(),
    saveDir: saveDir.value.trim(),
  };

  if (!payload.videoUrl) {
    showResult('bad', '请先粘贴淘宝视频链接。');
    return;
  }

  button.disabled = true;
  button.textContent = '下载中...';
  showResult('good', '正在连接视频地址并保存，请稍等。');

  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '下载失败');

    showResult(
      'good',
      `已保存：<strong>${data.fileName}</strong><br />路径：${data.filePath}<br />大小：${formatBytes(data.bytes)}`
    );
    setHistory([
      {
        name: data.fileName,
        path: data.filePath,
        size: formatBytes(data.bytes),
        time: new Date().toLocaleString(),
      },
      ...getHistory(),
    ]);
    await loadVideos();
  } catch (error) {
    showResult('bad', error.message || '下载失败。链接可能已过期，请重新复制视频地址。');
  } finally {
    button.disabled = false;
    button.textContent = '下载视频';
  }
}

pasteButton.addEventListener('click', async () => {
  try {
    videoUrl.value = await navigator.clipboard.readText();
    videoUrl.focus();
  } catch {
    showResult('bad', '浏览器没有授权读取剪贴板，请手动粘贴。');
  }
});

clearButton.addEventListener('click', () => {
  videoUrl.value = '';
  productName.value = '';
  result.hidden = true;
});

clearHistoryButton.addEventListener('click', () => setHistory([]));
refreshLibrary.addEventListener('click', loadVideos);
closePreview.addEventListener('click', closePreviewDialog);
previewDialog.addEventListener('cancel', closePreviewDialog);
loginForm.addEventListener('submit', submitLogin);
logoutButton.addEventListener('click', logout);
form.addEventListener('submit', submitDownload);

async function init() {
  renderHistory();
  try {
    await loadConfig();
    if (!authRequired || authed) {
      await loadVideos();
    }
  } catch {
    showResult('bad', '服务配置读取失败，请确认服务已启动。');
  }
}

init();
