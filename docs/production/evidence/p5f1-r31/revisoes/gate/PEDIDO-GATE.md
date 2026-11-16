Você é revisor independente, somente leitura, e executa o gate `regression-release-gate` da etapa P5-F.1-R3.1 do repositório `minhas-financas`. Carregue a skill `regression-release-gate` pela ferramenta Skill e leia integralmente o `references/release-checklist.md` dela antes de validar. Siga o formato de relatório do checklist.

**O pedido da etapa** (a especificação, como recebido): `$S/p5f1r31/relatorio/pedido-r31.md`. Ele manda corrigir só o achado R3-AUD-01 e encerrar com PASS somente se o comportamento inseguro estiver eliminado e a regressão completa aprovada.

**Base e árvores** (S=<scratchpad>)
- Worktree: `$S/wt-p5f1-r31`, branch local `feat/p5-f1-r31-2026-11-10`. HEAD no commit-base `1730a1df0d3870ff52496933f45cb73a8dacd29b`. A árvore da R3.1 fica no diretório de trabalho, sem commit.
- **Base da comparação:** a árvore final da R3, `1c9155dbc8d6aedd35e6f39a63fac46b53d81919`, um objeto tree do repositório.
  - Compare árvore com árvore.
  - Para a árvore atual do worktree, use um índice temporário: `GIT_INDEX_FILE=<tmp> git read-tree HEAD && GIT_INDEX_FILE=<tmp> git add -A && GIT_INDEX_FILE=<tmp> git write-tree`. O índice real não é tocado. O roteiro `$S/p5f1r31/tree-now.sh` faz isso.
  - `git diff` sem argumentos mostra o acumulado sobre o commit-base e esconde os não rastreados.
- **Código final:** árvore `d9fed573c803d64827ba278c347215054a31e0d2`, onde rodaram os mutantes finais.
- **`npm run verify:all` do executor, três execuções** (logs em `$S/p5f1r31/logs/verify-all-<n>.log`, com `.meta` (início, fim, saída, árvore e limpeza do Emulator), `.resumo.json` e `-memoria.txt`):
  - `verify-all-1`, árvore `40057d2a` (anterior às revisões): saída 0.
  - `verify-all-2`, árvore `b841ec69`, só `docs/` diferente de `d9fed573`: **saída 1**, falha intermediária no E2E `e2e/workspace-membership.spec.ts:169` (215 de 216). O executor sustenta que é ambiental: o processo a frio de `removeWorkspaceMember` no emulador de Functions, sob pressão de memória (RR-R3-11), a mesma assinatura do E-01 do gate da R3. Evidência em `$S/p5f1r31/evidencia/verify-all-2-falha/`; a reexecução isolada (3 de 3) está em `$S/p5f1r31/logs/e2e-membership-isolado.log`. Confira a causa: não aceite "flake" sem ela.
  - `verify-all-3`, árvore `9d688d9c`: **saída 1**, outra falha intermediária no E2E, no preparo do B03-e (`socket hang up` no `POST` de `createCashAccount`, sem registro no emulador). Evidência em `$S/p5f1r31/evidencia/verify-all-3-falha/` e a reexecução isolada (3 de 3) em `$S/p5f1r31/logs/e2e-b03-e-isolado.log`. O B03-e é da superfície da R3.1: confira que a falha está no preparo e não no comportamento.
  - `verify-all-4`, árvore `30abca0f`: **saída 1**, de novo `workspace-membership.spec.ts:169`, com o OOM do `chrome-headless` no registro do kernel (`$S/p5f1r31/evidencia/verify-all-4-falha/dmesg-oom.txt`).
  - Depois disso, o executor refez só a etapa E2E em três grupos de arquivos, cada um com o próprio Emulator (`$S/p5f1r31/e2e-em-grupos.sh`; `$S/p5f1r31/logs/e2e-grupos.meta`, `e2e-grupo-<n>.log`, `e2e-grupos-memoria.txt`). Ele sustenta que a regressão completa está provada por partes: unidade, integração, Rules e lint verdes nas três execuções completas, e os 216 E2E nos grupos. Julgue se isso basta para o pedido ("a regressão completa for aprovada") ou se exige outra coisa, e com que justificativa. O RR-R31-07 registra o problema de processo.
  - Se você rodar o próprio `verify:all`, considere o mesmo limite de memória: o RR-R3-11 e o E-01 da R3. Os grupos podem ser refeitos com `bash $S/p5f1r31/e2e-em-grupos.sh`, que grava em `logs/e2e-grupo-*`.
  - Depois das execuções na árvore final (`verify-all-2` a `verify-all-4` e os grupos), só podem ter mudado arquivos em `docs/`: confira comparando a árvore atual com a de cada `.meta` (e com a árvore de código `d9fed573`).
