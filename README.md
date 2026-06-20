# 淘宝视频下载器

网页工具，用于粘贴淘宝真实 MP4 视频链接，按产品名称保存视频。

## 启动

```bash
cd /Users/kim/Documents/Codex/2026-06-09/files-mentioned-by-the-user-84fbace4-2
bash work/taobao-video-downloader/start.sh
```

然后打开：

```text
http://127.0.0.1:4177
```

本地默认保存目录：

```text
/Users/kim/Documents/Codex/2026-06-09/files-mentioned-by-the-user-84fbace4-2/outputs/taobao-videos
```

## 使用

1. 在淘宝商品页复制真实视频 MP4 链接。
2. 粘贴到网页里的“淘宝视频链接”。
3. 填产品名称。
4. 本地模式可以填保存文件夹；线上模式填写服务器子文件夹。
5. 点击“下载视频”。
6. 在“已下载视频”区域管理视频，支持封面浏览、标题查看、在线播放预览和下载到本地。

如果链接带 `auth_key`，它可能会过期，建议复制后尽快下载。

## 线上部署

这个项目可以部署到 VPS、Render、Railway、Fly.io 或公司内网服务器。

线上模式建议：

```bash
HOST=0.0.0.0 PORT=4177 STORAGE_ROOT=/data/taobao-videos ALLOW_CUSTOM_SAVE_DIR=false APP_PASSWORD='换成团队密码' node server.js
```

说明：

- `STORAGE_ROOT` 是服务器保存视频的根目录。
- `ALLOW_CUSTOM_SAVE_DIR=false` 时，网页里的“服务器子文件夹”会被拼到 `STORAGE_ROOT` 下面，避免用户写入服务器任意路径。
- 已下载视频管理页会扫描 `STORAGE_ROOT` 下的 `.mp4`、`.mov`、`.m4v`、`.webm` 文件。
- 团队成员点击“下载本地”时，浏览器会把服务器里的视频下载到自己的电脑。
- 设置 `APP_PASSWORD` 后，团队成员需要先登录才能下载、预览和查看视频库。

Docker 部署：

```bash
docker build -t taobao-video-downloader .
docker run -p 4177:4177 \
  -e APP_PASSWORD='换成团队密码' \
  -v "$PWD/downloads:/data/taobao-videos" \
  taobao-video-downloader
```
