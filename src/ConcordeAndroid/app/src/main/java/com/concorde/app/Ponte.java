package com.concorde.app;

import android.content.Intent;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Ponte entre a página e o app Android: a página chama ConcordeAndroidPonte.chamar(id, método, argsJson) e recebe
 * a resposta em window.__concordeAndroid.resposta(id, ok, valorJson); eventos vão para window.__concordeAndroid.evento.
 * Só existe dentro do nosso site (o MainActivity não deixa a WebView navegar para outro).
 */
class Ponte {
    private final MainActivity act;
    private Transmissao tx;
    private boolean naCall, transmitindo;
    private int pedidoTela = -1;
    private JSONObject argsTela;

    Ponte(MainActivity act) { this.act = act; }

    @JavascriptInterface
    public String info() {
        try {
            return new JSONObject().put("versao", BuildConfigVersao.NOME).put("plataforma", "android").toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void chamar(int id, String metodo, String argsJson) {
        final JSONObject args = lerArgs(argsJson);
        if (args == null) { falhar(id, "argumentos inválidos"); return; }
        act.runOnUiThread(() -> {
            // Segunda trava: só responde se a página aberta agora é a do nosso site.
            android.net.Uri pagina = act.web.getUrl() == null ? null : android.net.Uri.parse(act.web.getUrl());
            if (pagina == null || !MainActivity.SITE.equals(pagina.getScheme() + "://" + pagina.getHost())) return;
            try {
                switch (metodo) {
                    case "emCall":
                        boolean antes = naCall;
                        naCall = args.optBoolean("ligado");
                        ServicoCall.atualizar(act, naCall, transmitindo);
                        if (naCall && !antes) Som.aplicar(act);
                        else if (!naCall && antes) Som.soltar(act);
                        responder(id, new JSONObject());
                        break;
                    case "atualizacao":
                        // Rede fora da thread da tela.
                        new Thread(() -> {
                            try {
                                JSONObject m = Atualizador.verificar();
                                responder(id, m == null ? new JSONObject() : new JSONObject().put("versao", m.getString("versao")));
                            } catch (Exception e) { falhar(id, String.valueOf(e.getMessage())); }
                        }).start();
                        break;
                    case "atualizar":
                        new Thread(() -> {
                            try {
                                JSONObject m = Atualizador.verificar();
                                if (m == null) { falhar(id, "Você já está na versão mais nova."); return; }
                                java.io.File apk = Atualizador.baixarApk(act, m, p -> evento("atualizacao", "{\"pct\":" + p + "}"));
                                Atualizador.instalar(act, apk);
                                responder(id, new JSONObject());
                            } catch (Exception e) { falhar(id, String.valueOf(e.getMessage())); }
                        }).start();
                        break;
                    case "notificar":
                        Avisos.mostrar(act, args.optString("titulo"), args.optString("texto"), args.optInt("canal"));
                        responder(id, new JSONObject());
                        break;
                    case "pushToken":
                        Avisos.tokenFirebase(token -> {
                            try { responder(id, token == null ? new JSONObject() : new JSONObject().put("token", token)); }
                            catch (JSONException e) { falhar(id, e.getMessage()); }
                        });
                        break;
                    case "canalPendente": {
                        // Tocou num aviso com o app fechado: a página abre o canal dele assim que conectar.
                        JSONObject r = new JSONObject();
                        if (canalPendente != null) r.put("canal", canalPendente);
                        canalPendente = null;
                        responder(id, r);
                        break;
                    }
                    case "saidas":
                        responder(id, Som.lista(act));
                        break;
                    case "saida":
                        Som.escolher(act, args.getString("id"), naCall);
                        responder(id, new JSONObject());
                        break;
                    case "iniciar":
                        if (pedidoTela >= 0) falhar(pedidoTela, "cancelado");
                        pedidoTela = id;
                        argsTela = args;
                        act.pedirTela();
                        break;
                    case "resposta":
                        if (tx == null) { falhar(id, "a transmissão não começou"); break; }
                        tx.resposta(args.getString("sdp"));
                        responder(id, new JSONObject());
                        break;
                    case "parar":
                        pararTela();
                        responder(id, new JSONObject());
                        break;
                    default:
                        falhar(id, "método desconhecido: " + metodo);
                }
            } catch (Exception e) {
                falhar(id, String.valueOf(e.getMessage()));
            }
        });
    }

    private static JSONObject lerArgs(String json) {
        try { return json == null || json.isEmpty() ? new JSONObject() : new JSONObject(json); }
        catch (JSONException e) { return null; }
    }

    /** Volta da janela do Android "Começar a transmitir?". */
    void telaRespondida(Intent permissao) {
        int id = pedidoTela;
        pedidoTela = -1;
        if (id < 0) return;
        if (permissao == null) { falhar(id, "Você não liberou a captura da tela."); return; }
        // A captura só pode começar com o serviço em primeiro plano do tipo "mediaProjection" já rodando.
        ServicoCall.aoLiberarTela = () -> act.runOnUiThread(() -> {
            try {
                pararCaptura();
                tx = new Transmissao(act, permissao, argsTela.optInt("altura", 720), argsTela.optInt("fps", 30), argsTela.optInt("kbps", 2500),
                        () -> evento("transmissao", "{\"estado\":\"caiu\"}"));
                tx.oferta(sdp -> {
                    try { responder(id, new JSONObject().put("sdp", sdp).put("encoder", "Android")); }
                    catch (JSONException e) { falhar(id, e.getMessage()); }
                }, erro -> { falhar(id, erro); pararTela(); });
            } catch (Exception e) {
                falhar(id, String.valueOf(e.getMessage()));
                pararTela();
            }
        });
        transmitindo = true;
        ServicoCall.atualizar(act, naCall, true);
    }

    private void pararCaptura() {
        if (tx != null) { tx.parar(); tx = null; }
    }

    private void pararTela() {
        pararCaptura();
        if (transmitindo) { transmitindo = false; ServicoCall.atualizar(act, naCall, false); }
    }

    void encerrar() {
        pararCaptura();
        ServicoCall.atualizar(act, false, false);
    }

    private void responder(int id, JSONObject valor) { js("resposta(" + id + ",true," + JSONObject.quote(valor.toString()) + ")"); }

    private void falhar(int id, String erro) { js("resposta(" + id + ",false," + JSONObject.quote(erro == null ? "erro" : erro) + ")"); }

    /** Canal do aviso tocado (o app abriu por ele). */
    String canalPendente;

    /** Tocou num aviso com o app já aberto: a página troca para o canal. */
    void abrirCanal(String canal) { evento("abrir-canal", "{\"canal\":" + JSONObject.quote(canal) + "}"); }

    /** App foi para segundo plano ou voltou: a página avisa o servidor (avisos no celular) e decide se mostra aviso. */
    void segundoPlano(boolean fundo) { evento("app", "{\"fundo\":" + fundo + "}"); }

    private void evento(String nome, String dadosJson) { js("evento(" + JSONObject.quote(nome) + "," + JSONObject.quote(dadosJson) + ")"); }

    private void js(String chamada) {
        act.runOnUiThread(() -> act.web.evaluateJavascript("window.__concordeAndroid && window.__concordeAndroid." + chamada, null));
    }
}
