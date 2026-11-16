# P5-F.1-R3 — testes e resultados

Classificação:
- **E** — executado nesta etapa;
- **H** — herdado, sem reexecução;
- **RV** — reproduzido em revisão independente;
- **NE** — não executado.

Tudo rodou só no Emulator (`minhas-financas-local`) ou em Node puro, sem `skip`, `only` nem `todo`. Nenhum timeout de teste existente foi aumentado.

## 1. Testes novos

| Arquivo | Testes | O que provam |
| --- | --- | --- |
| `functions/src/cash/__tests__/projectionMarks.test.ts` | 13 | Impressão digital (ordem de chaves, tipos marcados, tipo desconhecido falha, fixture compartilhada); cadeia (fora de ordem, criação, edição sem efeito, exclusão, recriação, teto de 16, conflitos com a base, gerações, formato desconhecido); **poda** (só as gerações vigente e preparada ficam; L-PRI-02); **isenção de índices** dos 6 campos da marca; **propriedade INV-M** com a poda do gatilho: 4.000 cenários, 79.796 conferências e 954 podas, com entregas fora de ordem, reentregas, exclusões, recriações e reconstruções concorrentes |
| `functions/src/cash/__tests__/projectionMarks.integration.test.ts` (Emulator) | 16 | Ver §1.1 |
| `tests/unit/work-time-projection-proof.test.ts` | 30 | Paridade com o backend (impressões e visões geradas por ele; 9 e 18 casos); regras da prova (geração, bases, pendência, quebra, conteúdo, ausente com o lido presente, estornos); regressão T02 da R2A; regressão A02; **propriedade** da prova (6.000 casos, oráculo independente: provado ⇒ o documento é exatamente o aplicado) |
| `tests/unit/report-live-refresh-freshness.test.ts` | 7 | RR-R2A-04 com o `QueryClient` real |
| `tests/firestore/cash-projection-marks-p5f1r3-ataques.rules.integration.test.mjs` (Emulator) | 11 | Testes de ataque do revisor de segurança, sem mudança de lógica: leitura e escrita cruzadas entre dois workspaces pelos quatro papéis, não membros e anônimo, consulta de grupo, caminho × conteúdo, subcaminhos, workspace arquivado, teto do cliente (13 meses e 100 marcas numa transação), revogação no meio da transação, `verify` sem oráculo de existência e estado só do backend |
| `tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs` (Emulator) | 6 | Matriz de papéis, outro workspace, removido, suspenso, anônimo; consulta negada com e sem limite (1, 2 e 31); escrita negada a todos; consulta de grupo negada; transação só de leitura (viewer lê; escrita e outro workspace negados); paridade da impressão entre o SDK web e o Admin SDK num documento real |
| `e2e/work-time-b03.spec.ts` (Emulator) | 5 | B03-a a B03-e: outra sessão, indisponível, reconstrução, exclusões pessoais e mudança de mês, com registro de cada valor exibido, axe em desktop e em 375×812 |
| `tests/fixtures/transaction-fingerprints.json`, `tests/fixtures/projection-mark-views.json` | 9 e 18 casos | Gerados pelo backend (`sondas/gerar-fixture-*.cjs`) e conferidos pelo cliente |

### 1.1 Integração das marcas no Emulator (16)

