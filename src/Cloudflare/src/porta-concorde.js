// Worker "concorde": o endereço principal (concorde.SEU-SUBDOMINIO.workers.dev).
// Só repassa tudo para o Worker "telinha" (ligação interna do Cloudflare, sem sair para a internet), que tem os
// dados, os secrets e a página. Lá o "/" vira o Concorde quando o endereço começa com "concorde.".
export default {
  fetch: (req, env) => env.TELINHA.fetch(req),
};
