// CARGOS DOS SERVIDORES (0.5.11) — como os "cargos" do Discord.
//
// O dono (e os admins) criam cargos com nome, cor e permissões, e dão os cargos para as pessoas do servidor.
// Quem tem um cargo ganha as permissões dele; com vários cargos, soma tudo.
//   - Dono do servidor, admin do servidor e admin do app (que esteja no servidor) podem TUDO, como antes.
//   - Quem tem "Gerenciar cargos" só cria/edita/dá cargos com permissões que ele mesmo tem (ninguém se promove).
//
// Permissões (cada uma é um bit no número "permissoes" do cargo — guardado assim para somar rápido):

export const PERMISSOES = {
  convidar: 1,            // gerar convites do servidor (link e códigos) — só para quem JÁ TEM conta
  canais: 2,              // criar, renomear e apagar canais
  expulsar: 4,            // tirar pessoas do servidor (menos admins e o dono)
  moderarVoz: 8,          // mutar/desativar o áudio/desconectar alguém da call (menos admins e o dono)
  apagarMensagens: 16,    // apagar mensagem dos outros
  editarServidor: 32,     // trocar nome, cor e ícone do servidor
  gerenciarCargos: 64,    // criar, editar e dar cargos
};
export const TODAS_AS_PERMISSOES = Object.values(PERMISSOES).reduce((soma, bit) => soma | bit, 0);
const MAXIMO_DE_CARGOS_POR_SERVIDOR = 25;
const CORES_PERMITIDAS = /^#[0-9a-fA-F]{6}$/;

/** Tipos de mensagem do WebSocket tratados aqui. */
export const ACOES_DE_CARGO = ['cargo-criar', 'cargo-editar', 'cargo-apagar', 'cargo-dar', 'cargo-tirar'];

