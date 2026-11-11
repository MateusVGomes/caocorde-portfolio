# Sistema visual do Caocorde

Arquivo de referência para quem mexe na aparência do app. Antes de criar uma tela nova, leia este arquivo.
Quem implementa: `src/App/tailwind.config.js` (cores `brand`) e `src/App/src/style.css` (fundos, painéis e tema claro).

## Referências do gênero

As referências abaixo vêm de conhecimento geral sobre esses apps. Não foi feita pesquisa na web para este arquivo.

| App | O que funciona | O que evitar | O que aproveitar |
|---|---|---|---|
| Discord | Menu do clique direito: ações pessoais em texto normal e ações de admin/perigosas em vermelho, separadas por linhas | Muitas opções escondidas em submenus | A separação "para mim" × "para todo mundo (admin)" pela cor e pelo grupo |
| Slack | Uma cor de marca forte e fundos calmos | Cor de marca no fundo inteiro cansa | Usar a cor só em botões, seleção e foco |
| Guilded | Tema escuro com destaque quente (amarelo) | Amarelo saturado em tudo fica "esquisito" (foi a reclamação do dono) | Calor sim, mas num laranja mais avermelhado |
| TeamSpeak | Lista da call clara, com ícones de mute visíveis | Visual datado, muita borda | Ícones de estado sempre à vista |

**Convenções que a galera já espera:** tema escuro como padrão, barra de servidores à esquerda e clique direito na pessoa abrindo um menu.

**Diferencial:** as cores da logo — o Jorginho (gato laranja) e a Dobby (cachorra preta) dividindo a cabeça-controle.

## Logo

- Fontes em `src/App/branding/`: `logo.svg` (mascote colorido com contorno claro, sem letras), `icone.svg` (ícone do app:
  quadrado laranja, metade gato branca e metade cachorra preta) e `logo-branco.svg` (uma cor só).
- Gerar os PNGs: `node src/App/branding/gerar.mjs` e abrir `http://127.0.0.1:8798/renderizar.html`; depois
  `src/ConcordeDesktop/gerar-icone.ps1` (o .ico). Os ícones do Android saem do `public/logo-app.png`.
- A logo com o nome escrito ("Caocorde", com bordas grossas) é só para divulgação. No app, o ícone não tem letras.

## Direção

- **Personalidade:** um "Discord dos amigos": aconchegante, brincalhão e sem ser infantil.
- **Elemento-assinatura:** o laranja do Jorginho, só no que importa (botão principal, item selecionado, barra de
  progresso). O fundo é o **grafite** da Dobby: um cinza escuro neutro, um fio de frio. O **turquesa** do olho do gato
  é um acento raro: anel de foco do teclado, link e marcação de "novo".

## Cores

### Destaque (laranja do Jorginho)

| Token | Cor | Uso | Contraste conferido |
|---|---|---|---|
| brand-50 | `#FFF4EA` | fundo de destaque no tema claro | — |
| brand-100 | `#FFE0C7` | — | — |
| brand-200 | `#FFB27A` | — | — |
| brand-300 | `#FF8A33` | texto de destaque no escuro | 7,5:1 no painel |
| brand-400 | `#F07A1E` | **o laranja da logo**: ícone, texto e destaque no escuro | 6,3:1 no painel |
| brand-500 | `#C2560A` | hover do botão (texto branco) | branco 4,5:1 |
| brand-600 | `#B04E08` | botão principal (texto branco) | branco 5,3:1 |
| brand-700 | `#963F06` | botão pressionado | branco 7,0:1 |

O laranja vivo da logo (`#F07A1E`) não aguenta texto branco (2,8:1). Por isso o botão usa o 600, mais fechado.

### Acento (turquesa do olho)

| Token | Cor | Uso | Contraste |
|---|---|---|---|
| acento-300 | `#5FD4DF` | texto/link no escuro | 10:1 no painel |
| acento-400 | `#2EC4D3` | anel de foco (`:focus-visible`), ícone | 8,4:1 no painel |
| acento-600 | `#14808C` | fundo com texto branco | branco 4,7:1 |

### Neutros (grafite, tema escuro — o padrão)

| Papel | Cor |
|---|---|
| fundo do app | `#111114` |
| painel (barra de canais, menus) | `#18181C` |
| superfície (campos, cartões) | `#222227` |
| borda | `#34343B` |
| texto secundário | `#B4B4BD` (8,6:1 no painel); `#8A8A94` só para texto pequeno de apoio (5,2:1) |

### Semânticas

| Papel | Cor |
|---|---|
| sucesso / online | emerald |
| alerta / ausente | amber. Só para alerta, coroa do dono e ausente; nunca como decoração |
| perigo / admin no menu | `#F2777A` no texto (6,5:1 no painel). No hover, fundo `#DA373C` com texto branco (4,6:1) |

## Menu do clique direito (padrão do Discord)

1. **Cabeçalho:** foto, nome e estado (na call, transmitindo).
2. **Para você** (texto normal):
   - volume da voz (slider);
   - "Silenciar para mim" (caixa de marcar);
   - volume da live, quando a pessoa está transmitindo.
3. Linha divisória.
4. **Admin** (texto vermelho; só aparece para admin):
   - "Silenciar voz no servidor" (caixa de marcar);
   - "Desativar áudio no servidor" (caixa de marcar);
   - "Desconectar".
5. Cada item tem 36 px ou mais de altura e mostra o estado com a caixa de marcar, nunca só com a cor.

## Outros componentes com regra própria

- **Configurações** (`Configuracoes.jsx`):
  - Seções numa coluna à esquerda; no celular viram abas no topo.
  - Cada seção tem título, uma frase de explicação e o seu próprio botão de salvar.
  - "Sair da conta" fica no fim da lista, em vermelho. Esc fecha.
- **Escolhas de "um entre vários"** (tema, avisos, filtro de ruído):
  - Cartões ou botões lado a lado.
  - O escolhido tem borda/fundo laranja **e** um ✓, nunca só a cor.
- **Aviso de versão nova** (`Atualizacao.jsx`):
  - Botão verde de download na barra de cima, à direita.
  - Balão estilo história em quadrinhos (fundo branco, borda grossa escura, sombra "chapada" deslocada, levemente inclinado), apontando para o botão.
  - Some sozinho em 10 s. É o único elemento "divertido" fora do padrão; não usar o estilo em outros avisos.
- **Medidor do microfone** (Foco na voz):
  - A barra fica verde quando a voz passa e cinza quando o portão está fechado.
  - Duas marcas laranja mostram o mínimo e o máximo da faixa.

## Forma e movimento

- **Raios:** 8 px nos itens de menu, 12 px nos painéis e 16 px nos diálogos.
- **Ícones:** Lucide, um estilo só.
- **Animação:** `fade-in` de 0,2 s. Respeita "reduzir movimento" do sistema.
