// PAINEL DO ADMIN DO APP — parte do servidor do Concorde (classe Comunidade, comunidade.js).
//
// O que o admin do Caocorde (não o de servidor) vê e faz: números do app, gasto do mês por servidor, contas
// (senha provisória, bloquear, tornar admin, APAGAR), convites do app, pedidos de acesso, colocar alguém num
// servidor sem convite e o aviso geral para todo mundo.
//
// Como este arquivo se liga à classe: os métodos abaixo são escritos como numa classe normal (usam "this") e o
// comunidade.js copia todos para a classe Comunidade (ver "juntarMetodos" lá). Separado só para organizar:
// o comportamento é o mesmo de quando estava dentro do comunidade.js.

import { EMAIL, agora, limpar, limparEmail, novoConvite, hashSenha, SACANAS } from './utilidades.js';
import * as acessoAoApp from './acessoAoApp.js';
import { guardarNoCofre, cofreConfigurado } from './cofre.js';
import { dadosDoConvidado } from './convidados.js';
import { apagarRelacoesDe } from './amizades.js';

export class MetodosDoPainelDoAdmin {

  adminDados(ws) {
    // Fecha a conta das calls em andamento antes de mostrar o uso do mês.
    for (const { canal_id } of this.sql.exec('SELECT canal_id FROM uso_marca').toArray()) this.contarUso(canal_id);
    const mes = new Date(agora()).toISOString().slice(0, 7);
    const inicioMes = Date.parse(mes + '-01T00:00:00Z');
    const online = new Set(this.ctx.getWebSockets().map(s => s.deserializeAttachment()?.uid));
    const usuarios = this.sql.exec(`SELECT u.id, u.usuario, u.nome, u.cor, u.admin, u.avatar, u.banido, u.criado, u.email, u.seguranca,
        (SELECT COUNT(*) FROM membros_servidor m WHERE m.usuario_id = u.id) AS servidores,
        (SELECT COUNT(*) FROM mensagens g WHERE g.usuario_id = u.id) AS mensagens
      FROM usuarios u ORDER BY u.criado`).toArray().map(u => ({ ...u, admin: !!u.admin, banido: !!u.banido, online: online.has(u.id) }));
    const servidores = this.sql.exec(`SELECT s.id, s.nome, s.icone, s.cor, s.dono_id AS dono, s.criado,
        (SELECT COUNT(*) FROM membros_servidor m WHERE m.servidor_id = s.id) AS membros,
        (SELECT COUNT(*) FROM canais c WHERE c.servidor_id = s.id) AS canais,
        (SELECT COUNT(*) FROM mensagens g JOIN canais c ON c.id = g.canal_id WHERE c.servidor_id = s.id) AS mensagens,
        (SELECT COUNT(*) FROM mensagens g JOIN canais c ON c.id = g.canal_id WHERE c.servidor_id = s.id AND g.criado >= ?) AS mensagensMes,
        COALESCE(uso.voz_seg, 0) AS vozSeg, COALESCE(uso.tela_seg, 0) AS telaSeg, COALESCE(uso.mb, 0) AS mb,
        COALESCE(uso.mb_voz, 0) AS mbVoz, COALESCE(uso.mb_cam, 0) AS mbCam, COALESCE(uso.mb_tela, 0) AS mbTela, COALESCE(uso.mb_musica, 0) AS mbMusica
      FROM servidores s LEFT JOIN uso_servidor uso ON uso.servidor_id = s.id AND uso.mes = ?
      ORDER BY s.id`, inicioMes, mes).toArray();
    const calls = {};
    for (const s of this.ctx.getWebSockets()) { const a = s.deserializeAttachment(); if (a?.voz) calls[a.voz.canal] = (calls[a.voz.canal] || 0) + 1; }
    this.mandar(ws, {
      t: 'admin-dados', usuarios, servidores, mes, ...acessoAoApp.dadosDoAcessoParaOAdmin(this), cofreConfigurado: cofreConfigurado(this.env),
      resumo: {
        conexoes: this.ctx.getWebSockets().length, pessoasOnline: online.size,
        emCall: Object.values(calls).reduce((x, y) => x + y, 0),
        transmitindo: this.ctx.getWebSockets().filter(s => s.deserializeAttachment()?.voz?.trilhas?.tela).length,
        mensagens: this.sql.exec('SELECT COUNT(*) AS n FROM mensagens').one().n,
        bancoBytes: this.ctx.storage.sql.databaseSize,
      },
    });
  }

