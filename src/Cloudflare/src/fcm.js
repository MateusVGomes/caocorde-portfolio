// Aviso no celular com o app fechado: Firebase Cloud Messaging (API HTTP v1).
// Precisa do secret FCM_CONTA = o JSON inteiro da "conta de serviço" do projeto Firebase (tutorial em
// docs/notificacoes-celular.md). Com ele o Worker assina um JWT (RS256), troca por um token do Google (vale 1 h,
// fica guardado na memória) e manda o aviso para cada aparelho.

let acesso = null;   // { token, expira, projeto }

const b64url = dados => btoa(typeof dados === 'string' ? dados : String.fromCharCode(...new Uint8Array(dados)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function tokenGoogle(env) {
  if (acesso && acesso.expira > Date.now() + 60_000) return acesso;
  const conta = JSON.parse(env.FCM_CONTA);
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({
    iss: conta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600,
  }));
  const pem = conta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const chave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cabecalho}.${corpo}`));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${cabecalho}.${corpo}.${b64url(assinatura)}`,
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google recusou a conta de serviço: ' + (j.error_description || j.error || r.status));
  acesso = { token: j.access_token, expira: Date.now() + (j.expires_in || 3600) * 1000, projeto: conta.project_id };
  return acesso;
}

/** Manda um aviso. Devolve 'ok', 'invalido' (aparelho não existe mais: apagar) ou 'erro'. */
export async function enviarPush(env, token, { titulo, corpo, canal }) {
  try {
    const g = await tokenGoogle(env);
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${g.projeto}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${g.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: titulo, body: corpo },
          // Mesmo canal = um aviso por canal (o novo substitui o anterior, igual o Discord).
          android: { priority: 'high', notification: { channel_id: 'mensagens', tag: `canal-${canal}`, icon: 'ic_notificacao' } },
          data: { canal: String(canal) },
        },
      }),
    });
    if (r.ok) return 'ok';
    if (r.status === 404) return 'invalido';   // UNREGISTERED: desinstalou o app ou o token venceu
    console.log(`[push] FCM respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return 'erro';
  } catch (e) {
    console.log('[push] ' + e.message);
    return 'erro';
  }
}
