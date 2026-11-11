package com.concorde.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

/**
 * O Concorde no celular: a mesma página do site numa WebView (atualiza sozinha junto com o site), mais o que
 * a WebView não faz sozinha — pedir microfone/câmera, escolher arquivo para o chat, manter a call viva em
 * segundo plano e compartilhar a tela (ver {@link Ponte} e {@link Transmissao}).
 */
public class MainActivity extends Activity {
    static final String SITE = "https://concorde.SEU-SUBDOMINIO.workers.dev";
    static final String INICIO = SITE + "/";
    /** Endereço antigo (links de convite mandados antes do 0.5): vira o mesmo caminho no endereço novo. */
    static final String ANTIGO = "https://telinha.SEU-SUBDOMINIO.workers.dev";

    private static final int PEDIR_PERMISSOES = 1, ESCOLHER_ARQUIVO = 2, PEDIR_TELA = 3;

    WebView web;
    private Ponte ponte;
    private ValueCallback<Uri[]> escolhaArquivo;
    private PermissionRequest pedidoPendente;

    @Override
    protected void onCreate(Bundle salvo) {
        super.onCreate(salvo);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#17110C"));
        // A WebView ignora o próprio padding: o recuo das barras vai numa moldura em volta dela.
        FrameLayout moldura = new FrameLayout(this);
        moldura.setBackgroundColor(Color.parseColor("#17110C"));
        moldura.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(moldura);
        // Android 15 desenha o app por baixo da barra de status, da barra de navegação e do teclado (edge-to-edge
        // obrigatório): sem esse recuo o topo da página e a caixa de mensagem ficavam escondidos/desalinhados.
        if (Build.VERSION.SDK_INT >= 35) {
            moldura.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // som da call e das mensagens de voz sem precisar tocar antes
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " ConcordeAndroid/" + BuildConfigVersao.NOME);
        CookieManager.getInstance().setAcceptCookie(true);

        ponte = new Ponte(this);
        web.addJavascriptInterface(ponte, "ConcordeAndroidPonte");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (SITE.equals(u.getScheme() + "://" + u.getHost())) return false;
                // Links de fora (YouTube, sites mandados no chat) abrem no navegador — a ponte só fica no nosso site.
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignorado) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest pedido) {
                runOnUiThread(() -> permitirMidia(pedido));
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (escolhaArquivo != null) escolhaArquivo.onReceiveValue(null);
                escolhaArquivo = callback;
                try {
                    startActivityForResult(params.createIntent(), ESCOLHER_ARQUIVO);
                } catch (Exception e) {
                    escolhaArquivo = null;
                    return false;
                }
                return true;
            }
        });

        // Notificação da call (Android 13+) e microfone logo de cara, igual o primeiro uso no Discord.
        List<String> faltam = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            faltam.add(Manifest.permission.POST_NOTIFICATIONS);
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            faltam.add(Manifest.permission.RECORD_AUDIO);
        if (!faltam.isEmpty()) requestPermissions(faltam.toArray(new String[0]), 0);

        Avisos.criarCanal(this);
        // Aberto tocando num aviso (o do Firebase traz o canal nos extras; o nosso também).
        if (getIntent() != null) ponte.canalPendente = getIntent().getStringExtra("canal");

        Uri link = doConcorde(getIntent() != null ? getIntent().getData() : null);
        web.loadUrl(link != null ? link.toString() : INICIO);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String canal = intent.getStringExtra("canal");
        if (canal != null) ponte.abrirCanal(canal);
        Uri link = doConcorde(intent.getData());
        if (link != null) web.loadUrl(link.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        ponte.segundoPlano(false);
    }

    @Override
    protected void onPause() {
        ponte.segundoPlano(true);
        super.onPause();
    }

    /** Link do Concorde (endereço novo, ou o antigo convertido para o novo); null se for de outro site. */
    private static Uri doConcorde(Uri link) {
        if (link == null) return null;
        String origem = link.getScheme() + "://" + link.getHost();
        if (SITE.equals(origem)) return link;
        if (ANTIGO.equals(origem)) return Uri.parse(SITE + link.getEncodedPath() + (link.getEncodedQuery() != null ? "?" + link.getEncodedQuery() : ""));
        return null;
    }

    /** A página pediu microfone/câmera: só para o nosso site, e pedindo a permissão do Android antes se precisar. */
    private void permitirMidia(PermissionRequest pedido) {
        Uri origem = pedido.getOrigin();
        if (origem == null || !SITE.equals(origem.getScheme() + "://" + origem.getHost())) { pedido.deny(); return; }
        List<String> faltam = new ArrayList<>();
        for (String r : pedido.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                faltam.add(Manifest.permission.RECORD_AUDIO);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                faltam.add(Manifest.permission.CAMERA);
        }
        if (faltam.isEmpty()) { pedido.grant(pedido.getResources()); return; }
        if (pedidoPendente != null) pedidoPendente.deny();
        pedidoPendente = pedido;
        requestPermissions(faltam.toArray(new String[0]), PEDIR_PERMISSOES);
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permissoes, int[] resultados) {
        if (codigo != PEDIR_PERMISSOES || pedidoPendente == null) return;
        List<String> liberados = new ArrayList<>();
        for (String r : pedidoPendente.getResources()) {
            String p = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) ? Manifest.permission.RECORD_AUDIO
                    : PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) ? Manifest.permission.CAMERA : null;
            if (p != null && checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) liberados.add(r);
        }
        if (liberados.isEmpty()) pedidoPendente.deny();
        else pedidoPendente.grant(liberados.toArray(new String[0]));
        pedidoPendente = null;
    }

    /** Pede ao Android para capturar a tela (a janela do sistema "Começar a gravar ou transmitir?"). */
    void pedirTela() {
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        startActivityForResult(mpm.createScreenCaptureIntent(), PEDIR_TELA);
    }

    @Override
    protected void onActivityResult(int codigo, int resultado, Intent dados) {
        super.onActivityResult(codigo, resultado, dados);
        if (codigo == ESCOLHER_ARQUIVO && escolhaArquivo != null) {
            escolhaArquivo.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, dados));
            escolhaArquivo = null;
        } else if (codigo == PEDIR_TELA) {
            ponte.telaRespondida(resultado == RESULT_OK ? dados : null);
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);   // voltar não fecha o app (a call continua)
    }

    @Override
    protected void onDestroy() {
        ponte.encerrar();
        web.destroy();
        super.onDestroy();
    }
}
