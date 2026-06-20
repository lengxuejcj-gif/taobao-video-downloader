const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {DEFAULT_SAVE_DIR, listVideoFiles, resolveVideoPath, sanitizeName} = require('./server');

fs.mkdirSync(DEFAULT_SAVE_DIR, {recursive: true});

const sampleName = '测试 产品: A/B?';
const safeName = sanitizeName(sampleName);
assert.strictEqual(safeName, '测试 产品 A B');

const samplePath = path.join(DEFAULT_SAVE_DIR, `${safeName}.mp4`);

try {
  fs.writeFileSync(samplePath, Buffer.alloc(2048, 1));

  const videos = listVideoFiles();
  const sample = videos.find((video) => video.fileName === `${safeName}.mp4`);

  assert(sample, 'sample video should be listed');
  assert.strictEqual(sample.title, safeName);
  assert.strictEqual(sample.relativePath, `${safeName}.mp4`);
  assert.strictEqual(sample.previewUrl, `/media?file=${encodeURIComponent(sample.relativePath)}`);
  assert.strictEqual(sample.downloadUrl, `/download?file=${encodeURIComponent(sample.relativePath)}`);
  assert.strictEqual(resolveVideoPath(sample.relativePath), samplePath);
  assert.throws(() => resolveVideoPath('../secret.mp4'), /路径不合法|不在视频库|只允许/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        defaultSaveDir: DEFAULT_SAVE_DIR,
        listedVideos: videos.length,
        sample,
      },
      null,
      2
    )
  );
} finally {
  fs.rmSync(samplePath, {force: true});
}
