# 淘宝视频下载器

团队网页工具，用于粘贴淘宝真实 MP4 视频链接，按产品名称保存到服务器视频库，并支持预览、封面浏览、分组管理和下载到本地。

## 功能

- 粘贴淘宝真实 MP4 视频链接并下载
- 按产品名称自动命名文件
- 已下载视频管理列表
- 视频封面预览、在线播放、下载本地
- 新增和重命名视频分组
- 按标题搜索、按分组筛选
- 保存和编辑产品价格、淘宝购买链接、店铺名称
- 单个删除和批量删除视频
- `APP_PASSWORD` 访问密码保护
- Docker / Render 部署配置

## 本地启动

```bash
npm start
```

默认访问：

```text
http://127.0.0.1:4177
```

默认保存目录：

```text
outputs/taobao-videos
```

## 使用

1. 在淘宝商品页复制真实视频 MP4 链接。
2. 粘贴到网页里的“淘宝视频链接”。
3. 填产品名称、分组、产品价格、淘宝购买链接和店铺名称。
4. 本地模式可以填保存文件夹；线上模式填写服务器子文件夹。
5. 点击“下载视频”。
6. 在“已下载视频”区域管理视频，支持搜索、筛选、预览、编辑、删除和下载本地。

如果链接带 `auth_key`，它可能会过期，建议复制后尽快下载。

## 环境变量

```text
HOST=0.0.0.0
PORT=4177
STORAGE_ROOT=/data/taobao-videos
ALLOW_CUSTOM_SAVE_DIR=false
APP_PASSWORD=换成团队密码
```

说明：

- `STORAGE_ROOT` 是服务器保存视频的根目录。
- `ALLOW_CUSTOM_SAVE_DIR=false` 时，网页里的“服务器子文件夹”会被拼到 `STORAGE_ROOT` 下面。
- 视频标题、分组、价格、购买链接和店铺名称会保存在 `STORAGE_ROOT/.video-metadata.json`。
- 团队成员点击“下载本地”时，浏览器会把服务器里的视频下载到自己的电脑。
- 设置 `APP_PASSWORD` 后，团队成员需要先登录才能下载、预览和查看视频库。

## 测试

```bash
node --check server.js
node --check public/app.js
node test-local.js
node test-routes.js
node test-auth.js
```

## Docker 部署

```bash
docker build -t taobao-video-downloader .
docker run -p 4177:4177 \
  -e APP_PASSWORD='换成团队密码' \
  -v "$PWD/downloads:/data/taobao-videos" \
  taobao-video-downloader
```

## Render 部署

仓库已包含 `render.yaml`，可以在 Render 中使用 Blueprint 部署。

部署后请在 Render 环境变量中设置：

```text
APP_PASSWORD=你的团队访问密码
```
