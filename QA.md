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

## Environment

- **Browser**: Chrome 120+ / Edge / 课堂机房机
- **OS**: Windows / macOS / Linux
- **Date**: 2026-09-07
- **Path**: 学生冷启动（新浏览器、无历史进度）

## Classroom walkthrough

对照 GitHub Pages 实测：打开学习中枢 → 看首屏数字 → 点一条任务链。

### 已验证项

- [x] 页面 HTTP 200，任务卡（地震视频 / 财务造假 / AI 稿）可见
- [x] 首屏 0/15、0/5、0/50 是**本机进度**，不是目录为空
- [x] 本 PR 在数字下方加了说明，避免学生以为平台坏了
- [x] 数据只留在 localStorage

## Known Issues

- **Issue**: 新会话英雄区三个 0 看起来像空目录。
  **Severity**: classroom
  **Status**: 本 PR 已改文案与注释
- **Issue**: 进度不跨设备。机房公共电脑下次会被清掉。
  **Severity**: expected
  **Workaround**: 用「导出数据」带走 JSON

## Sign-Off

- **Classroom bench**: 2026-09-07
- **This PR**: 覆盖「0 工具」误读，不再盖章空白通过