1. Criação, edições, edição sem efeito, anulação, mudança de mês retroativa e exclusão: a marca acompanha cada conteúdo aplicado.
2. Evento posterior entregue antes do anterior: pendente, sem prova, absorvido quando o anterior chega.
3. Reentrega e entregas simultâneas: um delta, uma mudança de marca.
4. Falha dentro da transação não muda marca nem projeção; falha depois do commit não duplica.
5. Janela de retry esgotada: o delta perdido deixa a cadeia sem prova; a reconstrução recupera.
6. Marca `broken` por limite de pendências: registrada sem `needsRebuild`, cada delta entregue aplicado, recuperada pela reconstrução.
7. **(novo, revisão)** Incidente de marca depois do corte, durante a preparação: a publicação mantém o registro e a reconstrução seguinte o desliga.
8. Reconstrução com eventos posteriores ao corte, atrasados de antes do corte, reentrega e posterior fora de ordem; a etiqueta do mês segue a geração vigente depois da publicação **(verificação nova)**.
9. **(novo, A01)** Entrega com commit depois do corte que leu o estado antes do checkpoint: a publicação recomeça e a geração seguinte a cobre.
10. **(novo)** Muitas edições depois do corte, entregues antes do commit da página: a raiz no estado do corte evita o teto de pendências.
11. Lançamento sem histórico de marca: sem prova até a reconstrução, que o ancora.
12. Lançamento apagado: depois da reconstrução, fora da base e com parte zero.
13. Recriação com o mesmo id depois do corte: conflito vira `broken`, nunca prova falsa. **(estendido, A03)** O primeiro evento sobre a visão em conflito registra a recuperação uma vez; a reconstrução desliga.
14. Falha entre a preparação e a publicação: a geração vigente fica intacta.
15. **(novo, L-PRI-02)** Poda: uma entrega anterior ao corte, durante a preparação, regrava a marca e a âncora da preparada sobrevive. Depois da publicação, a regravação seguinte tira a posição superada, inclusive a âncora velha depois de uma segunda reconstrução. A visão continua limpa e o mês confere.
16. **(novo, F-02)** Corrida intercalada: o corpo do gatilho lê a marca e fica com a transação aberta enquanto a página tenta o commit da âncora com merge. A âncora sobrevive, a cadeia confere o conteúdo posterior ao corte e o mês tem 2.000. O gatilho fez o commit na 1ª tentativa e a página esperou.

## 2. Testes alterados e substituídos

- `tests/unit/work-time-consistency.test.ts` (30 → 38 testes), `work-time-income-estimate.test.ts` (21 → 21) e `work-time-guard.test.ts` (17 → 18): detalhados em `testes-substituidos.md`. A regra 5 antiga (espera limitada, `expired`) foi removida por ser presunção temporal; os testes que aprovavam por prazo foram substituídos pela garantia nova (nenhum prazo aprova). Depois da revisão:
  - o mundo de teste separa o documento guardado (sem `id`) do normalizado, o que matou o mutante R01;
  - a guarda exige `allow list: if false` nas marcas.
- `tests/unit/work-time-projection-proof.test.ts`: três testes reescritos para a regra mais restrita da A02. Ausente com o lido presente agora recusa; os casos de parte zero passaram a ser os do lançamento não encontrado. A propriedade teve o oráculo atualizado e a distribuição da leitura ajustada para o caso sem conteúdo aplicado, **sem mudar nenhum limiar de cobertura** (provados 1.461 ≥ 800; vivos 636 ≥ 600; nulos 1.881 ≥ 300).
- `tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs`: a consulta por ids, antes permitida até 30, passou a ser negada para todos (aperto das Rules).
- `functions/src/cash/__tests__/rebuildFence.integration.test.ts`: o teste de 500 meses usa páginas de 125, antes 250. As âncoras entram no orçamento de 500 escritas por commit; as asserções não mudaram.
- `functions/src/cash/__tests__/dayProjection.test.ts`: o literal do estado da projeção ganhou os campos novos.
- E2E: nenhuma substituição (`testes-substituidos-e2e.md`).

## 3. Execuções dirigidas

Horários em UTC, 2026-11-09. "W3" é o worktree da R3. "Cópia" é a cópia do backend com portas próprias do Emulator (`copia-mutantes-backend`), usada para as integrações enquanto o worktree era revisado. Os logs estão em `logs/execucoes/` no pacote.

