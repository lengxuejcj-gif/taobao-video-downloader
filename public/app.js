const form = document.querySelector('#downloadForm');
const videoUrl = document.querySelector('#videoUrl');
const productName = document.querySelector('#productName');
const productPrice = document.querySelector('#productPrice');
const productLink = document.querySelector('#productLink');
const shopName = document.querySelector('#shopName');
const saveDir = document.querySelector('#saveDir');
const saveDirLabel = document.querySelector('#saveDirLabel');
const groupSelect = document.querySelector('#groupSelect');
const result = document.querySelector('#result');
const button = document.querySelector('#downloadBtn');
const pasteButton = document.querySelector('#pasteBtn');
const clearButton = document.querySelector('#clearBtn');
const clearHistoryButton = document.querySelector('#clearHistory');
const historyList = document.querySelector('#historyList');
const videoGrid = document.querySelector('#videoGrid');
const librarySummary = document.querySelector('#librarySummary');
const refreshLibrary = document.querySelector('#refreshLibrary');
const searchInput = document.querySelector('#searchInput');
const groupFilter = document.querySelector('#groupFilter');
const deleteSelected = document.querySelector('#deleteSelected');
const groupForm = document.querySelector('#groupForm');
const groupNameInput = document.querySelector('#groupNameInput');
const groupList = document.querySelector('#groupList');
const previewDialog = document.querySelector('#previewDialog');
const previewTitle = document.querySelector('#previewTitle');
const previewVideo = document.querySelector('#previewVideo');
const closePreview = document.querySelector('#closePreview');
const editDialog = document.querySelector('#editDialog');
const editForm = document.querySelector('#editForm');
const closeEdit = document.querySelector('#closeEdit');
const editRelativePath = document.querySelector('#editRelativePath');
const editTitle = document.querySelector('#editTitle');
const editGroup = document.querySelector('#editGroup');
const editPrice = document.querySelector('#editPrice');
const editLink = document.querySelector('#editLink');
const editShop = document.querySelector('#editShop');
const loginPanel = document.querySelector('#loginPanel');
const loginForm = document.querySelector('#loginForm');
const passwordInput = document.querySelector('#passwordInput');
const loginButton = document.querySelector('#loginBtn');
const loginResult = document.querySelector('#loginResult');
const logoutButton = document.querySelector('#logoutBtn');

