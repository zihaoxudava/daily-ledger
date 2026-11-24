package com.zihaoxudava.dailyledger;

import android.app.Activity;
import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST="appassets.androidplatform.net";
    private static final String DOWNLOADS="https://zihaoxudava.github.io/daily-ledger/downloads/";
    private static final int PICK_FILES=1;
    private static final int EXPORT_FILE=2;
    private static final String APK_MIME="application/vnd.android.package-archive";
    private LedgerStorage storage;
    private WebView web;
    private ValueCallback<Uri[]> filePicker;
    private String exportToken;
    private boolean exportingBackup;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        try { storage=LedgerStorage.get(this); }
        catch (Exception error) {
            TextView message=new TextView(this);
            message.setText("无法打开本机账本。请检查设备可用空间后重新打开。");
            message.setPadding(24,32,24,32);
            setContentView(message);
            return;
        }
        web=new WebView(this);
        setContentView(web);
        WebSettings settings=web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(),"DailyLedgerAndroid");
        web.setWebViewClient(new LocalWeb());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePicker!=null) filePicker.onReceiveValue(null);
                filePicker=callback;
                try { startActivityForResult(params.createIntent(),PICK_FILES); }
                catch (Exception error) {
                    filePicker=null;
                    callback.onReceiveValue(null);
                    toast("找不到可用的照片或文件选择器。");
                }
                return true;
            }
        });
        String debtLedger=getIntent().getStringExtra(DebtAlarmReceiver.EXTRA_LEDGER);
        web.loadUrl("https://"+HOST+"/www/"+(getIntent().getBooleanExtra(DebtAlarmReceiver.EXTRA_DEBTS,false)
            ?"?debtLedger="+Uri.encode(debtLedger==null?"main":debtLedger)+"#debts"
            :getIntent().getBooleanExtra(DailyCheckInReceiver.EXTRA_OPEN,false)?"#records":""));
    }

    @Override protected void onResume() {
        super.onResume();
        if (web!=null) web.evaluateJavascript("window.dispatchEvent(new Event('nativeforeground'))",null);
        if (storage!=null) syncReminders();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (web!=null && intent.getBooleanExtra(DebtAlarmReceiver.EXTRA_DEBTS,false)) {
            String ledger=intent.getStringExtra(DebtAlarmReceiver.EXTRA_LEDGER);
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('nativedebtopen',{detail:"+
                JSONObject.quote(ledger==null?"main":ledger)+"}));",null);
        } else if (web!=null && intent.getBooleanExtra(DailyCheckInReceiver.EXTRA_OPEN,false)) {
            web.evaluateJavascript("if(!document.querySelector('dialog[open]')) location.hash='records';",null);
        }
    }

    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);
        if (request==3 && web!=null) {
            syncReminders();
            web.evaluateJavascript("window.dispatchEvent(new Event('nativeforeground'))",null);
        }
    }

    private void syncReminders() {
        new Thread(()->{
            Context context=getApplicationContext();
            DailyCheckInReceiver.sync(context,false);
            DebtAlarmReceiver.sync(context,false);
        },"ledger-reminders").start();
    }

    @Override public void onBackPressed() {
        if (web==null) { super.onBackPressed(); return; }
        web.evaluateJavascript("(function(){for(const id of ['attachment-preview','quick-category','dialog']){"+
            "const d=document.getElementById(id);if(d&&d.open){if(d.dispatchEvent(new Event('cancel',{cancelable:true})))d.close();return true;}}return false;})()",
            handled->{ if (!"true".equals(handled)) { if (web.canGoBack()) web.goBack(); else finish(); } });
    }

    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (request==PICK_FILES && filePicker!=null) {
            ValueCallback<Uri[]> callback=filePicker;
            filePicker=null;
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));
        }
        if (request==EXPORT_FILE && exportToken!=null) {
            String token=exportToken;
            boolean backup=exportingBackup;
            exportToken=null;
            exportingBackup=false;
            final Uri uri=result==RESULT_OK && data!=null ? data.getData() : null;
            if (uri==null) { storage.discard(token); return; }
            new Thread(()->{
                try (InputStream in=new FileInputStream(storage.staged(token,"download"));
                     OutputStream out=getContentResolver().openOutputStream(uri,"wt")) {
                    if (out==null) throw new IllegalStateException();
                    LedgerStorage.copy(in,out);
                    out.flush();
                    toast("已保存到所选位置。");
                    if (backup) runOnUiThread(()->{
                        if (web!=null) web.evaluateJavascript("window.dispatchEvent(new Event('nativebackupcomplete'))",null);
                    });
                } catch (Exception error) { toast("保存文件失败，请检查空间后重试。"); }
                finally { storage.discard(token); }
            },"ledger-export").start();
        }
    }

    private void toast(String text) {
        runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());
    }

    private void external(Uri url) {
        runOnUiThread(()->{
            try { startActivity(new Intent("tel".equals(url.getScheme())?Intent.ACTION_DIAL:Intent.ACTION_VIEW,url)); }
            catch (Exception error) { toast("设备上没有可打开此链接的应用。"); }
        });
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort()==-1;
    }

    private static WebResourceResponse response(String mime, int status, String reason, InputStream data) {
        Map<String,String> headers=new HashMap<>();
        headers.put("Cache-Control","no-store");
        headers.put("X-Content-Type-Options","nosniff");
        headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
            "img-src 'self' blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
        return new WebResourceResponse(mime,"UTF-8",status,reason,headers,data);
    }

    private static WebResourceResponse missing() {
        return response("text/plain",404,"Not Found",new ByteArrayInputStream(new byte[0]));
    }

    private final class LocalWeb extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri=request.getUrl();
            String path=uri.getPath();
            if (local(uri) && path!=null && path.startsWith("/www/")) return false;
            String scheme=uri.getScheme();
            if (request.isForMainFrame() && request.hasGesture() &&
                ("https".equals(scheme)||"mailto".equals(scheme)||"tel".equals(scheme))) external(uri);
            return true;
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
            Uri uri=request.getUrl();
            if (!local(uri) || !"GET".equals(request.getMethod())) return missing();
            String path=uri.getPath();
            if (path==null) return missing();
            try {
                if (path.equals("/native-update.json")) return updateInfo();
                if (path.startsWith("/ledger-files/"))
                    return response("application/octet-stream",200,"OK",storage.open(path.substring(14)));
                if (!path.startsWith("/www/") || !path.matches("/www/[A-Za-z0-9_.\\-/]*") || path.contains("..")) return missing();
                if (path.endsWith("/")) path+="index.html";
                String mime=path.endsWith(".html")?"text/html":path.endsWith(".js")?"text/javascript":
                    path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":
                    path.endsWith(".webmanifest")?"application/manifest+json":"text/plain";
                return response(mime,200,"OK",getAssets().open(path.substring(1)));
            } catch (Exception error) { return missing(); }
        }
    }

    private WebResourceResponse updateInfo() throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL(DOWNLOADS+"android.json").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Cache-Control","no-cache");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        try {
            if (connection.getResponseCode()!=200) return missing();
            try (InputStream in=connection.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[4096];
                int count;
                while ((count=in.read(buffer))!=-1) {
                    if (out.size()+count>32768) return missing();
                    out.write(buffer,0,count);
                }
                return response("application/json",200,"OK",new ByteArrayInputStream(out.toByteArray()));
            }
        } finally { connection.disconnect(); }
    }

    private interface Operation { Object run() throws Exception; }

    private static String answer(Operation action) {
        try {
            return new JSONObject().put("data",action.run()).toString();
        } catch (Exception error) {
            String text=error.getMessage();
            try {
                return new JSONObject().put("error",text==null?"操作失败，请重试。":text).toString();
            } catch (Exception ignored) { return "{\"error\":\"操作失败\"}"; }
        }
    }

    private void downloadUpdate(int version,boolean automatic) {
        DownloadManager downloads=getSystemService(DownloadManager.class);
        SharedPreferences jobs=getSharedPreferences("update-downloads",MODE_PRIVATE);
        String key=Integer.toString(version);
        long previous=jobs.getLong(key,0);
        try {
            if (previous!=0) {
                Uri apk=downloads.getUriForDownloadedFile(previous);
                if (apk!=null) {
                    if (automatic) return;
                    startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(apk,APK_MIME)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                    return;
                }
                try (Cursor rows=downloads.query(new DownloadManager.Query().setFilterById(previous))) {
                    if (rows!=null && rows.moveToFirst()) {
                        int status=rows.getInt(rows.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        if (status!=DownloadManager.STATUS_FAILED) {
                            if (!automatic) toast("更新包正在下载，完成后可从系统通知安装。");
                            return;
                        }
                    }
                }
                downloads.remove(previous);
            }
            DownloadManager.Request request=new DownloadManager.Request(Uri.parse(DOWNLOADS+"daily-ledger-android.apk?v="+version))
                .setMimeType(APK_MIME).setTitle("日常账本更新")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(this,Environment.DIRECTORY_DOWNLOADS,"daily-ledger-"+version+".apk");
            jobs.edit().putLong(key,downloads.enqueue(request)).apply();
            if (!automatic) toast("已开始下载，完成后从系统通知打开 APK。");
        } catch (Exception error) {
            if (!automatic) toast("无法打开下载或安装窗口，请在系统中查看下载和安装权限。");
        }
    }

    public final class Bridge {
        @JavascriptInterface public boolean paymentPermission() { return PaymentListener.allowed(MainActivity.this); }
        @JavascriptInterface public String pendingPayments() { return answer(()->PaymentListener.pending(MainActivity.this)); }
        @JavascriptInterface public String ackPayments(String ids) {
            return answer(()->{ PaymentListener.acknowledge(MainActivity.this,ids); return true; });
        }
        @JavascriptInterface public void paymentSettings() {
            runOnUiThread(()->{
                try { startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); }
                catch (Exception error) { toast("请在系统设置中搜索通知访问权限。"); }
            });
        }
        @JavascriptInterface public String readBook() { return answer(storage::readBook); }
        @JavascriptInterface public String begin() { return answer(storage::begin); }
        @JavascriptInterface public String append(String token,String id,String content) {
            return answer(()->{ storage.append(token,id,content); return true; });
        }
        @JavascriptInterface public String commit(String token,String book,String sizes) {
            return answer(()->{
                storage.commit(token,book,sizes);
                DailyCheckInReceiver.sync(MainActivity.this,false);
                DebtAlarmReceiver.sync(MainActivity.this,false);
                return true;
            });
        }
        @JavascriptInterface public String readRestoreUndo() { return answer(storage::undoSummary); }
        @JavascriptInterface public String commitRestore(String token,String book,String sizes,String id,String current) {
            return answer(()->{ storage.commit(token,book,sizes,id,current); syncReminders(); return true; });
        }
        @JavascriptInterface public String undoRestore(String id,String nextId,String current) {
            return answer(()->{ storage.undoRestore(id,nextId,current); syncReminders(); return true; });
        }
        @JavascriptInterface public void discard(String token) { storage.discard(token); }
        @JavascriptInterface public int versionCode() {
            try { return getPackageManager().getPackageInfo(getPackageName(),0).versionCode; }
            catch (Exception error) { return Integer.MAX_VALUE; }
        }
        @JavascriptInterface public void openUpdate(int version) {
            if (version>versionCode()) runOnUiThread(()->downloadUpdate(version,false));
        }
        @JavascriptInterface public void prepareUpdate(int version) {
            if (version>versionCode()) runOnUiThread(()->downloadUpdate(version,true));
        }
        @JavascriptInterface public int reminderState() {
            return (DebtAlarmReceiver.enabled(MainActivity.this)?1:0)+(DebtAlarmReceiver.exact(MainActivity.this)?2:0);
        }
        @JavascriptInterface public boolean dailyCheckInAllowed() { return DailyCheckInReceiver.allowed(MainActivity.this); }
        @JavascriptInterface public void reminderSettings(String kind) {
            runOnUiThread(()->{
                try {
                    if ("exact".equals(kind) && Build.VERSION.SDK_INT>=31) {
                        startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));
                    } else if ("notifications".equals(kind)) {
                        SharedPreferences prefs=getPreferences(MODE_PRIVATE);
                        if (Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED &&
                            (!prefs.getBoolean("notification-asked",false) || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))) {
                            prefs.edit().putBoolean("notification-asked",true).apply();
                            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},3);
                        } else startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));
                    }
                } catch (Exception error) { toast("请在系统设置中开启日常账本的通知权限。"); }
            });
        }
        @JavascriptInterface public String exportFile(String token,String name,String mime) {
            return answer(()->{
                File file=storage.staged(token,"download");
                if (!file.isFile()) throw new IllegalStateException("没有可保存的文件。");
                runOnUiThread(()->{
                    if (exportToken!=null) {
                        storage.discard(token);
                        toast("请先完成上一次文件保存。");
                        return;
                    }
                    exportToken=token;
                    exportingBackup="application/zip".equals(mime) && name.startsWith("日常账本-完整备份-");
                    try {
                        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType(mime.contains("/")?mime:"application/octet-stream").putExtra(Intent.EXTRA_TITLE,name);
                        startActivityForResult(intent,EXPORT_FILE);
                    } catch (Exception error) {
                        exportToken=null;
                        exportingBackup=false;
                        storage.discard(token);
                        toast("无法打开系统文件保存窗口。");
                    }
                });
                return true;
            });
        }
    }
}