| Horário | Execução | Onde | Resultado | Classe |
| --- | --- | --- | --- | --- |
| 17:14 | Integração das marcas, versão inicial (`int-marcas-1`) | W3 | 11/11 | E |
| 17:19 | Integração de caixa (`int-cash-1`) | W3 | **245/246**: falhou "P3-B — checkpoint suporta 500 meses e recusa passar de 600", porque as âncoras entraram no orçamento de 500 escritas com páginas de 250. O teste passou a usar páginas de 125, com as mesmas asserções (`testes-substituidos.md`) | E |
| 17:20 | `rebuildFence` (`int-fence-2`) | W3 | 22/22 | E |
| 17:31 | Rules das marcas, 1ª execução (`rules-marcas`) | W3 | **Falha de carga do arquivo:** `projectionProof.ts` usava propriedade de parâmetro do TypeScript, que o `--experimental-strip-types` do Node recusa. O código passou a declarar o campo | E |
| 17:31–17:35 | Rules das marcas e suítes vizinhas (`rules-marcas-transform`, `-resto`, `-oficial`) | W3 | 6/6; 12/12, 14/14 e 8/8; 6/6 | E |
| 17:50 | E2E `work-time-p5f` e `cash-pending-entries` (`t1`) | W3 | 21/21 | E |
| 17:53 | Unidade work-time e reports | W3 | 210/210; 107/107 | E |
| 17:56 | E2E B03, 1ª execução do spec novo (`t2`) | W3 | **0/5.** Asserções que falharam: "o saldo foi convertido" (B03-d e B03-e), a leitura da cadeia pelo próprio spec, um tempo de 60 s e o "alvo do 'Tentar de novo' com tamanho mínimo" de 24 px. Essa última asserção tinha sido escrita nesta etapa e saiu do spec. O critério 2.5.8 é da WCAG 2.2, e o gate do projeto é a WCAG 2.1; o botão é anterior à R3, e mudar o tamanho seria mudança visual fora do escopo (`matriz-requisitos.md`, "Não executado"; parecer pt-BR, I-02) | E |
| 18:08 | E2E B03 (`t3`) | W3 | **4/5:** B03-b esgotou o tempo esperando o link "Dashboard" | E |
| 18:15 | E2E B03 ×3 (`t4`) | W3 | 15/15 | E |
| 18:18 / 18:22 | RR-R2A-04: `cash-pending-entries` ×10 (`t5`) e ×5 sob carga (`t6`) | W3 | 20/20; 10/10 | E |
| 18:25–18:47 | Integração das marcas (`int-copia-marcas-fix-1` a `-3`) e as 7 suítes do gatilho (`int-copia-cash-fix-1`) | Cópia | 13/13, 13/13, 14/14; 108/108 (18:27, antes da correção A03 das 18:30) | E |
| 18:30 / 18:31 | Unidade das Functions | Cópia; W3 | **534/541 na cópia:** 7 falhas de montagem da cópia, sem `tests/fixtures` e com `firebase.json` reduzido. No W3: 675/675 | E |
| 18:32 | Rules das marcas (`rules-marcas-oficial-2`) | W3 | 6/6 | E |
| 18:39 | Unidade work-time e reports | W3 | 211/211; 107/107 | E |
| 19:00 | E2E B03 para a revisão pt-BR (`revisao-ptbr`) | W3 | 5/5 | E |
| 19:13 | Unidade work-time; Rules das marcas, oficial e ataques (`rules-marcas-oficial-3`) | W3 | 213/213; 17/17 | E |
| 19:16 | E2E B03 com a sequência de teclado (`r3-b03-teclado`) | W3 | **4/5:** no B03-b, 60 Tabs não levavam o foco a "Tentar de novo", porque o formulário das Configurações é longo. O limite do laço passou a 400 Tabs; é contagem de teclas, não timeout | E |
| 19:18 | B03-b com o limite novo (`r3-b03-teclado-2`) | W3 | 1/1 | E |
| 19:25 | Unidade das marcas com a poda (`unit-projectionMarks-poda`) | W3 | 12/12; INV-M com 954 podas | E |
| 19:31 | Integração das marcas com a poda (`int-copia-marcas-poda`) | Cópia | 15/15 | E |
| 19:32–19:37 | Mutantes da poda (`mutantes-backend-poda`) | Cópia | 5/5 mortos, base 15/15 | E |
| 19:39 | Integração das marcas com o teste 16, 1ª execução (`int-copia-marcas-f02`) | Cópia | **15/16:** erro do próprio teste novo, que chamava a reconstrução de novo depois da publicação e com isso iniciava uma segunda. O teste foi corrigido para só repetir enquanto não concluir | E |
| 19:41 | O mesmo, corrigido (`int-copia-marcas-f02b`) | Cópia | 16/16; o gatilho fez o commit na 1ª tentativa | E |
| 19:41 | Lint das Functions (`lint-functions-pre-verify`) | W3 | 0 erro, 201 avisos, os mesmos da R2A. Os arquivos da R3 não têm aviso novo | E |
| — | Unidade das Functions 675/675 e 676/676 (com a poda); cliente 211/211 e 107/107; sondas F1 a F4 | Revisor financeiro | ver parecer | RV |
| — | Unidade das Functions 675/675; cliente 211/211, 107/107 e 23/23; sondas de custo | Revisor de escala | ver parecer | RV |
| — | Suíte de ataques às Rules, teto de 13 meses e 100 marcas em 494 ms | Revisor de segurança | ver parecer | RV |
| — | Modelo aleatório com as funções reais: 20.000 cenários por configuração; 0 violação na árvore final; a sonda A01 reproduzida byte a byte | Revisor de arquitetura | ver parecer | RV |
| 21:18–21:59 | `verify:all` independente do gate, rodada 1, numa cópia da árvore `377c2f3f` (`verify-all-gate`) | Revisor do gate | **Saída 1.** `verify:fast` 1.746/1.746 e integração com Rules 1.289/1.289, iguais ao executor script a script. E2E **214/215**: `workspace-membership.spec.ts:169` (convite, aceite, troca de papel, remoção e perda de acesso) esgotou os 45 s do teste esperando o papel `admin` depois da troca. Causa ambiental comprovada (E-01): às 21:59:51 o cgroup de memória da sessão chegou ao limite (cerca de 13,35 GiB) e o kernel matou o `chrome-headless`; a callable que só nega permissão levou cerca de 20 s, contra 4 a 200 ms nas outras execuções. O spec e o caminho dele estão fora do delta da R3 | RV |
| 22:03 | O spec `workspace-membership` ×3, na mesma cópia (`e2e-membership-rerun`) | Revisor do gate | 6/6; o teste que falhou passou 3 de 3 | RV |