const historyKey = 'taobao-video-download-history';
let authRequired = false;
let authed = true;
let groups = [];
let videos = [];

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
function formatTime(value) { return value ? new Date(value).toLocaleString() : ''; }
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}
function showResult(type, html) { result.hidden = false; result.className = `result ${type}`; result.innerHTML = html; }
function showLoginResult(type, html) { loginResult.hidden = false; loginResult.className = `result ${type}`; loginResult.innerHTML = html; }
function updateAuthUi() {
  const locked = authRequired && !authed;
  loginPanel.hidden = !locked;
  form.closest('.panel').hidden = locked;
  document.querySelector('.library-panel').hidden = locked;
  document.querySelector('.history-panel').hidden = locked;
  logoutButton.hidden = !authRequired || locked;
  if (locked) passwordInput.focus();
}
function getHistory() { try { return JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch { return []; } }
function setHistory(items) { localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 20))); renderHistory(); }
function renderHistory() {
  const items = getHistory();
  historyList.innerHTML = items.length ? items.map((item) => `
    <li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.path)}</span><span>${escapeHtml(item.size)} · ${escapeHtml(item.time)}</span></li>
  `).join('') : '<li><span>暂无记录</span></li>';
}
function renderGroupOptions() {
  const options = groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('');
  groupSelect.innerHTML = options;
  editGroup.innerHTML = options;
  groupFilter.innerHTML = `<option value="">全部分组</option>${options}`;
}
function renderGroups() {
  renderGroupOptions();
  groupList.innerHTML = groups.map((group) => `
    <li><span>${escapeHtml(group.name)}</span>${group.id === 'default' ? '<em>默认</em>' : `<button type="button" class="ghost small rename-group" data-id="${escapeHtml(group.id)}">重命名</button>`}</li>
  `).join('');
  groupList.querySelectorAll('.rename-group').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const group = groups.find((item) => item.id === btn.dataset.id);
      const name = prompt('输入新的分组名称', group ? group.name : '');
      if (!name) return;
      await fetch('/api/groups', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: btn.dataset.id, name})});
      await loadGroups();
      await loadVideos();
    });
  });
}
function filteredVideos() {
  const keyword = searchInput.value.trim().toLowerCase();
  const groupId = groupFilter.value;
  return videos.filter((video) => (!keyword || String(video.title || '').toLowerCase().includes(keyword)) && (!groupId || video.groupId === groupId));
}
function openPreview(video) {
  if (!video) return;
  previewTitle.textContent = video.title;
  previewVideo.src = video.previewUrl;
  if (typeof previewDialog.showModal === 'function') previewDialog.showModal();
  else previewDialog.setAttribute('open', '');
  previewVideo.play().catch(() => {});
}
function closePreviewDialog() { previewVideo.pause(); previewVideo.removeAttribute('src'); previewVideo.load(); previewDialog.close(); }
function openEdit(video) {
  if (!video) return;
  editRelativePath.value = video.relativePath;
  editTitle.value = video.title;
  editGroup.value = video.groupId || 'default';
  editPrice.value = video.productPrice || '';
  editLink.value = video.productLink || '';
  editShop.value = video.shopName || '';
  if (typeof editDialog.showModal === 'function') editDialog.showModal();
  else editDialog.setAttribute('open', '');
}
function renderVideos() {
  const visible = filteredVideos();
  librarySummary.textContent = `共 ${videos.length} 个视频，当前显示 ${visible.length} 个`;
  deleteSelected.disabled = !visible.length;
  if (!visible.length) {
    videoGrid.innerHTML = '<div class="empty-library">没有匹配的视频</div>';
    return;
  }
  videoGrid.innerHTML = visible.map((video) => `
    <article class="video-card">
      <label class="select-box"><input type="checkbox" class="video-check" value="${escapeHtml(video.relativePath)}" /></label>
      <div class="thumb-wrap"><video class="thumb" src="${escapeHtml(video.previewUrl)}#t=0.2" preload="metadata" muted playsinline></video></div>
      <div class="video-meta">
        <strong title="${escapeHtml(video.fileName)}">${escapeHtml(video.title)}</strong>
        <span>${escapeHtml(video.groupName)} · ${formatBytes(video.bytes)} · ${formatTime(video.updatedAt)}</span>
        ${video.shopName ? `<span>店铺：${escapeHtml(video.shopName)}</span>` : ''}
        ${video.productPrice ? `<span>价格：${escapeHtml(video.productPrice)}</span>` : ''}
        ${video.productLink ? `<a href="${escapeHtml(video.productLink)}" target="_blank" rel="noreferrer">淘宝购买链接</a>` : ''}
      </div>
      <div class="card-actions">
        <button type="button" class="preview-btn" data-file="${escapeHtml(video.relativePath)}">预览</button>
        <button type="button" class="edit-btn secondary" data-file="${escapeHtml(video.relativePath)}">编辑</button>
        <button type="button" class="delete-btn danger" data-file="${escapeHtml(video.relativePath)}">删除</button>
        <a class="download-link" href="${escapeHtml(video.downloadUrl)}">下载本地</a>
      </div>
    </article>
  `).join('');
  videoGrid.querySelectorAll('.preview-btn').forEach((btn) => btn.addEventListener('click', () => openPreview(videos.find((video) => video.relativePath === btn.dataset.file))));
  videoGrid.querySelectorAll('.edit-btn').forEach((btn) => btn.addEventListener('click', () => openEdit(videos.find((video) => video.relativePath === btn.dataset.file))));
  videoGrid.querySelectorAll('.delete-btn').forEach((btn) => btn.addEventListener('click', () => deleteFiles([btn.dataset.file])));
}
async function loadGroups() {
  if (authRequired && !authed) return;
  const response = await fetch('/api/groups');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '读取分组失败');
  groups = data.groups || [];
  renderGroups();
}
async function loadVideos() {
  if (authRequired && !authed) return;
  refreshLibrary.disabled = true;
  try {
    const response = await fetch('/api/videos');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取视频库失败');
    videos = data.videos || [];
    renderVideos();
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
    const response = await fetch('/api/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({password: passwordInput.value})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录失败');
    authed = true;
    passwordInput.value = '';
    updateAuthUi();
    await initData();
  } catch (error) {
    showLoginResult('bad', error.message || '登录失败');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = '登录';
  }
}
async function logout() { await fetch('/api/logout', {method: 'POST'}).catch(() => {}); authed = false; updateAuthUi(); }
async function submitDownload(event) {
  event.preventDefault();
  result.hidden = true;
  const payload = {
    videoUrl: videoUrl.value.trim(),
    productName: productName.value.trim(),
    saveDir: saveDir.value.trim(),
    groupId: groupSelect.value,
    productPrice: productPrice.value.trim(),
    productLink: productLink.value.trim(),
    shopName: shopName.value.trim(),
  };
  if (!payload.videoUrl) { showResult('bad', '请先粘贴淘宝视频链接。'); return; }
  button.disabled = true;
  button.textContent = '下载中...';
  showResult('good', '正在连接视频地址并保存，请稍等。');
  try {
    const response = await fetch('/api/download', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '下载失败');
    showResult('good', `已保存：<strong>${escapeHtml(data.fileName)}</strong><br />大小：${formatBytes(data.bytes)}`);
    setHistory([{name: data.fileName, path: data.filePath, size: formatBytes(data.bytes), time: new Date().toLocaleString()}, ...getHistory()]);
    await loadVideos();
  } catch (error) {
    showResult('bad', error.message || '下载失败。链接可能已过期，请重新复制视频地址。');
  } finally {
    button.disabled = false;
    button.textContent = '下载视频';
  }
}
async function deleteFiles(files) {
  if (!files.length) return;
  if (!confirm(`确认删除 ${files.length} 个视频？此操作不可恢复。`)) return;
  const response = await fetch('/api/videos/delete', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({files})});
  const data = await response.json();
  if (!response.ok) { alert(data.error || '删除失败'); return; }
  await loadVideos();
}
async function initData() {
  await loadConfig();
  if (!authRequired || authed) {
    await loadGroups();
    await loadVideos();
  }
}
pasteButton.addEventListener('click', async () => { try { videoUrl.value = await navigator.clipboard.readText(); videoUrl.focus(); } catch { showResult('bad', '浏览器没有授权读取剪贴板，请手动粘贴。'); } });
clearButton.addEventListener('click', () => { videoUrl.value = ''; productName.value = ''; productPrice.value = ''; productLink.value = ''; shopName.value = ''; result.hidden = true; });
groupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = groupNameInput.value.trim();
  if (!name) return;
  const response = await fetch('/api/groups', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name})});
  if (response.ok) { groupNameInput.value = ''; await loadGroups(); }
});
editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/videos', {
    method: 'PATCH',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({relativePath: editRelativePath.value, title: editTitle.value, groupId: editGroup.value, productPrice: editPrice.value, productLink: editLink.value, shopName: editShop.value}),
  });
  if (response.ok) { editDialog.close(); await loadVideos(); }
});
deleteSelected.addEventListener('click', () => deleteFiles(Array.from(document.querySelectorAll('.video-check:checked')).map((item) => item.value)));
searchInput.addEventListener('input', renderVideos);
groupFilter.addEventListener('change', renderVideos);
clearHistoryButton.addEventListener('click', () => setHistory([]));
refreshLibrary.addEventListener('click', loadVideos);
closePreview.addEventListener('click', closePreviewDialog);
previewDialog.addEventListener('cancel', closePreviewDialog);
closeEdit.addEventListener('click', () => editDialog.close());
loginForm.addEventListener('submit', submitLogin);
logoutButton.addEventListener('click', logout);
form.addEventListener('submit', submitDownload);
renderHistory();
initData().catch(() => showResult('bad', '服务配置读取失败，请确认服务已启动。'));
