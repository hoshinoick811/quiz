/* 生成单文件离线版：把 CSS / JS / 题库全部内联进一个 html
 * 用途：手机在没有同网段、也没有 HTTPS 的情况下（Service Worker 注册不了）
 *      也能打开答题，记录存本地，回到网段再同步。
 * 用法：node build-offline.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'quiz-offline.html');

const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const srs = read('srs.js');
const app = read('app.js');
const bank = read(path.join('data', 'questions.json'));
const mc = read(path.join('data', 'mc.json'));

const banner = `
  <div class="card offline-note">
    <b>离线单文件版</b><br>
    页面完全在手机本地运行，不需要网络。<br>
    要和电脑同步，去「设置」把<b>同步地址</b>填成 <code>http://电脑IP:8765</code>，
    并在同一 WiFi 下点「立即同步」。
  </div>
`;

// 注意：字符串里如果出现 </script 会提前闭合，这里保险起见做转义
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

let out = html;

// 1) 内联样式，去掉 manifest
//    注意：必须用函数式替换。字符串替换里 $&、$1、$$ 都是特殊符号，
//    app.js 里的 `const $$` 会被吞成 `const $`，直接毁掉语法。
out = out.replace(
  '<link rel="manifest" href="./manifest.webmanifest" />',
  () => ''
);
out = out.replace(
  '<link rel="stylesheet" href="./styles.css" />',
  () => '<style>\n' + css + '\n</style>'
);

// 2) 首页插一条离线版提示
out = out.replace(
  '    <section class="view" id="view-home">',
  () => '    <section class="view" id="view-home">\n' + banner
);

// 3) 内联题库 + 逻辑
const scripts = `
<script>window.__QUIZ_EMBEDDED__ = ${safe(bank)};</script>
<script>window.__QUIZ_MC__ = ${safe(mc)};</script>
<script>${safe(srs)}</script>
<script>${safe(app)}</script>
`;
out = out.replace(
  '<script src="./srs.js"></script>\n<script src="./app.js"></script>',
  () => scripts
);

if (out.includes('src="./app.js"') || out.includes('href="./styles.css"')) {
  console.error('内联失败：替换没有全部命中');
  process.exit(1);
}

fs.writeFileSync(OUT, out, 'utf8');
const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`已生成 ${OUT}  (${kb} KB)`);
