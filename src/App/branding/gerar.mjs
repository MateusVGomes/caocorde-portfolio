// Logo do Concorde → PNGs e ícone. Sobe um servidor local na porta 8798:
//   node src/App/branding/gerar.mjs
// Abra http://127.0.0.1:8798/previa.html para ver; http://127.0.0.1:8798/renderizar.html gera os PNGs em
// src/App/public (favicon, apple-touch-icon, logo) e src/ConcordeDesktop/icone (tamanhos do .ico).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const saidas = { web: join(aqui, '..', 'public'), app: join(aqui, '..', '..', 'ConcordeDesktop', 'icone') };
const tipos = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/salvar') {
      const [pasta, nome] = url.searchParams.get('nome').split('/');
      if (!saidas[pasta] || !/^[\w.-]+\.png$/.test(nome)) throw new Error('nome inválido');
      const partes = [];
      for await (const c of req) partes.push(c);
      await mkdir(saidas[pasta], { recursive: true });
      await writeFile(join(saidas[pasta], nome), Buffer.concat(partes));
      console.log('salvo', pasta + '/' + nome);
      return res.end('ok');
    }
    const arquivo = join(aqui, url.pathname.replace(/^\/+/, '') || 'previa.html');
    if (!arquivo.startsWith(aqui)) throw new Error('fora da pasta');
    res.setHeader('Content-Type', tipos[extname(arquivo)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(arquivo));
  } catch (e) {
    res.statusCode = 400;
    res.end(String(e.message));
  }
}).listen(8798, '127.0.0.1', () => console.log('http://127.0.0.1:8798/previa.html'));
