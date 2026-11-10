# AGENTS.md

运维面试自测题库：131 题，先自己说、再看答案，间隔重复决定下次什么时候出现。
纯前端 + 一个无依赖的 Node 静态服务，没有构建步骤、没有 `package.json`、没有 `node_modules`。

功能、题库构成、加题格式、同步原理都在 [README.md](./README.md)，这里只写**容易踩的坑**。

## 怎么跑

```bash
node server.js              # 或双击 启动题库.cmd，默认 8765
node build-offline.js       # 重新生成离线单文件版
node test/verify_quiz.js    # 题库完整性 + 间隔重复 + 章节口径
node test/verify_app.js     # 前端集成（服务版），加 --offline 跑离线版
```

## 目录

- `public/` 页面本体：`index.html` / `styles.css` / `app.js`（视图与交互）/ `srs.js`（纯函数：规则与队列）
- `public/data/` 题库：`index.json`（章节清单）+ 每章一个 `chNN.json`（该章题目 + 该章选项）
- `public/quiz-offline.html` **生成物**，别手改
- `server.js` 静态托管 + `/api/ping` `/api/info` `/api/sync`
- `test/` 自测脚本，都是手写的断言，没有框架

## 这个项目特有的坑

1. **改了 `public/` 里任何东西之后，必须 `node build-offline.js`。** 离线单文件版把 CSS/JS/题库全内嵌了，不重跑它就是旧的，而它又是发给手机的那份。
2. **`build-offline.js` 里的 `replace` 必须用函数式写法。** 字符串替换里 `$&`、`$1`、`$$` 是特殊符号，`app.js` 的 `const $$` 会被吞成 `const $`，语法直接崩。
3. **颜色只准写 CSS 变量。** 浅色主题只是覆盖 `styles.css` 顶部那批 `--bg` / `--surface` / `--accent`，规则里写死色值，深色下会漏一片。
4. **答题状态不落库。** 页面只存答题事件，当前连击/到期/毕业全部由 `srs.js` 的 `deriveState` 重放算出。想要"记住某个状态"时，请改重放规则，不要另存一份状态——两份数据一定会分叉。
5. **「这题现在能不能练」只有两个出处**：`SRS.buildQueue`（出队列）和 `SRS.chapterProgress`（章节行的"剩 N 题"）。`test/verify_quiz.js` 断言两者相等。页面里不要再自己写一遍 `st.seen && st.due <= now` 的过滤。
6. **事件是只追加的**，两端同步取并集，靠 `id` 去重。不存在"更新/删除事件"的操作，别加。
7. **`scenario` / `acceptance` 不出选择题**，就算章文件的 `mc` 里写了也不会用——选项等于把答案提前给了。
8. **加题只改对应章的 `chNN.json`，新增章才去动 `index.json`。** 题放错文件、选项放错章，`test/verify_quiz.js` 会按 `id` 前缀和 `ch` 字段拦下来。
9. `server.js` 只用 Node 内置模块。**不要为了一个功能引入打包工具或框架**，手机用局域网 HTTP 打开，越简单越不容易坏。

## 提交

- 装了提交前钩子（`.githooks/pre-commit`，靠 `git config core.hooksPath .githooks` 生效）：
  单文件超过 5000 token（约 20 KB）会被拒。**照着报错把文件按功能拆开再提交**，不要用 `--no-verify` 绕。
  题库数据是例外：`public/data/*.json` 上限 100 KB（一章一个文件，整章读完是正常的）；
  哪一章涨到 100 KB，就把它的题目和选项拆成两个文件。
  钩子跳过二进制、锁文件和 `public/quiz-offline.html`（生成物）。
- **写新函数、新规则之前，先搜项目里有没有现成的**——这个项目很小，规则重复写在两处比写错更麻烦。
- 改完跑一遍 `test/` 那两条；改了 `public/` 记得先 `node build-offline.js`。