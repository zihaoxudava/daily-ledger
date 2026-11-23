# 日常账本

中文个人记账网页 App。可以安装到 iPhone 主屏幕，首次联网加载后支持离线记账。

[在线使用](https://zihaoxudava.github.io/daily-ledger/) · [使用手册](guide/index.html)

## 功能

- 支出、收入、转账和退款，支持同日批量记账、明细搜索和筛选
- 月份总览、月度和年度统计、总预算和分类组预算
- 多账户、期初余额、分类和二级分类
- 按周、月、年重复的账单与分期
- CSV 流水导入导出、JSON 整账本备份和恢复

账目保存在浏览器或主屏幕 App 的 IndexedDB 中。不同设备或网址的账本各自存储。迁移时请从旧账本导出 JSON，再在新地址恢复。

## 本地运行

用静态 HTTP 服务打开应用目录。以 Python 为例，在包含 `index.html` 的目录运行以下命令。

```sh
python -m http.server 8080
```

然后访问 `http://localhost:8080/`。Service Worker 在 HTTPS 和 localhost 环境下工作。

## 部署

把包含 `index.html` 的应用目录作为站点根目录，部署到支持 HTTPS 的静态托管。应用可以放到子路径，例如 GitHub Pages 的项目站点。首次部署后，确认页面显示「离线可用」。

更新应用时，记得同步更新 `sw.js` 中的缓存版本。新增上线资源时也要更新离线资源清单。

## 许可证

项目使用 MIT 许可证。周期日期计算改编自 [Moniflow](https://github.com/choieunsoh/moniflow)，原作者和许可证见应用目录中的 `THIRD-PARTY.txt`。
