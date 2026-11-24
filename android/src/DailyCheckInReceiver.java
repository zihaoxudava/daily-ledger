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
import android.graphics.BitmapFactory;
import android.net.Uri;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import org.json.JSONArray;
import org.json.JSONObject;

public final class DailyCheckInReceiver extends BroadcastReceiver {
    static final String EXTRA_OPEN="open-daily-check-in";
    private static final String FIRE="com.zihaoxudava.dailyledger.DAILY_CHECK_IN";
    private static final String CHANNEL="daily-check-ins";
    private static final int NOTICE=37;
    private static final LocalTime[] DEFAULT_TIMES={LocalTime.of(9,0),LocalTime.of(13,0),LocalTime.of(20,30)};
    private static final String[] ICONS={"checkin_tea","checkin_book","checkin_sprout"};

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(CHANNEL,Context.MODE_PRIVATE);
    }

    private static JSONObject settings(JSONObject book) {
        return book==null ? null : book.optJSONObject("dailyCheckIn");
    }

    static boolean allowed(Context context) {
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        NotificationChannel channel=manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled() && (channel==null || channel.getImportance()!=NotificationManager.IMPORTANCE_NONE);
    }

    private static LocalTime[] times(JSONObject config) {
        JSONArray input=config==null ? null : config.optJSONArray("times");
        if (input==null || input.length()!=3) return DEFAULT_TIMES;
        try {
            LocalTime[] times=new LocalTime[3];
            for (int i=0;i<times.length;i++) {
                times[i]=LocalTime.parse(input.getString(i));
                if (i>0 && !times[i].isAfter(times[i-1])) return DEFAULT_TIMES;
            }
            return times;
        } catch (Exception error) { return DEFAULT_TIMES; }
    }

    private static Intent alarm(Context context) {
        return new Intent(context,DailyCheckInReceiver.class).setAction(FIRE);
    }

    private static int sent(SharedPreferences preferences,LocalDate today) {
        return today.toString().equals(preferences.getString("date","")) ? preferences.getInt("sent",0) : 0;
    }

    static synchronized void sync(Context context,boolean force) {
        try {
            JSONObject config=settings(LedgerStorage.get(context).readBook());
            boolean enabled=config!=null && config.optBoolean("enabled",false);
            SharedPreferences preferences=prefs(context);
            AlarmManager manager=context.getSystemService(AlarmManager.class);
            NotificationManager notices=context.getSystemService(NotificationManager.class);
            if (enabled && notices.getNotificationChannel(CHANNEL)==null) {
                notices.createNotificationChannel(new NotificationChannel(CHANNEL,"日常记账提醒",NotificationManager.IMPORTANCE_DEFAULT));
            }
            if (!enabled || !allowed(context)) {
                PendingIntent pending=PendingIntent.getBroadcast(context,0,alarm(context),
                    PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);
                if (pending!=null) { manager.cancel(pending); pending.cancel(); }
                notices.cancel(NOTICE);
                preferences.edit().remove("next").apply();
                return;
            }
            LocalDateTime now=LocalDateTime.now();
            LocalDate today=now.toLocalDate();
            LocalTime[] times=times(config);
            int sent=sent(preferences,today);
            int slot=0;
            while (slot<times.length && (!times[slot].isAfter(now.toLocalTime()) || (sent & (1<<slot))!=0)) slot++;
            LocalDate day=slot==times.length ? today.plusDays(1) : today;
            if (slot==times.length) slot=0;
            long target=LocalDateTime.of(day,times[slot]).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
            boolean exact=DebtAlarmReceiver.exact(context);
            if (!force && preferences.getLong("next",0)==target && preferences.getBoolean("exact",false)==exact) return;
            PendingIntent pending=PendingIntent.getBroadcast(context,0,alarm(context).putExtra("slot",slot)
                .putExtra("day",day.toString()).putExtra("time",times[slot].toString()),
                PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            if (exact) {
                try { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,target,pending); }
                catch (SecurityException e) {
                    exact=false;
                    manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,target,pending);
                }
            } else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,target,pending);
            preferences.edit().putLong("next",target).putBoolean("exact",exact).apply();
        } catch (Exception error) {
            android.util.Log.w("DailyLedger","Could not schedule daily check-ins",error);
        }
    }

    private static int activity(JSONObject book,String day) {
        JSONArray rows=book==null?null:book.optJSONArray("entries");
        int activity=0;
        for (int i=rows==null?-1:rows.length()-1;i>=0;i--) {
            JSONObject entry=rows.optJSONObject(i);
            if (entry!=null && day.equals(entry.optString("date"))) {
                activity|="income".equals(entry.optString("type"))?3:1;
                if (activity==3) break;
            }
        }
        return activity;
    }

    static String[] message(int slot,int activity,long day) {
        boolean alternate=day%2==0;
        if (slot==0) return new String[]{
            alternate?"早安，账本也醒啦":"喝口水，再开始今天",
            (activity&2)!=0?"今天先记了一笔收入。有空再补其他账，慢慢来。":"今天有进账的话，顺手记一笔就好。"
        };
        if (slot==1) return new String[]{
            alternate?"午饭吃了吗？":"歇一会儿，顺便看看账",
            activity==0?"饭钱、咖啡或路费，想起来就记一笔。":"今天已经有记录了。刚花的钱，有空再补一笔。"
        };
        return new String[]{
            alternate?"今天的账，记到哪啦？":"今晚给账本收个尾",
            activity==0?"今天还没记账。想起来的先记一笔，剩下的慢慢补。":
                (activity&2)!=0?"今天记了收入。睡前有空，再看看花销有没有漏记。":"今天的账已经有记录了。有漏掉的，补一笔就好。"
        };
    }

    private static synchronized void deliver(Context context,Intent intent) throws Exception {
        JSONObject book=LedgerStorage.get(context).readBook();
        JSONObject config=settings(book);
        if (config==null || !config.optBoolean("enabled",false) || !allowed(context)) return;
        LocalDateTime now=LocalDateTime.now();
        LocalDate today=now.toLocalDate();
        String day=today.toString();
        LocalTime[] times=times(config);
        int slot=intent.getIntExtra("slot",-1);
        SharedPreferences preferences=prefs(context);
        int sent=sent(preferences,today);
        if (slot<0 || slot>=times.length || !day.equals(intent.getStringExtra("day")) ||
            !times[slot].toString().equals(intent.getStringExtra("time")) || (sent & (1<<slot))!=0 ||
            now.toLocalTime().isBefore(times[slot]) ||
            (slot+1<times.length && !now.toLocalTime().isBefore(times[slot+1]))) return;
        int activity=activity(book,day);
        JSONArray ledgers=book==null?null:book.optJSONArray("ledgers");
        for (int i=0;ledgers!=null && i<ledgers.length() && activity!=3;i++) {
            JSONObject ledger=ledgers.optJSONObject(i);
            if (ledger!=null) activity|=activity(ledger.optJSONObject("data"),day);
        }
        String[] copy=message(slot,activity,today.toEpochDay());
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        int picture=context.getResources().getIdentifier(ICONS[slot],"drawable",context.getPackageName());
        Intent open=new Intent(context,MainActivity.class).putExtra(EXTRA_OPEN,true)
            .setData(Uri.parse("daily-ledger://check-in"));
        PendingIntent target=PendingIntent.getActivity(context,2,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder notice=new Notification.Builder(context,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(copy[0]).setContentText(copy[1])
            .setStyle(new Notification.BigTextStyle().bigText(copy[1])).setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(target).setAutoCancel(true);
        if (picture!=0) notice.setLargeIcon(BitmapFactory.decodeResource(context.getResources(),picture));
        manager.notify(NOTICE,notice.build());
        preferences.edit().putString("date",day).putInt("sent",sent | (1<<slot)).apply();
    }

    @Override public void onReceive(Context context,Intent intent) {
        PendingResult result=goAsync();
        new Thread(()->{
            try { if (FIRE.equals(intent.getAction())) deliver(context,intent); }
            catch (Exception error) { android.util.Log.w("DailyLedger","Could not deliver daily check-in",error); }
            finally { sync(context,true); result.finish(); }
        },"ledger-check-in").start();
    }
}
