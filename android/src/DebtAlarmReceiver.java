package com.zihaoxudava.dailyledger;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public final class DebtAlarmReceiver extends BroadcastReceiver {
    static final String EXTRA_DEBTS="open-debts";
    static final String EXTRA_LEDGER="debt-ledger";
    private static final String FIRE="com.zihaoxudava.dailyledger.DEBT_REMINDER";
    private static final String CHANNEL="debt-reminders";
    private static final int NOTICE=1;
    private static final long DAY=86_400_000L;

    private static final class Reminder {
        final String id, dateTime, ledger;
        final boolean lent;
        final long at;

        Reminder(String ledger,JSONObject debt,JSONObject config) throws Exception {
            this.ledger=ledger;
            id=("main".equals(ledger)?"":ledger+"~")+debt.getString("id");
            dateTime=config.getString("date")+"T"+config.getString("time");
            lent="lent".equals(debt.getString("direction"));
            at=LocalDateTime.parse(dateTime).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        }
    }

    private static Map<String,Reminder> current(Context context) throws Exception {
        Map<String,Reminder> reminders=new HashMap<>();
        JSONObject book=LedgerStorage.get(context).readBook();
        if (book==null) return reminders;
        collect("main",book,reminders);
        JSONArray ledgers=book.optJSONArray("ledgers");
        for (int i=0;ledgers!=null && i<ledgers.length();i++) {
            JSONObject ledger=ledgers.getJSONObject(i);
            collect(ledger.getString("id"),ledger.getJSONObject("data"),reminders);
        }
        return reminders;
    }

    private static void collect(String ledger,JSONObject book,Map<String,Reminder> reminders) throws Exception {
        JSONArray debts=book.getJSONArray("debts");
        for (int i=0;i<debts.length();i++) {
            JSONObject debt=debts.getJSONObject(i);
            JSONObject config=debt.optJSONObject("reminder");
            if (config==null) continue;
            long remaining=debt.getLong("amount");
            JSONArray payments=debt.getJSONArray("payments");
            for (int j=0;j<payments.length();j++) remaining-=payments.getJSONObject(j).getLong("amount");
            if (remaining>0) {
                Reminder reminder=new Reminder(ledger,debt,config);
                reminders.put(reminder.id,reminder);
            }
        }
    }

    private static PendingIntent alarm(Context context,String id) {
        Intent intent=new Intent(context,DebtAlarmReceiver.class).setAction(FIRE)
            .setData(Uri.fromParts("daily-ledger-reminder",id,null));
        return PendingIntent.getBroadcast(context,0,intent,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("debt-alarms",Context.MODE_PRIVATE);
    }

    static boolean exact(Context context) {
        return Build.VERSION.SDK_INT<31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    static boolean enabled(Context context) {
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        NotificationChannel channel=manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled() && (channel==null || channel.getImportance()!=NotificationManager.IMPORTANCE_NONE);
    }

    static synchronized void sync(Context context,boolean force) {
        try {
            Map<String,Reminder> next=current(context);
            SharedPreferences prefs=preferences(context);
            Set<String> previous=prefs.getStringSet("ids",new HashSet<>());
            SharedPreferences.Editor edit=prefs.edit().putStringSet("ids",new HashSet<>(next.keySet()));
            AlarmManager alarms=context.getSystemService(AlarmManager.class);
            NotificationManager notices=context.getSystemService(NotificationManager.class);
            boolean exact=exact(context), enabled=enabled(context);
            force=force || exact!=prefs.getBoolean("exact",false) || enabled!=prefs.getBoolean("enabled",false);
            long now=System.currentTimeMillis();
            for (String id:previous) {
                if (next.containsKey(id)) continue;
                alarms.cancel(alarm(context,id));
                notices.cancel(id,NOTICE);
                edit.remove("at:"+id).remove("sent:"+id);
            }
            for (Reminder item:next.values()) {
                long before=prefs.getLong("at:"+item.id,0);
                if (before!=0 && before!=item.at) {
                    alarms.cancel(alarm(context,item.id));
                    notices.cancel(item.id,NOTICE);
                    edit.remove("at:"+item.id);
                }
                if (item.dateTime.equals(prefs.getString("sent:"+item.id,""))) continue;
                if (item.at<=now && (before!=item.at || now-item.at>DAY)) continue;
                if (!force && before==item.at) continue;
                PendingIntent pending=alarm(context,item.id);
                long trigger=Math.max(now+1000,item.at);
                if (exact) {
                    try { alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,trigger,pending); }
                    catch (SecurityException revoked) { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,trigger,pending); }
                } else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,trigger,pending);
                edit.putLong("at:"+item.id,item.at);
            }
            edit.putBoolean("exact",exact).putBoolean("enabled",enabled).apply();
        } catch (Exception error) {
            android.util.Log.w("DailyLedger","Could not reconcile debt reminders",error);
        }
    }

    @Override public void onReceive(Context context,Intent intent) {
        if (!FIRE.equals(intent.getAction())) {
            sync(context,true);
            return;
        }
        Uri uri=intent.getData();
        if (uri!=null) notifyDue(context,uri.getSchemeSpecificPart());
    }

    private static synchronized void notifyDue(Context context,String id) {
        try {
            Reminder item=current(context).get(id);
            if (item==null || item.at>System.currentTimeMillis() || !enabled(context)) return;
            SharedPreferences prefs=preferences(context);
            if (item.dateTime.equals(prefs.getString("sent:"+id,""))) return;
            NotificationManager manager=context.getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL,"借款与还款提醒",NotificationManager.IMPORTANCE_DEFAULT));
            Intent open=new Intent(context,MainActivity.class).putExtra(EXTRA_DEBTS,true)
                .putExtra(EXTRA_LEDGER,item.ledger).setData(Uri.fromParts("daily-ledger-debt",item.id,null));
            PendingIntent target=PendingIntent.getActivity(context,1,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
            String title=item.lent?"收款提醒":"还款提醒";
            Notification notice=new Notification.Builder(context,CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title)
                .setContentText("有一项借款到了提醒时间。打开日常账本查看。")
                .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(target).setAutoCancel(true).build();
            manager.notify(id,NOTICE,notice);
            prefs.edit().putString("sent:"+id,item.dateTime).apply();
        } catch (Exception error) {
            android.util.Log.w("DailyLedger","Could not deliver debt reminder",error);
        }
    }
}
