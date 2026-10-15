# P00 QA

本文件只标出当前仓库的验收面。它不是签收记录，条目都没有打勾。

## 在范围内

- 双击 `index.html`，或用本地 HTTP 服务器打开仪表盘
- 三个面板：实战任务、学习模块、学习画像
- 进度只在本机 `localStorage`，可以导入 / 导出 JSON
- 任务和模块里的工具链接指向 `https://yuuqq.github.io/<id>-<slug>/`

## 不在范围内

- 站内搜索
- 分类筛选
- 本 ZIP 内打开 50 个工具（那些项目不在这个仓库）

## 怎么验

- `npm run check`：语法和静态合同
- `npm run regression`：Playwright 浏览器回归

首屏 `0/N` 容易被看成空目录。那条文案留给 PR #1，本分支不改英雄区标签。
