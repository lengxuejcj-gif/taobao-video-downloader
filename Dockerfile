FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache chromium python3 py3-pip \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp

COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4177
ENV STORAGE_ROOT=/data/taobao-videos
ENV ALLOW_CUSTOM_SAVE_DIR=false
ENV APP_PASSWORD=
ENV PATH=/opt/yt-dlp/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN mkdir -p /data/taobao-videos

EXPOSE 4177

CMD ["node", "server.js"]
