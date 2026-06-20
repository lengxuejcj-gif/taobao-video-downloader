FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4177
ENV STORAGE_ROOT=/data/taobao-videos
ENV ALLOW_CUSTOM_SAVE_DIR=false
ENV APP_PASSWORD=

RUN mkdir -p /data/taobao-videos

EXPOSE 4177

CMD ["node", "server.js"]
