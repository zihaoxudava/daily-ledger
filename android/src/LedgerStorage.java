package com.zihaoxudava.dailyledger;

import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;

final class LedgerStorage {
    private static LedgerStorage instance;
    private final AtomicFile ledger;
    private final File attachments;
    private final File staging;
    private JSONObject loaded;

    static synchronized LedgerStorage get(android.content.Context context) throws IOException {
        if (instance==null) instance=new LedgerStorage(context.getFilesDir(),context.getCacheDir());
        return instance;
    }

    private LedgerStorage(File filesDir, File cacheDir) throws IOException {
        ledger = new AtomicFile(new File(filesDir, "ledger.json"));
        attachments = new File(filesDir, "attachments");
        staging = new File(cacheDir, "ledger-staging");
        ensureDirectory(attachments);
        ensureDirectory(staging);
        File[] leftovers = staging.listFiles();
        if (leftovers != null) for (File file : leftovers) deleteStage(file);
    }

    private static void ensureDirectory(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法打开应用存储。");
    }

    private static void checkId(String id) throws IOException {
        if (!id.matches("[A-Za-z0-9_-]{1,100}")) throw new IOException("附件编号无效。");
    }

    private static void checkToken(String token) throws IOException {
        if (!token.matches("[a-f0-9-]{36}")) throw new IOException("附件暂存编号无效。");
    }

    private JSONObject state() throws Exception {
        if (loaded == null) {
            if (ledger.getBaseFile().exists() || new File(ledger.getBaseFile().getPath()+".bak").exists()) {
                loaded = new JSONObject(new String(ledger.readFully(), StandardCharsets.UTF_8));
                loaded.getJSONObject("book");
                loaded.getJSONObject("paths");
            } else {
                loaded = new JSONObject().put("paths", new JSONObject());
            }
        }
        return loaded;
    }

    synchronized JSONObject readBook() throws Exception {
        return state().optJSONObject("book");
    }

    synchronized String begin() throws IOException {
        String token = UUID.randomUUID().toString();
        ensureDirectory(new File(staging, token));
        return token;
    }

    synchronized void append(String token, String id, String encoded) throws IOException {
        File file = staged(token, id);
        if (!file.getParentFile().isDirectory() || encoded.length() > 262144) throw new IOException("暂存内容无效。");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        try (FileOutputStream out = new FileOutputStream(file, true)) {
            out.write(bytes);
        }
    }

    synchronized File staged(String token, String id) throws IOException {
        checkToken(token);
        checkId(id);
        return new File(new File(staging, token), id);
    }

    synchronized FileInputStream open(String id) throws Exception {
        checkId(id);
        String name = state().getJSONObject("paths").getString(id);
        checkId(name);
        return new FileInputStream(new File(attachments,name));
    }

    synchronized JSONObject undoSummary() throws Exception {
        JSONObject undo=state().optJSONObject("undo");
        return undo==null ? null : new JSONObject().put("id",undo.getString("id")).put("book",undo.getJSONObject("book"));
    }

    private JSONObject snapshot(String id, JSONObject book) throws Exception {
        return new JSONObject().put("id",id).put("book",book).put("paths",state().getJSONObject("paths"));
    }

    synchronized void undoRestore(String expected, String newId, String current) throws Exception {
        JSONObject previous=state().optJSONObject("undo");
        if (previous==null || !expected.equals(previous.getString("id"))) throw new IOException("恢复记录已变化，请重新查看。");
        JSONObject next=new JSONObject().put("book",previous.getJSONObject("book"))
            .put("paths",previous.getJSONObject("paths")).put("undo",snapshot(newId,new JSONObject(current)));
        persist(next);
        cleanAttachments(next);
    }

    synchronized void commit(String token, String body, String fileSizes) throws Exception {
        commit(token,body,fileSizes,null,null);
    }

    synchronized void commit(String token, String body, String fileSizes,String undoId,String current) throws Exception {
        checkToken(token);
        JSONObject nextBook = new JSONObject(body);
        JSONObject sizes = new JSONObject(fileSizes);
        JSONObject oldPaths = state().getJSONObject("paths");
        JSONObject paths = new JSONObject();
        Set<String> promoted = new HashSet<>();
        try {
            for (Iterator<String> keys=sizes.keys(); keys.hasNext();) {
                String id=keys.next();
                checkId(id);
                long size=sizes.getLong(id);
                File candidate=staged(token,id);
                String name=oldPaths.optString(id);
                if (candidate.isFile()) {
                    if (candidate.length()!=size) throw new IOException("附件不完整。");
                    name=UUID.randomUUID().toString();
                    File target=new File(attachments,name);
                    try (FileInputStream in=new FileInputStream(candidate);
                         FileOutputStream out=new FileOutputStream(target)) {
                        promoted.add(name);
                        copy(in,out);
                        out.getFD().sync();
                    }
                }
                checkId(name);
                File file=new File(attachments,name);
                if (!file.isFile() || file.length()!=size) throw new IOException("找不到完整附件，请重新添加。");
                paths.put(id,name);
            }
            JSONObject undo=undoId==null ? state().optJSONObject("undo") : snapshot(undoId,new JSONObject(current));
            JSONObject next=new JSONObject().put("book",nextBook).put("paths",paths).put("undo",undo);
            persist(next);
        } catch (Exception error) {
            for (String name:promoted) new File(attachments,name).delete();
            throw error;
        }
        cleanAttachments(loaded);
    }

    private void persist(JSONObject next) throws Exception {
        FileOutputStream out=ledger.startWrite();
        try {
            out.write(next.toString().getBytes(StandardCharsets.UTF_8));
            ledger.finishWrite(out);
        } catch (Exception error) {
            ledger.failWrite(out);
            throw error;
        }
        loaded=next;
    }

    private static void keepPaths(JSONObject paths, Set<String> keep) {
        for (Iterator<String> keys=paths.keys(); keys.hasNext();) keep.add(paths.optString(keys.next()));
    }

    private void cleanAttachments(JSONObject next) throws Exception {
        Set<String> keep=new HashSet<>();
        keepPaths(next.getJSONObject("paths"),keep);
        JSONObject undo=next.optJSONObject("undo");
        if (undo!=null) keepPaths(undo.getJSONObject("paths"),keep);
        File[] files=attachments.listFiles();
        if (files!=null) for (File file:files) {
            if (file.isFile() && !keep.contains(file.getName())) file.delete();
        }
    }

    synchronized void discard(String token) {
        try { checkToken(token); deleteStage(new File(staging,token)); }
        catch (IOException ignored) {}
    }

    private static void deleteStage(File directory) {
        File[] files=directory.listFiles();
        if (files!=null) for (File file:files) file.delete();
        directory.delete();
    }

    static void copy(java.io.InputStream in, java.io.OutputStream out) throws IOException {
        byte[] buffer=new byte[64*1024];
        int count;
        while ((count=in.read(buffer))!=-1) out.write(buffer,0,count);
    }
}
