# Evidência — D-18-NOTIF, retenção de notificações e "Excluir para mim" (2026-10-11)

As capturas foram feitas no build E2E contra o Emulator (`minhas-financas-local`), com o mesmo roteiro e os mesmos dados em duas árvores isoladas:
- "antes": a árvore da P5-C2, `dad5c72c`;
- "depois": snapshot do working tree com o código final da D-18-NOTIF (árvore `a526a96d`).

A semente é a mesma nas duas. Os eventos têm `expiresAt` (a árvore antes ignora o campo). O estado privado fica no caminho de cada árvore: `items` no antes, `notification_entries` no depois. Os relatórios registram o caminho usado (`estadosEm`).

**Telas** (desktop 1440×900 e celular 390×844 com toque, temas claro e escuro):
- `painel-owner`: lista com itens, um não lido.
- `painel-owner-acoes`: desktop com as ações no hover/foco.
- `painel-viewer`: sem "Excluir para mim".
- `painel-vazio`.
- Só no depois:
  - `confirmacao-excluir`: diálogo de confirmação;
  - `erro-excluir`: commit abortado, com a mensagem em pt-BR no diálogo;
  - `apos-excluir`: o item sumiu e o foco está no sino;
  - `painel-nada-exibir`: a página só com itens ocultos.

Total: 14 capturas no antes e 30 no depois.

## Diferenças (`diferencas-pixels.txt`, limiar 48 por pixel)

- **Desktop, 0,00%:** owner, viewer e vazio, nos dois temas. O painel e a lista não mudaram.
- **`painel-owner-acoes` desktop, 0,01%:** só o botão novo "Excluir para mim" ao lado de "Arquivar para mim", no hover/foco.
- **Celular, 6% a 21% nos painéis owner, viewer e vazio:** mudança necessária.
  - **Antes:** o painel, ancorado à direita do sino, ficava quase todo fora da tela, porque o cabeçalho quebra a linha e o sino vai para a esquerda. Ele ocupava x = −268 a 52, e o relatório "antes" registra `painelEsquerda: -268`. O defeito já existia na P5-C2, mas com a D-18 deixaria "Excluir para mim" inalcançável.
  - **Depois:** só quando há transbordo, o painel é deslocado para dentro da tela (`useKeepInsideViewport` em `NotificationsPanel.tsx`): x = 8 a 328 em 390. Sem transbordo, como no desktop, nada muda.
  - **Ações no celular:** sem hover, ficam sempre visíveis no canto inferior direito de cada item, com alvo ≥ 24 px.

## Acessibilidade e responsividade (`*-relatorio.json`)

- **Rolagem horizontal da página:** 0 em todas as telas, nas duas árvores.
- **axe-core (WCAG 2.0/2.1 A e AA, desktop claro):**
  - painel, ações, viewer, vazio e "nada para exibir": 0 violações;
  - diálogo assentado: 0 violações;
  - logo ao abrir, durante a animação de entrada de 0,2 s do `ConfirmationModal` (pré-existente), o axe registra contraste transitório no título; com o diálogo assentado, nenhuma violação.
- **Teclado (desktop):**
  - ordem do Tab: "Marcar exibidas como lidas", "Fechar notificações", "Excluir para mim: …", "Arquivar para mim: …";
  - Enter abre o diálogo, com foco inicial em "Cancelar";
  - Tab e Shift+Tab ficam presos no diálogo;
  - Escape fecha e o foco volta a "Excluir para mim: …";
  - depois de excluir, o foco vai para o sino ("Notificações, 1 não lida").
- **Diálogo:** `aria-describedby` aponta para a mensagem.
- **Erro:** commit abortado mostra "Sem conexão com o servidor. Verifique sua internet e tente novamente." dentro do diálogo; o item continua e nada é gravado.

## Outros arquivos

- `CUSTO.md`: acessos das Rules medidos no Emulator (5 fixos + 1 por estado criado; 15 criações por lote passam, 16 não) e leituras/escritas por ação.
- `mutacoes.json`: mutantes válidos, mortos e restaurados por SHA-256.
- `prova-remocao.txt`: busca do caminho antigo `items` e das escritas proibidas.

## Limites

- O Emulator não executa TTL. A remoção física não foi testada; os testes simulam a remoção pelo Admin SDK.
- O TTL está declarado em `firestore.indexes.json` e não publicado (E-07).
- O ponto em que o papel ainda é desconhecido (botão oculto) é coberto por teste unitário (`canDeleteNotifications`), não por E2E.
