# 淘宝视频下载器

团队网页工具，用于粘贴淘宝真实 MP4 视频链接，按产品名称保存到服务器视频库，并支持预览、封面浏览和下载到本地。

## 功能

- 粘贴淘宝真实 MP4 视频链接并下载
- 按产品名称自动命名文件
- 支持服务器子文件夹分类
- 已下载视频管理列表
- 视频封面预览、在线播放、下载本地
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
- 设置 `APP_PASSWORD` 后，团队成员需要先登录才能下载、预览和查看视频库。

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

如果链接带 `auth_key`，它可能会过期，建议复制后尽快下载。
