process.env.APP_PASSWORD = 'secret-for-test';

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
  const safeName = sanitizeName('认证测试视频');
  const samplePath = path.join(DEFAULT_SAVE_DIR, `${safeName}.mp4`);

  try {
    fs.writeFileSync(samplePath, Buffer.alloc(4096, 3));

    const configResponse = await callRoute({url: '/api/config'});
    assert.strictEqual(configResponse.statusCode, 200);
    const config = JSON.parse(configResponse.body.toString('utf8'));
    assert.strictEqual(config.authRequired, true);
    assert.strictEqual(config.authed, false);

    const lockedList = await callRoute({url: '/api/videos'});
    assert.strictEqual(lockedList.statusCode, 401);

    const badLogin = await callRoute({
      method: 'POST',
      url: '/api/login',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({password: 'wrong'}),
    });
    assert.strictEqual(badLogin.statusCode, 401);

    const goodLogin = await callRoute({
      method: 'POST',
      url: '/api/login',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({password: 'secret-for-test'}),
    });
    assert.strictEqual(goodLogin.statusCode, 200);
    assert(String(goodLogin.headers['set-cookie']).includes('taobao_video_auth=ok'));

    const authedList = await callRoute({
      url: '/api/videos',
      headers: {cookie: 'taobao_video_auth=ok'},
    });
    assert.strictEqual(authedList.statusCode, 200);
    const listJson = JSON.parse(authedList.body.toString('utf8'));
    assert(listJson.videos.some((video) => video.fileName === `${safeName}.mp4`));

    console.log(
      JSON.stringify(
        {
          ok: true,
          lockedStatus: lockedList.statusCode,
          badLoginStatus: badLogin.statusCode,
          goodLoginStatus: goodLogin.statusCode,
          authedListStatus: authedList.statusCode,
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
