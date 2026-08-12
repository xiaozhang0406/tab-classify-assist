# tab-classify-assist

自动整理浏览器标签页的 Chrome/Edge 扩展：**按域名自动分组 + 重复标签清理 + 会话快照防误关丢失**。

> 这原本是作者「蚕啃树叶式」阅读习惯的解法——后台攒了几十个标签页想一个个啃完，又总怕误关丢失。于是做了这个扩展：分组看清、去重减负、快照兜底。

## 功能

- **自动分组**：后台每 5 分钟扫描并分组同域名标签（可在 Popup 调整间隔）
- **一键分组**：点击扩展图标 → 立即分组
- **去重标签**：去掉 #锚点、?跟踪参数（utm_*、gclid、fbclid 等）后 URL 相同即判重复，自动关闭多余的，**保留最近用过的那一个**
- **会话快照**：每次分组前自动保存，误关后一键恢复，最多留 20 份
- **Chrome / Edge 通用**（都是 Chromium）

## 加载（开发者模式）

### Chrome
1. 地址栏输入 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」→ 选择本文件夹
4. 改代码后点扩展卡片上的刷新按钮

### Edge
1. 地址栏输入 `edge://extensions/`
2. 打开「开发人员模式」
3. 「加载解压缩的扩展」→ 选择本文件夹

## 调试

- Service Worker 日志：扩展卡片 →「Service Worker」链接 → Console
- 快捷调试：在 SW Console 执行 `chrome.tabs.query({})` 查看当前标签

## 技术栈

- Manifest V3
- `chrome.tabs.group()` / `chrome.tabGroups.update()` 创建原生标签组
- `chrome.alarms` 定时触发
- `chrome.storage.local` 持久化会话

## 后续路线

- 二期：按主题/关键词分类（grouper.js 已预留策略切换）
- 三期：轻重缓急优先级排序
