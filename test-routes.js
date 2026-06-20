const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {Readable, Writable} = require('stream');

const {DEFAULT_SAVE_DIR, sanitizeName, server} = require('./server');

function callRoute({method = 'GET', url, headers = {}, body = ''}) {
  const handler = server.listeners('request')[0];
  const req = new Readable({
    read() {
      if (body) this.push(body);
      this.push(null);
    },
  });
  req.method = method;
  req.url = url;
  req.headers = {host: '127.0.0.1:4177', ...headers};

  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.writeHead = (statusCode, headersOut = {}) => {
    res.statusCode = statusCode;
    res.headers = headersOut;
  };
  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.from(chunk));
    res.emit('finish');
  };

  return new Promise((resolve, reject) => {
    res.on('finish', () => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers || {},
        body: Buffer.concat(chunks),
      });
    });
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

(async () => {
  fs.mkdirSync(DEFAULT_SAVE_DIR, {recursive: true});
  const safeName = sanitizeName('接口测试视频');
  const samplePath = path.join(DEFAULT_SAVE_DIR, `${safeName}.mp4`);

  try {
    fs.writeFileSync(samplePath, Buffer.alloc(4096, 2));

    const listResponse = await callRoute({url: '/api/videos'});
    assert.strictEqual(listResponse.statusCode, 200);
    const listJson = JSON.parse(listResponse.body.toString('utf8'));
    const sample = listJson.videos.find((video) => video.fileName === `${safeName}.mp4`);
    assert(sample, 'sample should appear in /api/videos');

    const mediaResponse = await callRoute({
      url: `/media?file=${encodeURIComponent(sample.relativePath)}`,
      headers: {range: 'bytes=0-99'},
    });
    assert.strictEqual(mediaResponse.statusCode, 206);
    assert.strictEqual(mediaResponse.body.length, 100);
    assert.strictEqual(mediaResponse.headers['content-type'], 'video/mp4');

    const downloadResponse = await callRoute({
      url: `/download?file=${encodeURIComponent(sample.relativePath)}`,
    });
    assert.strictEqual(downloadResponse.statusCode, 200);
    assert.strictEqual(downloadResponse.headers['content-disposition'].startsWith('attachment'), true);

    console.log(
      JSON.stringify(
        {
          ok: true,
          listStatus: listResponse.statusCode,
          mediaStatus: mediaResponse.statusCode,
          downloadStatus: downloadResponse.statusCode,
          sample: sample.fileName,
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(samplePath, {force: true});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