export function migrarCargos(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS cargos (id INTEGER PRIMARY KEY, servidor_id INTEGER NOT NULL, nome TEXT NOT NULL, cor TEXT NOT NULL,
      posicao INTEGER NOT NULL, permissoes INTEGER NOT NULL DEFAULT 0, criado INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS cargos_servidor ON cargos (servidor_id);
    CREATE TABLE IF NOT EXISTS membros_cargos (servidor_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, cargo_id INTEGER NOT NULL,
      PRIMARY KEY (usuario_id, cargo_id));`);
}

/** O que a pessoa pode fazer no servidor (número com os bits das permissões). 0 = não é membro ou não tem cargo. */
export function permissoesNoServidor(comunidade, servidorId, usuarioId) {
  if (comunidade.adminDe(servidorId, usuarioId)) return TODAS_AS_PERMISSOES;   // dono, admin do servidor, admin do app
  if (!comunidade.membroDe(servidorId, usuarioId)) return 0;
  const linhas = comunidade.sql.exec(`SELECT c.permissoes FROM membros_cargos mc JOIN cargos c ON c.id = mc.cargo_id
    WHERE mc.servidor_id = ? AND mc.usuario_id = ?`, servidorId, usuarioId).toArray();
  return linhas.reduce((soma, linha) => soma | linha.permissoes, 0);
}

/** A pessoa pode fazer isto no servidor? (permissao = um dos valores de PERMISSOES) */
export const pode = (comunidade, servidorId, usuarioId, permissao) => (permissoesNoServidor(comunidade, servidorId, usuarioId) & permissao) === permissao;

/** Para a página: os cargos do servidor e os cargos de cada membro. */
export function cargosParaCliente(comunidade, servidorId) {
  const cargos = comunidade.sql.exec('SELECT id, nome, cor, posicao, permissoes FROM cargos WHERE servidor_id = ? ORDER BY posicao, id', servidorId).toArray();
  const cargosDosMembros = {};
  for (const linha of comunidade.sql.exec('SELECT usuario_id, cargo_id FROM membros_cargos WHERE servidor_id = ?', servidorId).toArray()) {
    (cargosDosMembros[linha.usuario_id] ||= []).push(linha.cargo_id);
  }
  return { cargos, cargosDosMembros };
}

/** Trata criar/editar/apagar/dar/tirar cargo. Devolve true se mudou algo (aí o servidor manda a lista nova a todos). */
export function tratarAcaoDeCargo(comunidade, conexao, eu, mensagem) {
  const erro = texto => { comunidade.erro(conexao, texto); return false; };
  const servidorId = Number(mensagem.servidor);
  if (!comunidade.membroDe(servidorId, eu.id)) return erro('Servidor não encontrado.');
  const minhas = permissoesNoServidor(comunidade, servidorId, eu.id);
  if (!(minhas & PERMISSOES.gerenciarCargos)) return erro('Você não tem permissão para mexer nos cargos deste servidor.');
  // Só mexe em cargo cujas permissões a pessoa também tem (não dá para criar um cargo "maior" que o seu).
  const cabeEmMim = permissoes => (permissoes & ~minhas) === 0;
  const cargo = mensagem.cargo ? comunidade.sql.exec('SELECT * FROM cargos WHERE id = ? AND servidor_id = ?', Number(mensagem.cargo), servidorId).toArray()[0] : null;
  if (mensagem.t !== 'cargo-criar' && !cargo) return erro('Cargo não encontrado.');
  if (cargo && !cabeEmMim(cargo.permissoes)) return erro('Esse cargo tem permissões que você não tem.');

  switch (mensagem.t) {
    case 'cargo-criar': case 'cargo-editar': {
      const nome = String(mensagem.nome ?? cargo?.nome ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
      const cor = CORES_PERMITIDAS.test(mensagem.cor) ? mensagem.cor : (cargo?.cor || '#8A8A94');
      const permissoes = (Number(mensagem.permissoes) | 0) & TODAS_AS_PERMISSOES;
      if (!nome) return erro('Dê um nome para o cargo.');
      if (!cabeEmMim(permissoes)) return erro('Você não pode dar uma permissão que não tem.');
      if (mensagem.t === 'cargo-criar') {
        const quantos = comunidade.sql.exec('SELECT COUNT(*) AS n FROM cargos WHERE servidor_id = ?', servidorId).one().n;
        if (quantos >= MAXIMO_DE_CARGOS_POR_SERVIDOR) return erro(`Máximo de ${MAXIMO_DE_CARGOS_POR_SERVIDOR} cargos por servidor.`);
        comunidade.sql.exec('INSERT INTO cargos (servidor_id, nome, cor, posicao, permissoes, criado) VALUES (?,?,?,?,?,?)', servidorId, nome, cor, quantos, permissoes, Date.now());
      } else {
        comunidade.sql.exec('UPDATE cargos SET nome = ?, cor = ?, permissoes = ? WHERE id = ?', nome, cor, permissoes, cargo.id);
      }
      return true;
    }
    case 'cargo-apagar':
      comunidade.sql.exec('DELETE FROM membros_cargos WHERE cargo_id = ?', cargo.id);
      comunidade.sql.exec('DELETE FROM cargos WHERE id = ?', cargo.id);
      return true;
    case 'cargo-dar': case 'cargo-tirar': {
      const alvoId = Number(mensagem.uid);
      if (!comunidade.membroDe(servidorId, alvoId)) return erro('Essa pessoa não está no servidor.');
      if (mensagem.t === 'cargo-dar') comunidade.sql.exec('INSERT OR IGNORE INTO membros_cargos (servidor_id, usuario_id, cargo_id) VALUES (?,?,?)', servidorId, alvoId, cargo.id);
      else comunidade.sql.exec('DELETE FROM membros_cargos WHERE usuario_id = ? AND cargo_id = ?', alvoId, cargo.id);
      return true;
    }
    default: return false;
  }
}

/** Saiu/foi expulso do servidor: perde os cargos de lá. Servidor apagado: some tudo. */
export function tirarCargosDoMembro(comunidade, servidorId, usuarioId) {
  comunidade.sql.exec('DELETE FROM membros_cargos WHERE servidor_id = ? AND usuario_id = ?', servidorId, usuarioId);
}
export function apagarCargosDoServidor(comunidade, servidorId) {
  comunidade.sql.exec('DELETE FROM membros_cargos WHERE servidor_id = ?', servidorId);
  comunidade.sql.exec('DELETE FROM cargos WHERE servidor_id = ?', servidorId);
}
