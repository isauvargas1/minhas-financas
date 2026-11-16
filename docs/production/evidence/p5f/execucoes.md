# P5-F — execuções e resultados

Todas as execuções rodaram no worktree da P5-F, contra o Emulator `minhas-financas-local`:
- Java 21.0.11 e Firebase CLI 15.32.1;
- loopback-proxy seguro só durante o comando;
- ao fim de cada execução, só a JVM órfã daquela execução foi encerrada, com SIGTERM e checagem de identidade.

Nenhum projeto real foi usado. Horários em UTC, 2026-10-18 e 2026-10-19. Roteiros: `run-pw.sh.txt`, `run-emu.sh.txt` e `run-verify-all.sh.txt`.

## Dirigidas, durante a implementação e as revisões

| Etapa | Comando ou roteiro | Resultado |
| --- | --- | --- |
| Rules, 1ª execução (10-18) | `test:rules:work-time` | 9/10. Reprovou o teste "troca de usuário no mesmo cliente", que também exigia que o cache local do SDK não tivesse mais o documento da conta anterior. A sonda mostrou que o SDK 12 mantém documentos lidos em memória até recarregar a página ([`cache-sdk.md`](cache-sdk.md)). O teste passou a exigir a negação no servidor, e o achado ficou registrado como risco de plataforma, com a guarda que proíbe ler do cache. |
| Rules, 2ª execução | idem | 10/10 |
| Unitários (10-18) | todos os `test:unit:*` do frontend | Verdes; `test:unit:work-time` na versão da época |
| E2E da P5-F, desenvolvimento | `run-pw.sh` (`e2e-wt-1` a `e2e-wt-3`) | As duas primeiras iterações reprovaram em asserções do próprio teste, ajustadas antes da suíte completa (o perfil server-owned também tem `updatedAt`). A terceira passou 4/4 |
| E2E completo, antes da revisão | `run-pw.sh` (`e2e-full-1`, 18,8 min) | 195/195 (191 da base + 4 da P5-F) |
| Transbordamento a 360 px | `e2e-overflow-vermelho` e `-verde` | A asserção nova reprovou o build sem a correção (68 px) e passou com ela, 4/4 |
| E2E dirigido, depois das correções da revisão 1 | 7 specs: caixa manual, relatórios, investimentos (2), recorrências, divisão e P5-F | 48/48 (5,0 min) |
| Recusa offline e varredura com `listDocuments` | `e2e-offline` | 19/20. O teste 4 reprovou: a varredura nova olhava o JSON de cada documento e achou "440000" no `_nanoseconds` de 5 carimbos de tempo (falso positivo). `carriesIncome` passou a percorrer os valores e a ignorar carimbos de tempo. Na reexecução, `e2e-offline-2`, 4/4 |
| Evidência visual | `run-evidence.sh`, rodadas r1 a r6 | Detalhe e correções em [`visual/LEIAME.md`](visual/LEIAME.md). Final: "antes" r5 e "depois" r6 |
| Mutantes de unidade e guarda | `mutantes.py` | 59/59 na rodada final. Antes: 40/40, depois 52/52, 54/54 e 57/57 nas rodadas intermediárias |
| Mutantes das Rules | `mutantes-rules.py` | 15/15 (R11 sobreviveu na 1ª rodada; a suíte foi reforçada) |
| Mutantes contra guardas anteriores | `mutantes-guarda-anterior.py`, `-r3.py`, `-sessao.py` e `-r4.py` | G5/G18, G30/G31, G32–G34 e G35/G36 passavam nas versões anteriores e morrem na final |
| Mutantes do E2E | `mutante-e2e-r3.py` e `mutante-e2e-logs.py` | A cópia da renda em reais passa na spec anterior à revisão 3. O texto puro `'4400'` passa na anterior à revisão 4. As três formas reprovam a spec final. Os logs com a renda (`console` e `pageerror`) também reprovam a spec final |
| Spec da P5-F, final | `run-pw.sh p5f-spec-r4` (build novo, Poppins) | 4/4 (1,3 min), com a captura de logs e a renda como texto puro |
| Tipos | `npx tsc --noEmit` (inclui `e2e/`) | Saída 0 |
| Espaços | `git diff --check` | Limpo |

