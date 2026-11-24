# 日常账本

中文个人记账网页 App。可通过支持安装的浏览器添加到手机、平板和电脑桌面，首次联网加载后支持离线记账。

[在线使用](https://zihaoxudava.github.io/daily-ledger/) · [下载 Android 安装包](https://zihaoxudava.github.io/daily-ledger/downloads/daily-ledger-android.apk) · [使用手册](guide/index.html)

## 功能

- 支出、收入、转账和退款，支持同日批量记账、选填时间、明细搜索和筛选
- 月份总览、月度和年度统计及账单明细、总预算和分类组预算
- 定期存款计划，按天计算应存、待存和实存
- 多账户、期初余额、分类和二级分类，记账时可直接添加分类
- 独立记录借出、借入和分次还款，单独统计待收回和待归还金额
- 按周、月、年重复的账单与分期
- 备注可加照片和文件，CSV 导入导出流水，JSON 备份和恢复账本及附件
- 独立账本，各自管理流水、账户、分类和预算
- 各页面可设置独立壁纸，支持图片、动图或静音视频
- Android 版可在授权后识别微信与支付宝付款通知
- 首页每 30 天提醒导出完整备份

网页账目保存在浏览器或主屏幕 App 的 IndexedDB 中。Android 安装版使用应用私有目录存储。跨设备、跨网址或迁入安装版时，先导出完整 JSON，再恢复到目标账本。

## 本地运行

用静态 HTTP 服务打开应用目录。以 Python 为例，在包含 `index.html` 的目录运行以下命令。

```sh
python -m http.server 8080
```

然后访问 `http://localhost:8080/`。Service Worker 在 HTTPS 和 localhost 环境下工作。

## 部署

把包含 `index.html` 的应用目录作为站点根目录，部署到支持 HTTPS 的静态托管。应用可以放到子路径，例如 GitHub Pages 的项目站点。首次部署后，确认页面显示「离线可用」。

发布新版时，在 `releases.js` 顶部添加新版本号、简短标题和用户可见的改动，同时更新 `sw.js` 的缓存版本和使用手册的版本号。新增上线资源时也要更新离线资源清单。

Android 安装版的构建和升级步骤见 [Android 构建说明](android/README.md)。

## 许可证

项目使用 MIT 许可证。周期日期计算改编自 [Moniflow](https://github.com/choieunsoh/moniflow)，原作者和许可证见应用目录中的 `THIRD-PARTY.txt`。