**Falhas intermediárias, mantidas no histórico** (§11 do pedido):
- `int-cash-1` (orçamento das âncoras);
- `rules-marcas` (sintaxe recusada pelo Node);
- `t2` (spec novo, 0/5);
- `t3` (B03-b, link "Dashboard");
- `r3-b03-teclado` (B03-b, foco com 60 Tabs);
- `int-copia-marcas-f02` (erro do teste novo);
- `functions-unit-copia-1` (montagem da cópia);
- E-01, na reexecução independente do gate: `workspace-membership.spec.ts:169`, por falta de memória do cgroup da sessão, com o OOM do kernel registrado. O teste está fora do delta da R3 e passou no executor e isolado (3 de 3), mas a falha continua neste histórico.

Nenhuma delas foi valor convertido errado. Em todas, a causa foi identificada e a execução seguinte do mesmo conjunto passou. A R2A teve 1 falha intermitente de E2E fora do delta (RR-R2A-04), investigada e corrigida nesta etapa (`rr-r2a-04.md`). A E-01 não aponta defeito do produto: o emulador de Functions cria um processo `node` por chamada concorrente de cada função e não encerra os ociosos, a suíte E2E termina perto do limite de memória deste ambiente desde a R2A, e a reexecução do gate passou dele no fim. Ela fica registrada como risco de reprodutibilidade (RR-R3-11, plano mestre §20.18). Os logs da reexecução, o trecho do `firebase-debug.log` e o relatório do OOM do kernel estão no pacote, em `logs/gate/`.