## `verify:all` interrompidos

Três execuções foram paradas de propósito, sem resultado aproveitado, porque os testes mudaram no meio:
- **12:29 (árvore `8cb41a9d`):** parada às 12:35, quando a revisão 3 pediu o reforço da guarda e da varredura.
- **12:45 (árvore `8c072d25`):** parada às 12:58, para acrescentar a prova dos logs do navegador e a guarda da sessão.
- **13:03 (árvore `8a21b34b`):** parada às 13:15, quando a revisão 4 pediu `current` na guarda da sessão, o `converted` sem o nome da variável e a renda como texto puro no E2E.

Os logs ficaram fora do repositório. Nenhuma das três tinha falha registrada até a parada.

## Gate completo

Execução final sobre a árvore exata `9cc4e445565313dae409725571fb72be801f6cb8`, registrada no início da execução (índice temporário; o índice real não foi tocado):

| Item | Valor |
| --- | --- |
| Comando | `npm run verify:all` no worktree, como está (`run-verify-all.sh.txt`) |
| Início / fim | 2026-10-19T13:22:39Z / 2026-10-19T14:02:48Z (40,2 min) |
| Saída | 0 |
| Tipos e builds | `typecheck` da raiz (inclui `e2e/`) e das Functions OK; build do frontend (27,7 s) e o build E2E (25,9 s) OK; build das Functions OK |
| Lint das Functions | 0 erros e 201 avisos (base: 201) |
| Unitários das Functions | 661/661 |
| Unitários do frontend | 829/829 (base: 793; +36 de `test:unit:work-time`: cálculo 14, contrato e formulário 9, guarda 13) |
| Integração das Functions (Emulator) | 969/969 |
| Ferramentas e Rules (Emulator) | 283/283 (base: 273; +10 de `test:rules:work-time`) |
| E2E (Playwright) | 195/195 (17,0 min; base: 191; +4 de `e2e/work-time-p5f.spec.ts`, testes 189 a 192); `retries` local = 0 e nenhum `flaky` |
| Skips, todo e cancelados | 0, 0 e 0 |

Depois da execução final, só documentos mudaram: este arquivo, `VEREDITOS.md`, `LEIAME.md`, `mutantes.md`, os pareceres em `revisoes/`, os roteiros `.txt` e o plano. A prova com `git diff --name-only` entre a árvore do `verify:all` e a árvore final está no pacote de auditoria (`AUDITORIA-P5-F/DIFF-P5-F-estatisticas.txt`) e no relatório.

## Totais contra o baseline

| Grupo | Base (`1730a1df`, `verify:all` da P5-E2) | P5-F final | Diferença |
| --- | --- | --- | --- |
| Unitários das Functions | 661 | 661 | +0 |
| Unitários do frontend | 793 | 829 | +36 (`test:unit:work-time`, novo) |
| Integração das Functions | 969 | 969 | +0 |
| Ferramentas e Rules | 273 | 283 | +10 (`test:rules:work-time`, novo) |
| E2E | 191 | 195 | +4 (`e2e/work-time-p5f.spec.ts`, novo) |
| **Total** | **2.887** | **2.937** | **+50** |

**Por script:** fora as três suítes novas, todas as contagens são iguais à base. Nenhum teste foi removido, pulado ou enfraquecido.

**Totais desta milestone:** **PASS 2.937, FAIL 0, SKIP 0, RETRY 0.**

**Cobertura:** o repositório não tem ferramenta nem limiar de cobertura versionado; a comparação é por contagem e inventário.
