package com.zihaoxudava.dailyledger;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public final class PaymentListener extends NotificationListenerService {
    private static final Pattern MONEY=Pattern.compile(
        "[¥￥]\\s*([0-9][0-9,]{0,14}(?:\\.[0-9]{1,2})?)(?![0-9.])|(?<![0-9.,])([0-9][0-9,]{0,14}(?:\\.[0-9]{1,2})?)\\s*元");
    private static final Pattern PAYMENT=Pattern.compile(
        "支付成功|付款成功|扣款成功|成功支付|成功付款|付款金额|支付金额|支出金额|微信支付凭证|支付宝付款凭证");
    private static final Pattern OTHER=Pattern.compile(
        "收款|退款|转入|到账|验证码|红包|返现|待支付|待付款|支付失败|付款失败|撤销|取消支付|优惠|积分");

    static long paymentAmount(String message) {
        if (!PAYMENT.matcher(message).find() || OTHER.matcher(message).find()) return 0;
        Matcher match=MONEY.matcher(message);
        long amount=0;
        while (match.find()) {
            String raw=match.group(1)!=null?match.group(1):match.group(2);
            try {
                long value=new BigDecimal(raw.replace(",","")).movePointRight(2).longValueExact();
                if (value<=0 || value>9_999_999_999L || amount!=0 && amount!=value) return 0;
                amount=value;
            } catch (ArithmeticException | NumberFormatException error) { return 0; }
        }
        return amount;
    }

    static boolean allowed(Context context) {
        String enabled=Settings.Secure.getString(context.getContentResolver(),"enabled_notification_listeners");
        if (enabled==null) return false;
        ComponentName own=new ComponentName(context,PaymentListener.class);
        for (String item:enabled.split(":")) if (own.equals(ComponentName.unflattenFromString(item))) return true;
        return false;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("payment-capture",Context.MODE_PRIVATE);
    }

    static synchronized JSONArray pending(Context context) throws Exception {
        return new JSONArray(prefs(context).getString("pending","[]"));
    }

    static synchronized void acknowledge(Context context,String json) throws Exception {
        JSONArray ids=new JSONArray(json), remaining=new JSONArray(), queue=pending(context);
        HashSet<String> sent=new HashSet<>();
        for (int i=0;i<ids.length();i++) sent.add(ids.getString(i));
        for (int i=0;i<queue.length();i++) {
            JSONObject event=queue.getJSONObject(i);
            if (!sent.contains(event.getString("id"))) remaining.put(event);
        }
        if (!prefs(context).edit().putString("pending",remaining.toString()).commit()) {
            throw new IllegalStateException("暂时无法更新自动记账队列。");
        }
    }

    private static synchronized void enqueue(Context context,String source,StatusBarNotification notification,long amount) throws Exception {
        JSONObject root=LedgerStorage.get(context).readBook();
        JSONObject config=root==null?null:root.optJSONObject("autoCapture");
        if (config==null || !config.optBoolean("enabled") || config.optString(source).isEmpty()) return;
        SharedPreferences preferences=prefs(context);
        String key=UUID.nameUUIDFromBytes(notification.getKey().getBytes(StandardCharsets.UTF_8)).toString();
        long time=notification.getPostTime();
        JSONObject recent=new JSONObject(preferences.getString("recent","{}")), next=new JSONObject();
        java.util.Iterator<String> keys=recent.keys();
        while (keys.hasNext()) {
            String id=keys.next();
            long previous=recent.optLong(id);
            if (time-previous<120_000L) next.put(id,previous);
        }
        String dedup=key+"-"+amount;
        if (next.has(dedup) && Math.abs(time-next.getLong(dedup))<8_000L) return;
        next.put(dedup,time);
        JSONArray queue=pending(context);
        String id="auto_"+UUID.nameUUIDFromBytes((dedup+"-"+time).getBytes(StandardCharsets.UTF_8));
        queue.put(new JSONObject().put("id",id).put("source",source).put("amount",amount).put("at",time)
            .put("ledger",config.getString("ledger")).put("account",config.getString(source)));
        preferences.edit().putString("pending",queue.toString()).putString("recent",next.toString()).commit();
    }

    @Override public void onNotificationPosted(StatusBarNotification event) {
        String source;
        switch (event.getPackageName()) {
            case "com.tencent.mm": source="wechat"; break;
            case "com.eg.android.AlipayGphone": source="alipay"; break;
            default: return;
        }
        Notification notification=event.getNotification();
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY)!=0 || notification.extras==null) return;
        String title=String.valueOf(notification.extras.getCharSequence(Notification.EXTRA_TITLE,""));
        String text=String.valueOf(notification.extras.getCharSequence(Notification.EXTRA_TEXT,""));
        String expanded=String.valueOf(notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT,""));
        long amount=paymentAmount(title+"\n"+text+"\n"+expanded);
        if (amount==0) return;
        try { enqueue(getApplicationContext(),source,event,amount); }
        catch (Exception ignored) { android.util.Log.w("DailyLedger","Unable to save a payment notification"); }
    }
}