  async adminAcao(ws, eu, m) {
    const alvo = Number(m.uid);
    switch (m.acao) {
      case 'senha': {
        // Senha provisória: o admin passa para a pessoa e ela troca nas configurações.
        if (!this.membro(alvo)) return this.erro(ws, 'Usuário não existe.');
        const temp = novoConvite();
        const { hash, salt, rodadas } = await hashSenha(temp);
        // seguranca = 0: no próximo login a pessoa passa pela tela de senha nova (a provisória não fica).
        this.sql.exec('UPDATE usuarios SET hash = ?, salt = ?, rodadas_senha = ?, seguranca = 0 WHERE id = ?', hash, salt, rodadas, alvo);
        this.sql.exec('DELETE FROM sessoes WHERE usuario_id = ?', alvo);
        for (const s of this.socketsDe(alvo)) s.close(4001, 'senha trocada');
        this.mandar(ws, { t: 'admin-senha', uid: alvo, senha: temp });
        break;
      }
      case 'email': {
        // Pessoa perdeu o acesso ao e-mail: o admin troca (e depois pode mandar a redefinição de senha para o novo).
        const email = limparEmail(m.email);
        if (!this.membro(alvo)) return this.erro(ws, 'Usuário não existe.');
        if (!EMAIL.test(email)) return this.erro(ws, 'E-mail inválido.');
        if (this.sql.exec('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?', email, alvo).toArray().length) return this.erro(ws, 'Esse e-mail já está em outra conta.');
        this.sql.exec('UPDATE usuarios SET email = ? WHERE id = ?', email, alvo);
        this.mandar(ws, { t: 'ok', texto: 'E-mail trocado ✓' });
        break;
      }
      case 'enviar-redefinicao':
        try {
          const r = await this.mandarRedefinicao(alvo, this.origem || 'https://concorde.SEU-SUBDOMINIO.workers.dev', true);
          if (r.erro) return this.erro(ws, r.erro);
          this.mandar(ws, { t: 'ok', texto: 'E-mail de senha nova enviado ✓' });
        } catch (e) { return this.erro(ws, 'Não deu para mandar o e-mail: ' + e.message); }
        break;
      case 'banir': case 'desbanir':
        if (alvo === eu.id) return this.erro(ws, 'Não dá para se bloquear.');
        this.sql.exec('UPDATE usuarios SET banido = ? WHERE id = ?', m.acao === 'banir' ? 1 : 0, alvo);
        if (m.acao === 'banir') {
          this.sql.exec('DELETE FROM sessoes WHERE usuario_id = ?', alvo);
          for (const s of this.socketsDe(alvo)) s.close(4001, 'conta bloqueada');
        }
        break;
      case 'admin-app': case 'tirar-admin-app':
        if (alvo === eu.id) return this.erro(ws, 'Não dá para tirar o próprio admin.');
        this.sql.exec('UPDATE usuarios SET admin = ? WHERE id = ?', m.acao === 'admin-app' ? 1 : 0, alvo);
        this.paraQuemVe(alvo, { t: 'membro', membro: this.membro(alvo) });
        break;
      case 'apagar-servidor':
        if (Number(m.servidor) === SACANAS) return this.erro(ws, 'O Sacanas não pode ser apagado.');
        this.apagarServidor(Number(m.servidor));
        break;
      // ---- convites do app e pedidos de acesso (acessoAoApp.js) ----
      case 'convite-criar': {
        const criado = acessoAoApp.criarConvite(this, eu, m);
        if (criado.erro) return this.erro(ws, criado.erro);
        this.mandar(ws, { t: 'admin-convite-criado', codigo: criado.codigo, tipo: m.tipo });
        break;
      }
      case 'convite-apagar':
        acessoAoApp.apagarConvite(this, m.codigo);
        break;
      case 'pedido-aprovar': {
        const aprovado = await acessoAoApp.aprovarPedido(this, eu, m, this.origem || 'https://concorde.SEU-SUBDOMINIO.workers.dev');
        if (aprovado.erro) this.erro(ws, aprovado.erro);
        else this.mandar(ws, { t: 'ok', texto: 'Aprovado — o e-mail com o convite foi enviado ✓' });
        break;
      }
      case 'pedido-recusar':
        acessoAoApp.recusarPedido(this, eu, m);
        break;
      // ---- colocar alguém num servidor sem convite ----
      case 'adicionar-ao-servidor': {
        const servidorId = Number(m.servidor);
        if (!this.membro(alvo)) return this.erro(ws, 'Usuário não existe.');
        if (dadosDoConvidado(this, alvo)) return this.erro(ws, 'Convidado não entra em outro servidor.');
        if (!this.sql.exec('SELECT 1 FROM servidores WHERE id = ?', servidorId).toArray().length) return this.erro(ws, 'Servidor não existe.');
        if (this.membroDe(servidorId, alvo)) return this.erro(ws, 'Essa pessoa já está nesse servidor.');
        this.entrarNoServidor(servidorId, alvo);
        this.mandar(ws, { t: 'ok', texto: 'Adicionado ao servidor ✓' });
        break;
      }
      case 'apagar-conta': {
        const resultado = await this.apagarConta(alvo, eu);
        if (resultado.erro) return this.erro(ws, resultado.erro);
        this.mandar(ws, { t: 'ok', texto: 'Conta apagada. O registro das mensagens foi para o cofre ✓' });
        break;
      }
      case 'aviso': {
        const texto = limpar(m.texto, 300);
        this.broadcast({ t: 'aviso-geral', texto: texto || null, de: eu.nome });
        await this.ctx.storage.put('aviso-geral', texto ? { texto, de: eu.nome, quando: agora() } : null);
        break;
      }
      default: return;
    }
    this.adminDados(ws);
  }

