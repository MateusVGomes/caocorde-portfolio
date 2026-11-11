package com.concorde.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Atualização do APK (o app não está na Play Store): o site publica concorde-android/android.json com a versão e o
 * APK em partes (o Cloudflare só serve arquivos até 25 MB). O app compara com a própria versão, baixa as partes,
 * confere tamanho e SHA-256 e entrega ao instalador do Android, que pede a confirmação da pessoa (o Android não
 * deixa app nenhum se instalar sozinho). Tudo isso fora da thread da tela.
 */
final class Atualizador {
    static final String MANIFESTO = MainActivity.SITE + "/concorde-android/android.json";

    interface Progresso { void pct(int p); }

    private Atualizador() { }

    /** Manifesto se o site tem versão mais nova que esta; null se não. */
    static JSONObject verificar() throws Exception {
        JSONObject m = new JSONObject(new String(baixar(MANIFESTO), "UTF-8"));
        return maior(m.getString("versao"), BuildConfigVersao.NOME) ? m : null;
    }

    /** "0.5.10" > "0.5.4" (número por número, não como texto). */
    static boolean maior(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? Integer.parseInt(x[i].trim()) : 0, q = i < y.length ? Integer.parseInt(y[i].trim()) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    /** Baixa as partes num arquivo só e confere. */
    static File baixarApk(Context c, JSONObject m, Progresso progresso) throws Exception {
        JSONArray partes = m.getJSONArray("partes");
        long tamanho = m.getLong("tamanho"), feito = 0;
        File apk = new File(c.getCacheDir(), "atualizacao.apk");
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try (OutputStream out = new FileOutputStream(apk)) {
            for (int i = 0; i < partes.length(); i++) {
                byte[] b = baixar(MainActivity.SITE + partes.getString(i));
                sha.update(b);
                out.write(b);
                feito += b.length;
                progresso.pct((int) (feito * 100 / Math.max(1, tamanho)));
            }
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : sha.digest()) hex.append(String.format("%02X", b));
        if (feito != tamanho || !hex.toString().equalsIgnoreCase(m.getString("sha256"))) {
            apk.delete();
            throw new Exception("o download veio corrompido — tente de novo");
        }
        return apk;
    }

    /** Entrega o APK ao instalador do Android; a tela "Atualizar este app?" chega pelo {@link Receptor}. */
    static void instalar(Context c, File apk) throws Exception {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int id = pi.createSession(params);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("concorde.apk", 0, apk.length())) {
                byte[] buf = new byte[1 << 16];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                s.fsync(out);
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent volta = PendingIntent.getBroadcast(c, id, new Intent(c, Receptor.class), flags);
            s.commit(volta.getIntentSender());
        }
    }

    private static byte[] baixar(String endereco) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(endereco).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(30000);
        con.setUseCaches(false);
        try {
            if (con.getResponseCode() != 200) throw new Exception("o site respondeu " + con.getResponseCode());
            try (InputStream in = con.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[1 << 16];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return out.toByteArray();
            }
        } finally { con.disconnect(); }
    }

    /** Resposta do instalador: abre a confirmação do Android ("Atualizar este app?" / liberar a instalação). */
    public static class Receptor extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent i) {
            if (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999) != PackageInstaller.STATUS_PENDING_USER_ACTION) return;
            Intent confirmar = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmar == null) return;
            confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(confirmar);
        }
    }
}
