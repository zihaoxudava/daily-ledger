# 日常账本 Android 安装版

支持 Android 8 及以上。界面文件随 APK 打包，由 Android System WebView 在 App 内渲染。账本和附件使用 Android 应用私有目录。Android 版和网页使用同一个完整 JSON 备份格式。

联网打开或回到 App 时会读取 GitHub Pages 的 `downloads/android.json`。若发现更高的版本号，用户可从顶部查看改动并下载 APK，通过系统界面确认覆盖安装。

## 发布

需要 JDK 17、Android SDK Platform 35、Build Tools 35。准备私有 PKCS12 签名库，别名为 `daily-ledger`，通过 `LEDGER_SIGNING_PASSWORD` 环境变量提供口令。

`build.ps1` 需要 JDK 目录、`android.jar` 路径、Build Tools 目录、临时构建目录、签名库路径、输出 APK 路径、版本名和递增的版本号。构建后会检查 APK 签名。

将新 APK 放到 `downloads/daily-ledger-android.apk`，同时更新 `downloads/android.json` 中的版本、版本号和更新说明。每次使用同一应用 ID 和签名库，用户才能覆盖安装。签名库及口令应保存在仓库外，并安全留存备份。