  /**
   * APAGA uma conta de vez (não é bloquear): antes, guarda no cofre cifrado (cofre.js) os dados e as mensagens dela;
   * depois apaga mensagens, anexos, foto, sessões, servidores em que estava, conversas diretas e a própria conta.
   * Servidor que era dela passa para o admin (ou membro) mais antigo; se ficou vazio, é apagado.
   * Se o cofre falhar, NADA é apagado.
   */
  async apagarConta(alvo, eu) {
    const conta = this.sql.exec('SELECT id, usuario, nome, email, criado, admin, entrou_pelo_convite FROM usuarios WHERE id = ?', alvo).toArray()[0];
    if (!conta) return { erro: 'Usuário não existe.' };
    if (alvo === eu.id) return { erro: 'Não dá para apagar a própria conta por aqui.' };
    if (conta.admin) return { erro: 'Tire o admin do app dessa conta antes de apagar.' };
    if (!cofreConfigurado(this.env)) return { erro: 'O cofre ainda não foi configurado (precisa da chave do cofre — ver ferramentas/criar-chave-do-cofre.mjs).' };

    // 1) O registro para o cofre: conta, mensagens (com canal e servidor) e a lista de anexos.
    const mensagens = this.sql.exec(`SELECT m.id, m.canal_id AS canal, c.nome AS nomeDoCanal, c.tipo AS tipoDoCanal, c.servidor_id AS servidor,
        m.texto, m.anexo, m.resposta_id AS respostaA, m.criado, m.editado, m.apagado
      FROM mensagens m LEFT JOIN canais c ON c.id = m.canal_id WHERE m.usuario_id = ? ORDER BY m.id`, alvo).toArray();
    const anexos = this.sql.exec('SELECT chave, canal_id AS canal, nome, tipo, tamanho, criado FROM arquivos WHERE usuario_id = ?', alvo).toArray();
    const servidoresDaConta = this.sql.exec('SELECT servidor_id AS servidor, entrou FROM membros_servidor WHERE usuario_id = ?', alvo).toArray();
    try {
      await guardarNoCofre(this.env, `conta-${alvo}`, {
        motivo: 'conta apagada pelo admin do app', apagadoEm: new Date().toISOString(), apagadoPor: { id: eu.id, usuario: eu.usuario },
        conta, servidores: servidoresDaConta, mensagens, anexos,
      });
    } catch (erro) {
      return { erro: 'Não deu para guardar no cofre, então nada foi apagado: ' + erro.message };
    }

    // 2) Desconecta a pessoa (sai da call) antes de apagar.
    for (const conexao of this.socketsDe(alvo)) {
      const anexoDaConexao = conexao.deserializeAttachment();
      if (anexoDaConexao?.voz) this.tirarDaCall(conexao, anexoDaConexao);
      conexao.close(4001, 'conta apagada');
    }

    // 3) Servidores que eram dela: passa para o admin (ou membro) mais antigo; vazio = apaga.
    for (const { id: servidorId } of this.sql.exec('SELECT id FROM servidores WHERE dono_id = ?', alvo).toArray()) {
      const herdeiro = this.sql.exec('SELECT usuario_id FROM membros_servidor WHERE servidor_id = ? AND usuario_id <> ? ORDER BY admin DESC, entrou LIMIT 1',
        servidorId, alvo).toArray()[0]?.usuario_id;
      if (herdeiro) {
        this.sql.exec('UPDATE servidores SET dono_id = ? WHERE id = ?', herdeiro, servidorId);
        this.sql.exec('UPDATE membros_servidor SET admin = 1 WHERE servidor_id = ? AND usuario_id = ?', servidorId, herdeiro);
      } else if (servidorId !== SACANAS) this.apagarServidor(servidorId);
      else this.sql.exec('UPDATE servidores SET dono_id = ? WHERE id = ?', eu.id, servidorId);
    }

    // 4) Conversas diretas com ela: somem para os dois lados.
    const conversas = this.sql.exec('SELECT canal_id FROM conversas_diretas WHERE usuario_menor = ? OR usuario_maior = ?', alvo, alvo).toArray().map(linha => linha.canal_id);
    for (const canalId of conversas) {
      this.sql.exec('DELETE FROM mensagens WHERE canal_id = ?', canalId);
      anexos.push(...this.sql.exec('SELECT chave FROM arquivos WHERE canal_id = ? AND usuario_id <> ?', canalId, alvo).toArray());
      this.sql.exec('DELETE FROM arquivos WHERE canal_id = ?', canalId);
      this.sql.exec('DELETE FROM canais WHERE id = ?', canalId);
    }
    this.sql.exec('DELETE FROM conversas_diretas WHERE usuario_menor = ? OR usuario_maior = ?', alvo, alvo);

    // 5) O resto do que é dela.
    for (const tabela of ['mensagens', 'arquivos', 'sessoes', 'push_aparelhos', 'membros_servidor', 'membros_cargos', 'moderacao_voz', 'redefinicoes', 'sfu_sessoes']) {
      this.sql.exec(`DELETE FROM ${tabela} WHERE usuario_id = ?`, alvo);
    }
    apagarRelacoesDe(this, alvo);
    this.sql.exec('DELETE FROM usuarios WHERE id = ?', alvo);

    // 6) Arquivos no R2 (anexos e foto de perfil). Se falhar, o cron diário dos anexos limpa depois.
    if (this.env.ARQUIVOS) {
      const chaves = [...new Set(anexos.map(anexo => anexo.chave))];
      try {
        for (let inicio = 0; inicio < chaves.length; inicio += 1000) await this.env.ARQUIVOS.delete(chaves.slice(inicio, inicio + 1000));
        await this.env.ARQUIVOS.delete(`avatar/${alvo}`);
      } catch (erro) { console.log('[apagar conta] R2:', erro.message); }
    }
    this.atualizarTodos();
    return { ok: true };
  }

}