- **Comparação obrigatória com a R3** (`verify:all` final da R3, árvore de código `377c2f3f`): saída 0; 3.250 testes (`verify:fast` 1.746, integração e Rules 1.289, Playwright 215); 0 falha, 0 skip, 0 todo; lint com 0 erro e 201 avisos. O delta precisa ser explicado pelos testes novos.

**Evidência da etapa:** `docs/production/evidence/p5f1-r31/`, a começar por `LEIAME.md`, `matriz-antes-depois.md`, `testes-e-resultados.md`, `testes-substituidos.md`, `mutantes.md` e `revisoes/LEIAME.md`. As execuções dirigidas estão em `$S/p5f1r31/logs/` (logs completos) e em `saidas/` da evidência (filtrados). O relatório técnico e a reprodução estão em `$S/p5f1r31/relatorio/`. O plano mestre (§20.19) e o relatório podem ainda receber o veredito do gate.

**Pareceres de domínio** (o gate exige o PASS de cada skill da superfície tocada, sobre o estado final). Use a rodada mais recente de cada um, `PARECER-RODADA-2.md` quando existir:
- `$S/p5f1r31/revisoes/financeiro/` (`financial-domain-integrity`);
- `$S/p5f1r31/revisoes/ptbr/` (`ptbr-product-ui-review`);
- `$S/p5f1r31/revisoes/adversarial/` (revisão independente da eliminação do R3-AUD-01).

Decida, com evidência do diff, quais outras skills da tabela do gate a superfície toca. O executor sustenta que a R3.1 não toca:
- queries, listeners, schema ou índices;
- Auth, Rules ou callables;
- Billing;
- plataforma;
- dados pessoais;
- logging.

Confirme ou refute.

**O que auditar, além do checklist:**
- a eliminação do R3-AUD-01: nenhum caminho com conversão que não seja o estado atual com prova e sincronização concluída; o prazo só muda o texto; a conversão volta com a prova; avisos, "Tentar de novo", preferências e erros preservados;
- as áreas proibidas pelo pedido: Ledger ou saldos, `cash_projection_marks`, gatilhos, reconstrução, Rules, índices, Billing, RR-R2A-04 e estilos visuais;
- skips, `only` e `todo`;
- testes removidos, alterados ou substituídos, com cada justificativa em `testes-substituidos.md`;
- asserções relaxadas e timeouts aumentados;
- a contagem de testes contra a R3, com o delta explicado;
- lint e TypeScript;
- falhas intermediárias registradas, que devem constar do histórico mesmo com execuções verdes depois;
- referências ao projeto de produção `sistema-financeiro-pesso-20698`;
- scripts `deploy:*`;
- segredos;
- mudanças de UI fora do escopo;
- textos visíveis fora do pt-BR;
- os riscos residuais declarados. Em especial o RR-R31-05 (regra 1 da prova com base do cache), que o executor deixou fora do escopo: julgue se isso é compatível com o pedido.

**Execução.** O checklist pede executar o que puder ser executado.
- Você pode rodar `bash $S/p5f1r31/verify-com-memoria.sh gate-verify-all` no worktree. Ele roda o `verify:all` com o loopback-proxy, o projeto `minhas-financas-local` e a limpeza da JVM do Emulator, grava em `$S/p5f1r31/logs/gate-verify-all*` e só gera artefatos de build ignorados pelo git.
- Não rode nada em paralelo a ele: as portas e a memória são as mesmas. A memória do E2E é o RR-R3-11.
- O RR-R3-12 pede reexecutar `tests/unit/ai-backend-only.test.ts` com o índice completo (índice temporário com `git add -A`), porque a etapa não tem commit.
- Outras execuções só numa cópia sua em `$S/p5f1r31/revisoes/gate/sandbox/`.

**Regras invioláveis**
- Somente leitura: não altere código, testes, documentos ou configuração do worktree.
- Não acesse produção nem Firebase real.
- Não rode `npm run dev` nem `preview`.
- Não leia `.env*`, chaves ou tokens.
- Sem commit, push ou deploy.

**Saída:** grave `$S/p5f1r31/revisoes/gate/PARECER-RODADA-1.md`, começando com a decisão `PASS` ou `FAIL` no formato do checklist. No relatório final para mim: a decisão, cada etapa com o resultado e a evidência, os achados por severidade e os riscos residuais, em pt-BR claro.
