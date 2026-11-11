package com.concorde.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Avisos de mensagem no celular. Dois caminhos, o mesmo canal do Android ("Mensagens"):
 *  - app aberto ou em segundo plano: a página chama {@link #mostrar} pela ponte;
 *  - app fechado: o Firebase mostra sozinho o aviso que o servidor manda (ver fcm.js e {@link #tokenFirebase}).
 * A pessoa também pode silenciar o canal nas configurações do Android.
 */
final class Avisos {
    static final String CANAL = "mensagens";

    interface Token { void pronto(String token); }

    private Avisos() { }

    static void criarCanal(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CANAL) != null) return;
        NotificationChannel canal = new NotificationChannel(CANAL, "Mensagens", NotificationManager.IMPORTANCE_HIGH);
        canal.setDescription("Mensagens dos canais e quando alguém te marca");
        nm.createNotificationChannel(canal);
    }

    /** Um aviso por canal do Concorde: a mensagem nova substitui a anterior do mesmo canal. Tocar abre o app. */
    static void mostrar(Context c, String titulo, String texto, int canal) {
        criarCanal(c);
        Intent abrir = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("canal", String.valueOf(canal));
        PendingIntent toque = PendingIntent.getActivity(c, canal, abrir, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CANAL) : new Notification.Builder(c);
        Notification n = b.setSmallIcon(R.drawable.ic_notificacao)
                .setContentTitle(titulo)
                .setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto))
                .setContentIntent(toque)
                .setAutoCancel(true)
                .build();
        c.getSystemService(NotificationManager.class).notify("canal-" + canal, 1, n);
    }

    /**
     * "Endereço" deste aparelho no Firebase (o servidor manda os avisos para ele). null se o APK foi gerado sem o
     * google-services.json (Firebase não configurado): aí só existem os avisos com o app aberto.
     */
    static void tokenFirebase(Token resposta) {
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                    .addOnCompleteListener(t -> resposta.pronto(t.isSuccessful() ? t.getResult() : null));
        } catch (Throwable semFirebase) {
            resposta.pronto(null);
        }
    }
}
