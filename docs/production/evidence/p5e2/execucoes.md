# P5-E2 — execuções e resultados

Todas as execuções rodaram no worktree da P5-E2, contra o Emulator `minhas-financas-local`:
- Java 21.0.11 e Firebase CLI 15.32.1;
- loopback-proxy seguro só durante o comando;
- ao fim de cada execução, só a JVM órfã daquela execução foi encerrada, com SIGTERM e checagem de identidade.

Nenhum projeto real foi usado. Horários em UTC, 2026-10-17.

## Dirigidas, durante a implementação

| Etapa | Comando | Resultado |
| --- | --- | --- |
| Dependências | `npm ci` e `npm --prefix functions ci` | Saída 0; nenhum arquivo rastreado alterado. |
| Tipos | `npm run typecheck` (frontend e Functions) | Saída 0. |
| UI e guarda | `npm run test:unit:ui` | 9/9: 5 do pacote de ícones e 4 da guarda nova. A primeira execução reprovou o teste 9 da guarda: o regex `[^>]*` parava no `=>` de outra prop do `<Header>`. Era defeito do próprio teste; o regex foi corrigido para a linha inteira do `<Header … />` e passou na reexecução. |
| Sessão | `npm run test:unit:p1` | 131/131. |
| Histórico da IA | `npm run test:unit:ai-chat` | 37/37. |
| Notificações | `npm run test:unit:notifications` | 99/99. |
| Guarda não vazia | [`guarda-mutantes.md`](guarda-mutantes.md) | Reprova a base nos 4 testes e mata 5 mutantes de 5. |
| Espaços | `git diff --check` | Limpo. |
| E2E direcionado (fonte Poppins, a mesma do CI) | `ux-navigation-a11y`, `notifications-p5d2`, `notifications-private-state`, `notifications-mobile-p5e11`, `notifications-exit-race`, `ai-chat-isolation`, `split-flow`, `authenticated-smoke`, `app-smoke` | 49/49 em 5,9 min, sem retry, na árvore anterior à revisão. Depois dos ajustes da revisão, `ux-navigation-a11y` 7/7 (1,5 min), já com a ausência verificada na página inteira, inclusive oculta. |
| Evidência visual | Roteiro temporário, nas duas árvores | Antes: 6 combinações, 45 arquivos; o painel simulado no celular não fecha por toque fora (defeito da base, saiu junto). Depois: 6 combinações, 39 arquivos, 0 erros. Ruído: segunda execução do depois. Detalhe em [`visual/LEIAME.md`](visual/LEIAME.md). |

## Gate completo

Execução final sobre a árvore exata `2f8649da575123373020b254d2b0f066e3dbcb13`, registrada no início da execução:

| Item | Valor |
| --- | --- |
| Comando | `npm run verify:all` no worktree, como está |
| Início / fim | 2026-10-17T23:37:33Z / 2026-10-18T00:27:17Z (49,7 min) |
| Saída | 0 |
| Tipos e builds | `typecheck` OK; build do frontend e das Functions OK |
| Lint das Functions | 0 erros e 201 avisos (base: 201) |
| Unitários das Functions | 661/661 |
| Unitários do frontend | 793/793 (base: 789; +4 da guarda em `test:unit:ui`) |
| Integração das Functions (Emulator) | 969/969 |
| Ferramentas e Rules (Emulator) | 273/273 |
| E2E (Playwright) | 191/191 (19,9m); `retries` local = 0 e nenhum `flaky` |
| Skips, todo e cancelados | 0, 0 e 0 |

Uma 1ª execução, na árvore anterior aos ajustes da revisão independente, também saiu com 0: 2.696/2.696 `node --test` e 191/191 E2E em 50,6 min.

Depois da execução final, só os documentos mudaram, para registrar estes números (o plano, este arquivo e `VEREDITOS.md`).

## Totais contra o baseline

| Grupo | Base (`92e5a9c`, verify:all da E2E-FIX-01) | P5-E2 final | Diferença |
| --- | --- | --- | --- |
| Unitários das Functions | 661 | 661 | +0 |
| Unitários do frontend | 789 | 793 | +4 (`test:unit:ui` 5 → 9: guarda nova) |
| Integração das Functions | 969 | 969 | +0 |
| Ferramentas e Rules | 273 | 273 | +0 |
| E2E | 191 | 191 | 0 (o teste V-05 foi reescrito, não removido) |
| **Total** | **2.883** | **2.887** | **+4** |

Contagem por script comparada à base: só `test:unit:ui` muda. Nenhum teste foi removido, pulado ou enfraquecido. Os ajustes de teste são as sementes e o regex do módulo removido, a ausência do botão e o clique fora do menu da conta. Totais desta milestone: **PASS 2.887, FAIL 0, SKIP 0, RETRY 0**. Cobertura: o repositório não tem ferramenta nem limiar de cobertura versionado; a comparação é por contagem e inventário.
