// E-mail do Caocorde (recuperação de senha, convites aprovados) por uma conta do Gmail (var GMAIL_USUARIO).
// O Worker fala SMTP direto com o Gmail (porta 465, TLS) usando uma "senha de app" (secret GMAIL_SENHA_APP).
import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();
/** Base64 de texto UTF-8 (btoa sozinho só aceita Latin-1). */
const b64 = s => btoa(String.fromCharCode(...enc.encode(s)));
/** Base64 quebrado em linhas de 76 (exigência do e-mail). */
const b64Linhas = s => b64(s).replace(/.{1,76}/g, '$&\r\n').trim();

export function emailConfigurado(env) {
  return !!(env.GMAIL_USUARIO && env.GMAIL_SENHA_APP);
}

/** Manda um e-mail em HTML. Lança erro com a resposta do Gmail se algo falhar. */
export async function enviarEmail(env, { para, assunto, html }) {
  const usuario = env.GMAIL_USUARIO;
  const senha = String(env.GMAIL_SENHA_APP || '').replace(/[\s﻿]/g, '');   // a senha de app vem em blocos com espaço
  if (!usuario || !senha) throw new Error('o e-mail do Caocorde ainda não foi configurado');

  const sock = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on' });
  const escrever = sock.writable.getWriter();
  const ler = sock.readable.getReader();
  let buf = '';

  // Resposta do SMTP: uma ou mais linhas; a última tem "código + espaço".
  async function resposta() {
    for (;;) {
      const linhas = buf.split('\r\n');
      for (let i = 0; i < linhas.length - 1; i++) {
        if (/^\d{3} /.test(linhas[i])) {
          buf = linhas.slice(i + 1).join('\r\n');
          return { codigo: Number(linhas[i].slice(0, 3)), texto: linhas.slice(0, i + 1).join(' ') };
        }
      }
      const { value, done } = await ler.read();
      if (done) throw new Error('o Gmail fechou a conexão');
      buf += dec.decode(value, { stream: true });
    }
  }
  async function comando(linha, esperado) {
    await escrever.write(enc.encode(linha + '\r\n'));
    const r = await resposta();
    if (String(r.codigo)[0] !== esperado) throw new Error(`Gmail recusou (${r.codigo}): ${r.texto.slice(0, 160)}`);
    return r;
  }

  try {
    const oi = await resposta();
    if (oi.codigo !== 220) throw new Error('Gmail não respondeu: ' + oi.texto);
    await comando('EHLO concorde', '2');
    await comando('AUTH LOGIN', '3');
    await comando(b64(usuario), '3');
    await comando(b64(senha), '2');
    await comando(`MAIL FROM:<${usuario}>`, '2');
    await comando(`RCPT TO:<${para}>`, '2');
    await comando('DATA', '3');
    const cabecalho = [
      `From: =?UTF-8?B?${b64('Caocorde')}?= <${usuario}>`,
      `To: <${para}>`,
      `Subject: =?UTF-8?B?${b64(assunto)}?=`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      `Message-ID: <${crypto.randomUUID()}@concorde>`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n');
    // Corpo em base64: nenhuma linha começa com "." (não precisa do "dot-stuffing" do SMTP).
    await comando(`${cabecalho}\r\n\r\n${b64Linhas(html)}\r\n.`, '2');
    await comando('QUIT', '2').catch(() => {});
  } finally {
    try { await sock.close(); } catch { }
  }
}

const escaparHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Moldura dos e-mails do Caocorde (cores da logo: grafite, laranja e o turquesa do olho). */
function moldura(conteudo) {
  return `<!doctype html><html><body style="margin:0;background:#111114;font-family:Segoe UI,Arial,sans-serif;color:#E6E6EA">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:26px;font-weight:900;color:#fff">Cao<span style="color:#F07A1E">corde</span></div>
    ${conteudo}
    <p style="font-size:12px;color:#8A8A94;margin-top:32px">Caocorde — o chat de voz e transmissão da galera. Só para maiores de 18 anos.</p>
  </div></body></html>`;
}
const botao = (link, texto) => `<a href="${escaparHtml(link)}" style="background:#B04E08;color:#fff;text-decoration:none;font-weight:800;padding:14px 26px;border-radius:12px;display:inline-block">${escaparHtml(texto)}</a>`;

/** E-mail de "criar senha nova" (esqueci a senha / admin mandou). */
export function htmlRedefinicao(nome, link, porAdmin) {
  return moldura(`
    <p style="font-size:15px;line-height:1.5">Oi, <b>${escaparHtml(nome)}</b>!</p>
    <p style="font-size:15px;line-height:1.5">${porAdmin ? 'O admin do Caocorde pediu para você criar uma senha nova.' : 'Alguém (provavelmente você) pediu para criar uma senha nova na sua conta.'}
    O link vale por <b>1 hora</b>.</p>
    <p style="margin:28px 0">${botao(link, 'Criar senha nova')}</p>
    <p style="font-size:12px;color:#8A8A94">Se não foi você, é só ignorar este e-mail — sua senha continua a mesma.</p>`);
}

/**
 * E-mail de "pedido aprovado": o link de cadastro (com o código já preenchido), o código escrito (para quem for
 * criar a conta pelo app) e as 3 formas de usar: navegador, Windows e celular — com o passo a passo de cada uma.
 * Os instaladores vão como LINK (o Gmail bloqueia .exe anexado e o APK é grande demais para anexo).
 */
export function htmlAprovacao({ origem, codigo, diasDeValidade }) {
  const linkDoCadastro = `${origem}/?acesso=${encodeURIComponent(codigo)}`;
  const passo = texto => `<li style="margin:6px 0">${texto}</li>`;
  return moldura(`
    <p style="font-size:16px;line-height:1.5"><b>Seu pedido foi aprovado! 🎉</b> Agora é só criar a sua conta.</p>
    <p style="margin:24px 0">${botao(linkDoCadastro, 'Criar minha conta')}</p>
    <p style="font-size:14px;line-height:1.5">Seu código de convite (vale por <b>${diasDeValidade} dias</b> e só para uma conta):</p>
    <p style="font-size:26px;font-weight:900;letter-spacing:4px;color:#2EC4D3;margin:8px 0 24px">${escaparHtml(codigo)}</p>

    <p style="font-size:15px;font-weight:800;color:#fff;margin-bottom:4px">Você pode usar o Caocorde de 3 jeitos:</p>

    <p style="font-size:14px;font-weight:800;color:#F07A1E;margin:18px 0 4px">1. No navegador (o mais rápido)</p>
    <ol style="font-size:14px;line-height:1.5;padding-left:20px;margin:0">
      ${passo('Clique em <b>Criar minha conta</b> aqui em cima. O código já vai preenchido.')}
      ${passo('Escolha usuário, nome, e-mail e senha. Pronto.')}
    </ol>

    <p style="font-size:14px;font-weight:800;color:#F07A1E;margin:18px 0 4px">2. No Windows (melhor para transmitir jogo)</p>
    <ol style="font-size:14px;line-height:1.5;padding-left:20px;margin:0">
      ${passo(`<a href="${escaparHtml(`${origem}/baixar/windows`)}" style="color:#5FD4DF">Baixe o instalador do Windows</a> (uns 150 MB).`)}
      ${passo('Abra o arquivo baixado. Se o Windows mostrar "O Windows protegeu o computador", clique em <b>Mais informações</b> → <b>Executar assim mesmo</b>.')}
      ${passo('O Caocorde abre sozinho. Clique em <b>Tenho um código de convite</b>, digite o código acima e crie a conta.')}
    </ol>

    <p style="font-size:14px;font-weight:800;color:#F07A1E;margin:18px 0 4px">3. No celular Android</p>
    <ol style="font-size:14px;line-height:1.5;padding-left:20px;margin:0">
      ${passo(`Abra este e-mail no celular e <a href="${escaparHtml(`${origem}/baixar/android`)}" style="color:#5FD4DF">baixe o app para Android</a> (uns 45 MB).`)}
      ${passo('Toque no arquivo baixado. Se aparecer "instalação bloqueada", toque em <b>Configurações</b> e ligue <b>Permitir desta fonte</b>, depois volte e toque em <b>Instalar</b>.')}
      ${passo('Abra o Caocorde, toque em <b>Tenho um código de convite</b> e use o código acima.')}
    </ol>
    <p style="font-size:13px;color:#B4B4BD;margin-top:16px">iPhone: use pelo navegador (jeito 1).</p>
    <p style="font-size:12px;color:#8A8A94">Não pediu acesso ao Caocorde? É só ignorar este e-mail.</p>`);
}
