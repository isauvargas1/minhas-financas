# P5-E1.1 — Execuções de validação (2026-10-13)

Todas as execuções foram feitas no Emulator do projeto `minhas-financas-local`, com o gateway de IA falso. Não houve chamada real ao Google, uso de credencial real nem acesso a produção. Os logs filtrados ficam em [`execucoes/`](execucoes/), sem as linhas do servidor web nem o progresso do build. Os brutos ficaram fora do repositório, por tamanho.

## Ambiente

- **Portas:** livres antes de cada execução (8080, 9099, 5001, 4400, 4500 e 9150), conferidas com `lsof`. O órfão da P5-E1 (PID 7545) já não existia ([`ambiente-porta-8080.md`](ambiente-porta-8080.md)).
- **Proxy local:** neste container, o `firebase-tools` manda até as requisições para 127.0.0.1 pelo `HTTPS_PROXY` e ignora o `NO_PROXY`. Por isso os comandos com Emulator rodaram envolvidos pelo proxy local de loopback ([`with-proxy-safe.sh`](diagnostico/ferramentas/with-proxy-safe.sh)), que só existe durante o comando e só é encerrado por identidade e SIGTERM.
- **Depois de cada E2E:** o Playwright deixa órfã a JVM do Firestore Emulator. Ela foi encerrada só com identidade, propriedade e ausência de uso comprovadas, por SIGTERM ao PID ([`encerramentos-emulator.txt`](encerramentos-emulator.txt)).
- **Árvore:** `verify:all` e as execuções abaixo rodaram no working tree do repositório, sem cópia e sem troca de portas.

## `npm run verify:all` (repositório, como está)

Comando `npm run verify:all`, no repositório (`/home/user/minhas-financas`), sem cópia e sem troca de portas, com o projeto `minhas-financas-local`.
- Início às 14:58:50Z, fim às 15:43:50Z (45 min).
- **Saída 0.**
- Log filtrado em [`execucoes/verify-all-final.txt`](execucoes/verify-all-final.txt).

| Etapa | Script | Resultado | P5-E1 |
| --- | --- | --- | --- |
| Typecheck | `typecheck` (frontend, `e2e/`, `tests/` e Functions) | sem erros | — |
| Lint das Functions | `functions:lint` | 0 erros, 201 avisos | 201 avisos |
| Build do frontend | `build` | ok; só o aviso preexistente de pacote acima de 900 kB | — |
| Build das Functions | `functions:build` | ok | — |
| Unitários das Functions | `functions:test:unit` | **661/661** | 639 |
| Unitários do frontend | 16 scripts `test:unit:*` | **789/789** (`notifications` 99, `billing` 72) | 763 |
| Integração das Functions no Emulator | `functions:test:integration:emulator` | **969/969** (18,8 min) | 941 |
| Ferramentas e Rules no Emulator | 2 scripts `test:tools:*` e 17 `test:rules:*` | **273/273** (`rules:notifications` 84) | 273 |
| E2E completo | `test:e2e` (`build:e2e` + Playwright) | **191/191** (18,6 min) | 169 |

**Totais:** 2.883 testes, contra 2.785 da P5-E1 (+98):
- 22 unitários das Functions: o contrato v2 do contexto;
- 26 do frontend: roteamento do clique, fusão de marcas, guarda do painel e contrato de transparência;
- 28 de integração: `aiMinimization`, de P01 a P28;
- 22 E2E: os 20 casos da spec nova, a regressão da corrida e a pergunta longa do diálogo.

Nenhuma falha, skip, `todo` ou cancelado. O Playwright não registrou `failed`, `skipped` nem `flaky`. Nenhum teste foi removido.

**Limpeza:** a JVM do Firestore Emulator que o Playwright deixou (PID 30143, iniciado às 15:25:39Z, depois do início da execução) foi encerrada com SIGTERM, depois de comprovadas a identidade, a propriedade e a ausência de uso. A porta 8080 ficou livre.

**Árvore:** a execução começou com a árvore `025e13ef` (índice temporário). Comparada à árvore final do pacote (antes do preenchimento dos campos de árvore em `VEREDITOS.md` e no plano mestre), `git diff --name-status` só lista arquivos de `docs/production/`, e nenhum fora de `docs/`:
  - `docs/production/PRODUCTION_READINESS_PLAN.md` (alterado)
  - `docs/production/evidence/p5e11/LEIAME.md` (alterado)
  - `docs/production/evidence/p5e11/VEREDITOS.md` (novo)
  - `docs/production/evidence/p5e11/diagnostico-notificacoes.md` (alterado)
  - `docs/production/evidence/p5e11/encerramentos-emulator.txt` (alterado)
  - `docs/production/evidence/p5e11/execucoes.md` (novo)
  - `docs/production/evidence/p5e11/execucoes/verify-all-final.txt` (novo)
  - `docs/production/evidence/p5e11/execucoes/verify-all-interrompido-1.txt` (novo)
  - `docs/production/evidence/p5e11/mutacoes.json` (novo)
  - `docs/production/evidence/p5e11/mutacoes.md` (alterado)
  - `docs/production/evidence/p5e11/revisao-independente.md` (alterado)
  - `docs/production/evidence/p5e11/revisao/rodada3-complemento.md` (novo)

Os campos de árvore, preenchidos depois, mudam só `VEREDITOS.md` e o plano mestre.

### Primeira execução, interrompida pelo executor (não conta para o gate)