## 4. `npm run verify:all`

**Árvore:** `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`, o código final; depois dela só mudaram documentos em `docs/`.
**Execução:** 2026-11-09, de 19:42:32 a 20:22:55 UTC (2.423 s), na 1ª execução, com saída 0. O Emulator foi o projeto `minhas-financas-local`. A limpeza encerrou com SIGTERM a JVM do Firestore que o E2E deixou depois do Playwright (PID 21948, às 20:22:55); no fim, nenhum processo sobrou e a porta 8080 ficou livre (`limpeza=0`, `emulator-cleanup.log`). É comportamento conhecido do harness, sem efeito nos resultados. Metadados e resumo em `saidas/verify-all-final.meta.txt` e `saidas/verify-all-final.resumo.json`; o log completo está no pacote (`logs/verify-all-final.log`).

| Fase | Testes | Passaram | Falhas | Skip | Todo |
| --- | --- | --- | --- | --- | --- |
| `verify:fast` (typecheck, lint, builds, unidade) | 1.746 | 1.746 | 0 | 0 | 0 |
| Integração das Functions e suítes de Rules (Emulator) | 1.289 | 1.289 | 0 | 0 | 0 |
| Playwright (build E2E contra o Emulator) | 215 | 215 | 0 | 0 | 0 |
| **Total** | **3.250** | **3.250** | **0** | **0** | **0** |

Lint das Functions: 0 erro e 201 avisos, os mesmos da R2A, nenhum em arquivo da R3. TypeScript sem erro na raiz e nas Functions. Nenhum `skip`, `only` ou `todo`; nenhum timeout de teste aumentado.

**Reexecução independente (gate, rodada 1).** Mesma árvore, numa cópia do revisor, de 21:18:29 a 21:59:57 UTC (2.488 s), com saída 1: `verify:fast` 1.746/1.746 e integração com Rules 1.289/1.289, iguais ao executor script a script; E2E 214/215, pela E-01 (§3). A falha fica no histórico. Ela não altera o resultado da execução do executor, e ter passado isolada não a apaga.

## 5. Comparação com a R2A

| Script | R2A (`f8267922`) | R3 | Δ | Origem do delta |
| --- | --- | --- | --- | --- |
| `functions:test:unit` | 664 | 677 | +13 | `projectionMarks.test.ts` (novo, 13) |
| `test:unit:reports` | 100 | 107 | +7 | `report-live-refresh-freshness.test.ts` (novo, 7; RR-R2A-04) |
| `test:unit:work-time` | 174 | 213 | +39 | `work-time-projection-proof.test.ts` (novo, 30); `work-time-consistency.test.ts` 30 → 38 (+8); `work-time-guard.test.ts` 17 → 18 (+1); `work-time-income-estimate.test.ts` 21 → 21 |
| `functions:test:integration:emulator` | 969 | 985 | +16 | `projectionMarks.integration.test.ts` (novo, 16) |
| `test:rules:projection-marks` | — | 17 | +17 | Matriz das marcas (6) e ataques do revisor de segurança (11), as duas novas |
| Playwright | 210 | 215 | +5 | `work-time-b03.spec.ts` (novo, 5) |
| **Total** | **3.153** | **3.250** | **+97** | Só testes novos; nenhum script perdeu teste |

As substituições dentro de `work-time-consistency.test.ts` e `work-time-income-estimate.test.ts` (regra 5 antiga, por prazo) estão uma a uma em `testes-substituidos.md`. A duração foi de 2.423 s (R2A: 2.466 s). A R2A precisou de 3 execuções; a R3 passou na 1ª.

## 6. Não executado

- DEV, STAGING e PROD reais: proibidos.
- Exercício de restauração de DR: P7 e P10.
- WCAG 2.2, critério 2.5.8: o gate do projeto é a WCAG 2.1.
