package com.concorde.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Por onde sai o som da call (igual o Discord no celular): viva-voz, no ouvido, fone com fio ou Bluetooth.
 * A WebView não deixa a página escolher; aqui o app escolhe pelo AudioManager. A escolha fica guardada e vale
 * de novo a cada call. Ids pelo tipo (não pelo aparelho), para continuar valendo quando o fone reconecta.
 */
final class Som {
    private static final String PREFS = "som", CHAVE = "saida";
    static final String VIVA_VOZ = "viva-voz", OUVIDO = "ouvido", FIO = "fio", BLUETOOTH = "bluetooth";

    private Som() { }

    /** [{ id, nome }] do que está disponível agora, mais a escolha atual. */
    static JSONObject lista(Context c) throws JSONException {
        AudioManager am = c.getSystemService(AudioManager.class);
        JSONArray l = new JSONArray();
        boolean fio = false, bt = false, ouvido = true;
        String nomeBt = null;
        if (Build.VERSION.SDK_INT >= 31) {
            ouvido = false;
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                String id = idDe(d.getType());
                if (OUVIDO.equals(id)) ouvido = true;
                else if (FIO.equals(id)) fio = true;
                else if (BLUETOOTH.equals(id)) { bt = true; if (nomeBt == null && d.getProductName() != null) nomeBt = d.getProductName().toString(); }
            }
        } else {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                String id = idDe(d.getType());
                if (FIO.equals(id)) fio = true;
                else if (BLUETOOTH.equals(id)) { bt = true; if (nomeBt == null && d.getProductName() != null) nomeBt = d.getProductName().toString(); }
            }
        }
        l.put(item(VIVA_VOZ, "Viva-voz (alto-falante)"));
        if (ouvido) l.put(item(OUVIDO, "No ouvido (como ligação)"));
        if (fio) l.put(item(FIO, "Fone com fio"));
        if (bt) l.put(item(BLUETOOTH, "Bluetooth" + (nomeBt != null && !nomeBt.isEmpty() ? ": " + nomeBt : "")));
        return new JSONObject().put("lista", l).put("atual", escolhida(c));
    }

    private static JSONObject item(String id, String nome) throws JSONException {
        return new JSONObject().put("id", id).put("nome", nome);
    }

    private static String idDe(int tipo) {
        switch (tipo) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return VIVA_VOZ;
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return OUVIDO;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET: return FIO;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case 26 /* TYPE_BLE_HEADSET (Android 12) */: return BLUETOOTH;
            default: return null;
        }
    }

    /** Padrão: viva-voz (igual o Discord); se tem fone ligado, o Android já manda para ele. */
    static String escolhida(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CHAVE, VIVA_VOZ);
    }

    static void escolher(Context c, String id, boolean naCall) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putString(CHAVE, id).apply();
        if (naCall) aplicar(c);
    }

    /** Entrou na call (ou trocou a saída no meio): manda o som para a saída escolhida. */
    static void aplicar(Context c) {
        AudioManager am = c.getSystemService(AudioManager.class);
        String id = escolhida(c);
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if (Build.VERSION.SDK_INT >= 31) {
            AudioDeviceInfo alvo = null;
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices())
                if (id.equals(idDe(d.getType()))) { alvo = d; break; }
            if (alvo != null) am.setCommunicationDevice(alvo);
            else am.clearCommunicationDevice();   // fone escolhido não está ligado: o Android decide
            return;
        }
        // Android 8 a 11: só dá para ligar/desligar o viva-voz e o Bluetooth (SCO).
        if (BLUETOOTH.equals(id)) {
            am.setSpeakerphoneOn(false);
            am.startBluetoothSco();
            am.setBluetoothScoOn(true);
        } else {
            if (am.isBluetoothScoOn()) { am.setBluetoothScoOn(false); am.stopBluetoothSco(); }
            am.setSpeakerphoneOn(VIVA_VOZ.equals(id));
        }
    }

    /** Saiu da call: devolve o som ao normal (música e vídeos voltam a tocar onde tocavam). */
    static void soltar(Context c) {
        AudioManager am = c.getSystemService(AudioManager.class);
        if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
        else {
            if (am.isBluetoothScoOn()) { am.setBluetoothScoOn(false); am.stopBluetoothSco(); }
            am.setSpeakerphoneOn(false);
        }
        am.setMode(AudioManager.MODE_NORMAL);
    }
}