A primeira execução começou às 14:28:13Z e foi interrompida às 14:58Z. A causa foi o limite de 30 minutos que o executor de comandos em segundo plano aplica por padrão: o comando foi disparado sem pedir o limite maior. Não foi falha de teste. O próprio executor encerrou o grupo de processos da execução, sem nenhum sinal enviado manualmente. Depois disso, nenhum processo nem porta ficou para trás (conferido com `lsof` e `ps`).

Até a interrupção:
- `verify:fast`: aprovado, com 661 unitários das Functions e 789 do frontend;
- integração das Functions: 969/969;
- ferramentas e Rules: 273/273;
- E2E: 27 aprovados e 0 falhas.

Log filtrado em [`execucoes/verify-all-interrompido-1.txt`](execucoes/verify-all-interrompido-1.txt). A execução que vale para o gate é a segunda, descrita acima, disparada às 14:58:50Z com o limite de 2 horas sobre a mesma árvore de código. Entre as duas, só mudaram arquivos de `docs/production/evidence/p5e11/`.

## Pré-teste dirigido na árvore final

Antes do `verify:all`, para não gastar uma hora numa falha simples, as três specs da P5-E1.1 rodaram juntas no repositório, nas portas padrão (14:24–14:27Z):

```
npm run test:e2e -- e2e/ai-consent-extraction.spec.ts e2e/notifications-mobile-p5e11.spec.ts e2e/notifications-exit-race.spec.ts --reporter=list
```

Resultado: **33/33 em 3,0 min**, 0 falhas e 0 skips ([`execucoes/e2e-specs-p5e11-final.txt`](execucoes/e2e-specs-p5e11-final.txt)):
- `ai-consent-extraction`: 12/12, inclusive o caso novo da pergunta longa (citação que rola e fica alcançável pelo teclado);
- `notifications-mobile-p5e11`: 20/20, os 18 casos do §9.3 mais o 19 e o 20;
- `notifications-exit-race`: 1/1, com as 10 rodadas da corrida.

## Repetições do teste do celular

Spec original `e2e/notifications-p5d2.spec.ts`, sem alteração (SHA-256 começando com `08fd30570851559b`), `--grep celular --repeat-each=40`, sem retries:
- **rodada 5, na árvore final (14:08–14:24Z): 80/80**, com 40/40 no tema claro e 40/40 no escuro, maior série de 40 nas duas variantes, em 15,4 min ([`repeticoes/repeticoes-5-final.txt`](repeticoes/repeticoes-5-final.txt));
- rodadas 1 a 4 e as instrumentadas: [`repeticoes-mobile.md`](repeticoes-mobile.md).

## Capturas e acessibilidade

- **Antes e depois** ([`visual/`](visual/)): 30 capturas de cada lado, no mesmo estado, viewport e tema, geradas pela spec de evidência (`visual/p5e11-evidence.spec.ts.txt`) contra a árvore da P5-E1 e a árvore final.
  - Painel e sino: 0,00% de diferença em todas as 24 capturas.
  - Diálogo da análise: muda pelo texto novo.
  - axe idêntico antes e depois: só o débito de contraste registrado na P5-D2.
- **Diálogo** ([`capturas/`](capturas/)): 8 capturas, desktop 1280×800 e mobile 390×844, tema claro, gravadas pela spec `ai-consent-extraction` com `E2E_CAPTURE_DIR`.

## Mutações

[`mutacoes.md`](mutacoes.md): 54 mutantes, 54 mortos (cada morte conferida no log por uma asserção reprovada), 0 sobreviventes e 0 inválidos, com a restauração conferida por SHA-256 em todos.

## Desvio: Emulators simultâneos (13:36–13:44:31Z)

O pedido manda não executar Emulators concorrentes. Isso não foi cumprido numa janela de cerca de 8 minutos: os mutantes de integração (X02, X12–X15 e X18) rodaram com `firebase emulators:exec` na porta 8180 ao mesmo tempo que execuções E2E em cópias do working tree, com o Emulator na porta 8280. A sobreposição foi esta:

| Execução E2E na cópia (8280) | Horário | Uso do resultado |
| --- | --- | --- |
| primeira captura "depois", antes da correção de acessibilidade | 13:35:56–13:40:50Z | descartada como intermediária e refeita |
| `ai-consent-extraction` depois da correção de acessibilidade | 13:41:29–13:44:01Z | 11/11; substituída pelo pré-teste da árvore final (12/12) e pelo `verify:all` |
| captura "depois" final | 13:44:03–13:48:57Z, com 28 s de sobreposição no início | capturas e axe de `visual/` |

Portas, diretórios, dados do Emulator e processos eram distintos, e cada JVM só foi encerrada pela identidade da própria execução. Os mutantes dessa janela morreram por asserção conferida no log. Nenhum resultado que sustenta o gate veio dessa janela: a rodada 5 das repetições, o pré-teste dirigido e o `verify:all` rodaram sozinhos, sem outro Emulator ativo.

## Execuções em árvores intermediárias (registradas, não contam para o gate)

| Quando | O quê | Resultado | Por que não conta |
| --- | --- | --- | --- |
| 12:51Z | `notifications-mobile-p5e11` | 20/20 | antes do foco na reentrega (L3/L4) |
| 13:44Z | `ai-consent-extraction` | 11/11 | antes do caso da pergunta longa (L8) |
| 14:07Z | `test:unit:notifications`, `test:unit:billing` e typecheck | 99/99, 72/72, sem erros | substituídos pelo `verify:all` |
| rodadas 1–4 | repetições do celular | ver `repeticoes-mobile.md` | a rodada 5 é a da árvore final |
