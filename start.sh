#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

NODE_BIN="/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

"$NODE_BIN" work/taobao-video-downloader/server.js
