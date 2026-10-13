# Evidência visual — P5-D1, infraestrutura de notificações (2026-10-08)

Capturas do painel de notificações do Header no build E2E contra o Emulator (`minhas-financas-local`), com a mesma conta, o mesmo workspace e o mesmo roteiro na base (árvore da P5-A, sobre `f0c172b`) e na árvore da P5-D1. Os eventos são semeados pelo Admin SDK na forma de cada árvore: na base, com `read` no próprio evento; na P5-D1, sem `read` e com o estado privado do usuário em `notification_user_states/{uid}/items/{id}`.

- **Telas** (desktop 1440×900 e celular 390×844, claro e escuro): `vazio`; `com-notificacoes` (três avisos de fatura, um lido); `arquivada` (depois de arquivar o segundo); `paginacao-topo` e `paginacao-fim` (30 avisos). Só na P5-D1: `paginacao-carregada` (depois de "Carregar mais").
- **Comparação:** `diferencas-pixels.txt` — base × P5-D1 por captura (limiar 48 por pixel). As diferenças ficam dentro do painel:
  - cabeçalho do painel: o texto da ação passa de "Marcar todas lidas" para "Marcar exibidas como lidas" (0,04–0,05% da tela no desktop);
  - paginação: a base mostra as 30 de uma vez; a P5-D1 mostra 25, o contador "25+" e o botão "Carregar mais" (2,4–3,3% no desktop, no fim da lista).
  - Layout, cores, ícones, itens e estado vazio estão iguais.
- **Medições:** `antes-relatorio.json` e `depois-relatorio.json`:
  - rolagem horizontal 0 em todas as capturas;
  - nome acessível do sino: igual em vazio, com notificações e arquivada. Na paginação passa de "Notificações, 30 não lidas" (total lido da coleção inteira) para "Notificações, 25 não lidas entre as mais recentes";
  - axe-core (WCAG 2.0/2.1 A e AA) no Header com o painel aberto: base com 1 violação `button-name` (o "X" de fechar sem nome); P5-D1 com 0.
- **Achado anterior, não alterado:** no celular, o painel abre parcialmente fora da tela, à esquerda (posição `absolute right-0` relativa ao sino). Está igual na base e na P5-D1 (ver `*-mobile-*`). No roteiro, os botões do celular são acionados por evento. Corrigir exigiria mudar o layout, o que está fora do escopo.

Arquivos:

- `antes/` — 20 capturas da base;
- `depois/` — 24 capturas da P5-D1 (as 20 do mesmo roteiro e as 4 de `paginacao-carregada`).

O arquivo de captura (`p5d1-evidence.spec.ts`, fora da suíte) foi executado nas duas árvores e removido.
