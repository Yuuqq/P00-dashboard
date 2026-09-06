# P00 QA

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
