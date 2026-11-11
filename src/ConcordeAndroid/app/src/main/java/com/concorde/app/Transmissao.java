package com.concorde.app;

import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjection;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpParameters;
import org.webrtc.RtpReceiver;
import org.webrtc.RtpSender;
import org.webrtc.RtpTransceiver;
import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

import java.util.Collections;

/**
 * Compartilhar a tela do celular: MediaProjection → WebRTC nativo (codifica no chip do celular) → sessão própria
 * no SFU do Cloudflare. Igual o app do Windows: o app faz a oferta, a página registra as trilhas no SFU e devolve a resposta.
 */
class Transmissao {
    interface Texto { void com(String s); }

    private static boolean iniciado;

    private final Handler principal = new Handler(Looper.getMainLooper());
    private final int fps, kbps;
    private final EglBase egl;
    private final PeerConnectionFactory fabrica;
    private final ScreenCapturerAndroid captura;
    private final SurfaceTextureHelper ajudante;
    private final VideoSource fonte;
    private final VideoTrack trilha;
    private PeerConnection pc;
    private RtpSender envio;
    private boolean entregue;

    Transmissao(Context ctx, Intent permissao, int altura, int fps, int kbps, Runnable aoCair) {
        this.fps = fps;
        this.kbps = kbps;
        if (!iniciado) {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(ctx.getApplicationContext()).createInitializationOptions());
            iniciado = true;
        }
        egl = EglBase.create();
        fabrica = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
                .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()))
                .createPeerConnectionFactory();

        captura = new ScreenCapturerAndroid(permissao, new MediaProjection.Callback() {
            @Override
            public void onStop() { principal.post(aoCair); }   // a pessoa parou pela notificação do Android
        });
        ajudante = SurfaceTextureHelper.create("captura-tela", egl.getEglBaseContext());
        fonte = fabrica.createVideoSource(true);
        captura.initialize(ajudante, ctx, fonte.getCapturerObserver());

        // Tamanho na qualidade escolhida, mantendo a proporção da tela (deitado ou em pé), sempre par.
        DisplayMetrics dm = new DisplayMetrics();
        ((WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm);
        int menor = Math.min(dm.widthPixels, dm.heightPixels), maior = Math.max(dm.widthPixels, dm.heightPixels);
        int lado = Math.min(altura, menor);
        int outro = Math.round((float) maior * lado / menor) / 2 * 2;
        boolean deitado = dm.widthPixels >= dm.heightPixels;
        captura.startCapture(deitado ? outro : lado / 2 * 2, deitado ? lado / 2 * 2 : outro, fps);
        trilha = fabrica.createVideoTrack("tela", fonte);
    }

    /** Cria a oferta (só vídeo, só envio) e espera juntar os candidatos de rede — o SFU não recebe candidatos depois. */
    void oferta(Texto pronto, Texto erro) {
        PeerConnection.RTCConfiguration cfg = new PeerConnection.RTCConfiguration(
                Collections.singletonList(PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer()));
        cfg.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        cfg.bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE;
        cfg.rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE;

        pc = fabrica.createPeerConnection(cfg, new PeerConnection.Observer() {
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState s) {
                if (s == PeerConnection.IceGatheringState.COMPLETE) principal.post(() -> entregar(pronto));
            }
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState s) { }
            @Override public void onSignalingChange(PeerConnection.SignalingState s) { }
            @Override public void onIceConnectionReceivingChange(boolean b) { }
            @Override public void onIceCandidate(IceCandidate c) { }
            @Override public void onIceCandidatesRemoved(IceCandidate[] c) { }
            @Override public void onAddStream(MediaStream m) { }
            @Override public void onRemoveStream(MediaStream m) { }
            @Override public void onDataChannel(DataChannel d) { }
            @Override public void onRenegotiationNeeded() { }
            @Override public void onAddTrack(RtpReceiver r, MediaStream[] m) { }
        });
        if (pc == null) { erro.com("Não deu para preparar a conexão."); return; }
        RtpTransceiver t = pc.addTransceiver(trilha, new RtpTransceiver.RtpTransceiverInit(
                RtpTransceiver.RtpTransceiverDirection.SEND_ONLY, Collections.singletonList("tela")));
        envio = t.getSender();

        pc.createOffer(new Sdp() {
            @Override public void onCreateSuccess(SessionDescription d) {
                pc.setLocalDescription(new Sdp() {
                    @Override public void onSetSuccess() {
                        // Plano B: se juntar os candidatos demorar, manda o que já tem depois de 2 s.
                        principal.postDelayed(() -> entregar(pronto), 2000);
                    }
                    @Override public void onSetFailure(String e) { principal.post(() -> erro.com(e)); }
                }, d);
            }
            @Override public void onCreateFailure(String e) { principal.post(() -> erro.com(e)); }
        }, new MediaConstraints());
    }

    private void entregar(Texto pronto) {
        if (entregue || pc == null || pc.getLocalDescription() == null) return;
        entregue = true;
        pronto.com(pc.getLocalDescription().description);
    }

    /** Resposta do SFU: conecta e limita a taxa e os quadros por segundo à qualidade escolhida. */
    void resposta(String sdp) {
        pc.setRemoteDescription(new Sdp() {
            @Override public void onSetSuccess() {
                principal.post(() -> {
                    RtpParameters p = envio.getParameters();
                    for (RtpParameters.Encoding e : p.encodings) {
                        e.maxBitrateBps = kbps * 1000;
                        e.maxFramerate = fps;
                    }
                    p.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE;
                    envio.setParameters(p);
                });
            }
        }, new SessionDescription(SessionDescription.Type.ANSWER, sdp));
    }

    void parar() {
        // Cada parte solta a sua; se uma já foi solta junto com outra (a conexão solta o envio), segue para a próxima.
        tentar(captura::stopCapture);
        tentar(captura::dispose);
        if (pc != null) tentar(pc::dispose);
        tentar(trilha::dispose);
        tentar(fonte::dispose);
        tentar(ajudante::dispose);
        tentar(fabrica::dispose);
        tentar(egl::release);
    }

    private interface Acao { void fazer() throws Exception; }

    private static void tentar(Acao a) {
        try { a.fazer(); } catch (Exception ignorado) { }
    }

    /** SdpObserver com tudo vazio (cada uso só implementa o que precisa). */
    private static class Sdp implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription d) { }
        @Override public void onSetSuccess() { }
        @Override public void onCreateFailure(String e) { }
        @Override public void onSetFailure(String e) { }
    }
}
