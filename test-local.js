const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_SAVE_DIR,
  extractFirstHttpUrl,
  extractTaobaoTitle,
  extractVideoCandidates,
  isTaobaoBlockedPage,
  listVideoFiles,
  resolveVideoPath,
  sanitizeName,
} = require('./server');

fs.mkdirSync(DEFAULT_SAVE_DIR, {recursive: true});

const sampleName = '测试 产品: A/B?';
const safeName = sanitizeName(sampleName);
assert.strictEqual(safeName, '测试 产品 A B');
assert.strictEqual(
  extractFirstHttpUrl('解放双手的三筒洗衣机洗鞋机 https://v.douyin.com/y4K9mDn3OSw/ 复制此链接，打开【抖音】'),
  'https://v.douyin.com/y4K9mDn3OSw/'
);

const taobaoHtml =
  '<html><head><title>旧标题 - 淘宝网</title></head><body>' +
  '<script>window.__DATA__={"itemTitle":"海尔三筒洗衣机洗鞋机","videoUrl":"https:\\u002F\\u002Fvideo-sh.cloudvideocdn.taobao.com\\u002Fabc\\u002Fpublished_mp4_264_hd_taobao.mp4?auth_key=abc\\u0026w=720\\u0026h=720"}</script>' +
  '</body></html>';
const taobaoCandidates = extractVideoCandidates(taobaoHtml);
assert.strictEqual(
  taobaoCandidates[0],
  'https://video-sh.cloudvideocdn.taobao.com/abc/published_mp4_264_hd_taobao.mp4?auth_key=abc&w=720&h=720'
);
assert.strictEqual(extractTaobaoTitle(taobaoHtml), '海尔三筒洗衣机洗鞋机');
assert.strictEqual(isTaobaoBlockedPage('<html><body>请登录后查看 验证码 passport.taobao.com</body></html>'), true);

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
