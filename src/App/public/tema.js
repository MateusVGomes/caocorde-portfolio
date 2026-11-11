// Tema claro ou escuro ANTES da página desenhar (senão pisca escuro → claro ao abrir).
// Fica num arquivo separado (e não dentro do index.html) porque a regra de segurança da página (CSP, ver
// src/Cloudflare/src/index.js → cabecalhosDeSeguranca) só deixa rodar scripts que vêm de arquivos do próprio site.
try {
  if (localStorage.getItem('theme') === 'light') document.documentElement.classList.remove('dark');
} catch (erroAoLerPreferencia) {
  // Sem acesso ao armazenamento (modo privado, bloqueado): fica no tema escuro, que é o padrão.
}
