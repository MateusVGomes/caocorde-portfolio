package com.concorde.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Serviço em primeiro plano ("Concorde — na call"): sem ele o Android corta o microfone quando o app sai da tela,
 * e a captura de tela (MediaProjection) só pode começar com ele rodando com o tipo mediaProjection.
 */
public class ServicoCall extends Service {
    static final String EXTRA_CALL = "call", EXTRA_TELA = "tela";
    private static final String CANAL = "call";

    /** Roda depois que o serviço já está em primeiro plano com a captura de tela liberada. */
    static volatile Runnable aoLiberarTela;

    static void atualizar(Context ctx, boolean call, boolean tela) {
        Intent i = new Intent(ctx, ServicoCall.class).putExtra(EXTRA_CALL, call).putExtra(EXTRA_TELA, tela);
        if (!call && !tela) { ctx.stopService(i); return; }
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        boolean call = intent != null && intent.getBooleanExtra(EXTRA_CALL, false);
        boolean tela = intent != null && intent.getBooleanExtra(EXTRA_TELA, false);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CANAL) == null)
            nm.createNotificationChannel(new NotificationChannel(CANAL, "Call em andamento", NotificationManager.IMPORTANCE_LOW));

        PendingIntent abrir = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CANAL) : new Notification.Builder(this);
        Notification n = b.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Caocorde")
                .setContentText(tela ? "Transmitindo a tela" : "Na call")
                .setContentIntent(abrir)
                .setOngoing(true)
                .build();

        if (Build.VERSION.SDK_INT >= 29) {
            int tipos = 0;
            if (call) tipos |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            if (tela) tipos |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
            try {
                startForeground(1, n, tipos);
            } catch (RuntimeException semPermissao) {
                // Sem permissão de microfone (ou o Android recusou o tipo): segue só com a tela, ou sem tipo.
                if (!tela) { stopSelf(); return START_NOT_STICKY; }
                startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            }
        } else {
            startForeground(1, n);
        }
        Runnable r = aoLiberarTela;
        if (tela && r != null) { aoLiberarTela = null; r.run(); }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
