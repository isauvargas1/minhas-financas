PASS — Observability and incident readiness

Rodada 4 da etapa P5-F.1-R3, somente leitura. Confere as correções da rodada 3 e o restante do diff de documentos que toca esta superfície. Emitida em 2026-11-09, com leitura encerrada às 23:12 UTC.

O veredito vale para o escopo do diff da R3, pela "Política de decisão" da skill, e para o estado final descrito abaixo.
- O R3-L1 está corrigido exatamente como a exceção da condição de reconferência da rodada 3 previa.
- O R3-I3 e o PLAT-R3-I1 foram aplicados corretamente.
- Nada do restante do diff cria falha nesta superfície. Há três INFO novos (R4-I1 a R4-I3), nenhum bloqueante e nenhum que peça mudança agora.

O parecer de plataforma desta rodada está em `PARECER-PLATAFORMA-RODADA-4.md`, no mesmo diretório.

## Escopo e hashes

**Estado avaliado.**
- **Árvore de documentos:** `998177124585f0e4ab478f2ddc0d42e421cbcb5f`, o W atual. Conferi com um índice temporário próprio (`read-tree HEAD`, `add -A`, `write-tree`, em `sandbox/r4/`) às 22:57 e às 23:11 UTC. Não usei o índice real nem o `final.index`.
- **Árvore de código:** `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`. O diff fora de `docs/` contra a árvore de documentos sai vazio. O `verify:all` dela terminou com `exit=0`.
- **Base do diff:** `ad1660a336f043c7331e158e9a85efdae17e277b`, a árvore da rodada 3. Entre as duas mudaram 17 arquivos, todos em `docs/`.

**Blobs desta superfície** (rodada 3 → rodada 4):

| Arquivo | Rodada 3 | Rodada 4 | Mudança |
| --- | --- | --- | --- |
| `OBSERVABILITY.md` | `20b3fcc2` | `3156e6477d8ab6e31afbbe9db8edbadeab3d28e8` | Só a linha 471 (R3-L1) |
| `FIREBASE_PRODUCTION.md` | `111e05b7` | `9f81074fa3f64f6c913b774831c6e33d6086b3ea` | Só a linha 201 (ver o parecer de plataforma) |
| `PRODUCTION_READINESS_PLAN.md` | `028b12ef` | `c7b0fe2c8a28ab2e7638d55f63d2d9f02ed4e12c` | 5 trechos, todos na §20.18 (linhas 5108-5230) |
| `testes-e-resultados.md` | `5eae6580` | `8ef8849e0ad3b702ebf2d2576c4bc7adac9563c2` | Só a frase do PLAT-R3-I1 no §3 |
| `revisoes/LEIAME.md` | `558a81fe` | `f5e14adb5d85bd16efe3fc04accb9a85eb6b80f3` | Estados da rodada 3 e marcador da rodada 4 |
| `BACKUP_RESTORE_DR.md` | `61edcdb6` | igual | — |
| `RUNBOOKS.md` | `e3211d04` | igual | — |
| `INCIDENT_RESPONSE.md` | `344dcf8d` | igual | — |
| Cópia do meu parecer da rodada 3 | — | `b330507a12d93bae0bf10271bad992a14a454f5c` | Idêntica ao original, assim como as cópias das rodadas 1 e 2 e a de plataforma |

## Conferência

### 1. `OBSERVABILITY.md` (R3-L1)

- **Diff contra o blob `20b3fcc2`:** uma linha, a 471. "Políticas de alerta" passa de "A01–A20" para "A01–A21".
- **Prova byte a byte:** `20b3fcc2` tem uma única ocorrência de "A01–A20". Troquei essa ocorrência e o resultado tem exatamente o hash `3156e647`, igual ao da árvore e ao do W.
- **Conclusão:** é a exceção prevista na rodada 3. O resto do arquivo é o que conferi na rodada 3, e o veredito daquela rodada se mantém.

### 2. Plano, §20.18: trechos desta superfície

| # | Trecho | Conferência | Resultado |
| --- | --- | --- | --- |
| 1 | Resumo "Modelo de estados e invariantes" (`:5111`, R3-I3): a primeira gravação `broken` de cada cadeia (lançamento × geração) registra os seis campos e emite o log | Campos em `periods.ts:1194-1213`; "cada cadeia" em `:1387-1413`; o log, depois do commit, em `transactions.ts:307-313` | Confere |
| 2 | Linha de observabilidade (`:5177`): rodada 3 PASS; R3-L1 corrigido; R3-I3 e PLAT-R3-I1 nesta seção; R3-I1 e R3-I2 para a P7; R3-I4 sem ação; rodada 4 com `[[R4-OBS]]` | Fiel ao parecer da rodada 3. O R3-I3 foi aplicado só no resumo do plano. As faixas de linha da coluna Evidência do §2.1 ficaram como estavam, o que o R3-I3 aceitava ("sem ação na R3"), e `respostas-rodada-3.md` diz isso | Confere |
| 3 | RR-R3-11 (`:5219-5223`, PLAT-R3-I1): um processo por chamada concorrente de cada função, sem encerrar os ociosos. Os workers de `getFinancialReport` foram 6 na R2A, 7 no executor e 10 no gate, e o total foi o mesmo na R2A e na R3 | Detalhe no parecer de plataforma. Contei os `addWorker(` no `firebase-debug.log` do W da R3 (fim do `verify:all`, 20:22:55) e no da R2A: 96 e 96 no total; 7 e 6 de `getFinancialReport` | Confere |
| 4 | Condições de implantação, primeiro item (`:5148`), com o R3-I2 de segurança | Detalhe no parecer de plataforma | Confere |
| 5 | RR-R3-09, subitem de DR (OBS-L3) | Igual ao da rodada 3, byte a byte. O R3-I4 de escala confirma que os 9,3 h para 200 mil lançamentos valem com a página de 300 e com a de 500 (mesma capacidade absoluta) | Confere; `BACKUP_RESTORE_DR.md:123` continua certo |
| 6 | RR-R3-01, rollback e itens de restauração das condições de implantação | Iguais aos da rodada 3, byte a byte | Sem mudança |

### 3. `testes-e-resultados.md` §3 (linha 102)

A frase do E-01 passou a dizer que o emulador "cria um processo `node` por chamada concorrente de cada função e não encerra os ociosos". É o texto do RR-R3-11, e confere com `firebase-tools` 15.32.1 (`lib/emulator/functionsRuntimeWorker.js:242-268, 284-308`). Confere.

### 4. Mudanças fora desta superfície e o efeito delas aqui

**R3-M1 de escala (§9 do desenho, custos da §20.18 e novo subitem do RR-R3-09).** A afirmação nova confere com o código:
- na convergência, a sincronização libera (`basisSync.ts:443-446`) e chama `refreshIncomeReads` (`:428`);
- `refreshIncomeReads` invalida as leituras de receita sem agendador (`incomeReads.ts:27-30`), o que refaz a prova.

O efeito sobre esta superfície fica em dois pontos:
- **RR-R3-01:** não é afetado.
  - A frase "As releituras automáticas têm orçamento: 34 na primeira hora e 31 por hora depois" trata das releituras do agendador no estado pendente. O revisor de escala conferiu esses números contra o código (linha 128 do desenho) e a referência ao RR-R3-01 (linha 144 do desenho), na tabela do parecer da rodada 3 dele.
  - O caminho sem orçamento depende de escritas e está no RR-R3-09, na mesma seção, com a recomendação para a P7 "junto com a condição de parada do L3". Isso casa com a condição de parada que o RR-R3-01 já entrega à P7.
  - A atribuição do sinal à P7 (A21, §2.1, exibição a owner/admin) e os testes do log (OBS-L1 e OBS-L2) não mudam.
- **A21 (`OBSERVABILITY.md:277`):** a frase "o cliente relê dentro do orçamento" fica incompleta. Ver o R4-I1.

**N-PRI-03 de privacidade (RR-R3-08, `:5207`).**
- Confere com o código:
  - uma chamada com checkpoint de menos de 24 h retoma a reconstrução em andamento (`rebuild.ts:206, 288-289, 392-425`);
  - entrega coberta e exclusão ambígua gravam só a marca de entrega (`periods.ts:1340-1369`).
- Não muda nada nesta superfície. Traz uma consequência operacional para o runbook do A21 (R4-I2).

**R3-I1 de segurança (RR-R3-12, `:5224`).**
- Confere: as guardas em `ai-backend-only.test.ts:33, 46 e 76` usam `git ls-files` sem `--others`.
- Isso não muda o meu R3-I4, que não depende do índice. Refiz a varredura na árvore `99817712`:
  - `docs/` tem 137 `.json` e nenhum `.ts`;
  - o padrão de chave do Google aparece em 0 arquivo, em todo o `docs/`, versionado ou não;
  - nenhuma linha acrescentada desde `ad1660a3` casa com padrões de chave do Stripe, de webhook ou de chave privada.
- O único arquivo de teste novo em `docs/` (`escala-custo/sondas/sonda-r3-liberacao.test.mts`) não entra em execução:
  - nenhum script roda `node --test` sem lista explícita de arquivos;
  - o Playwright usa `testDir: './e2e'`;
  - os testes das Functions procuram em `functions/lib`;
  - o lint é só de `functions/`;
  - o `tsconfig.json` da raiz não inclui `docs/`.
- Portanto o `verify:all` de `377c2f3f` continua valendo para a árvore `99817712`.

**Outros arquivos** (pareceres e sondas de escala, privacidade e segurança, e o §9 do desenho fora do R3-M1): nenhum muda afirmação desta superfície.

## Mapa de sinais, correlação, auditoria e exercícios

Sem mudança desde a rodada 3. A linha do sinal novo fica assim:

| Sinal crítico | Log / métrica | Alerta | Destinatário | Runbook | Lacuna |
| --- | --- | --- | --- | --- | --- |
| Cadeia de marca quebrada | Log `cash_projection_mark.broken` e estado durável, os dois no §2.1 | A21, TARGET/E-08 na P7, agora também no registro da §13 (A01–A21) | Plantão técnico e responsável pelo domínio financeiro | RB-T04, linha Caixa; procedimento e condição de desligamento na linha do A21 | A configuração do alerta e a métrica ficam para a P7/E-08 (fora do escopo). Notas para a P7: R3-I1, R3-I2, R4-I1 e R4-I2 |

## Matriz de evidência

A mesma da rodada 3, com estas mudanças:
- **§5, Alertas:** PASS, agora sem o R3-L1.
- **§12, DR:** PASS (texto da R3). O DR e o rollback não mudaram, e o R3-I4 de escala confirma o número do passo 8.
- **§13, Testes obrigatórios:** PASS. A árvore de código e o `verify:all` são os mesmos.

As seções 3, 6, 7, 9, 10 e 11 continuam fora do escopo, com os mesmos IDs.

## Achados bloqueantes

Nenhum.

## Achados por severidade

### INFO (novos)

**R4-I1 — A frase do A21 sobre o orçamento das releituras está incompleta depois do R3-M1. Fica para a P7.**
- **O que diz:** "Enquanto durar, … o cliente relê dentro do orçamento".
- **Onde vale:** nas releituras que a própria falha da prova provoca. São as do agendador: 34 na primeira hora e 31 por hora depois.
- **Onde não vale:** com escritas que fazem a projeção divergir e voltar, a liberação relê a prova sem orçamento no cliente, também durante o aviso. O limite vem das escritas do servidor: até cerca de 720 voltas por hora por membro que escreve.
- **Por que é INFO, embora o revisor de escala tenha dado MEDIUM à mesma imprecisão:**
  - lá ela estava no modelo canônico de custo, que já foi corrigido;
  - aqui ela não muda sinal, condição, destinatário, runbook nem o efeito para o usuário (estimativa em reais, sem valor errado);
  - o caminho sem orçamento existe com ou sem aviso e está registrado no RR-R3-09, com recomendação para a P7.
- **Ação:** alinhar a frase na implantação do A21 (P7), junto com o R3-I1. Se o `OBSERVABILITY.md` for editado antes por outro motivo, acrescentar "(as do agendador; a liberação por volta da projeção, não: RR-R3-09)".

**R4-I2 — Desligar o A21 pode exigir uma segunda chamada da reconstrução. Fica para a P7, no runbook.**
- **O mecanismo:** uma chamada de `rebuildCashPeriods` com uma reconstrução em andamento (checkpoint com menos de 24 h) retoma essa reconstrução, com o corte antigo (`rebuild.ts:392-425`). Se esse corte for anterior a `markIssueMaxEventTime`, a publicação mantém `markRecoveryNeeded` (`:1633-1634`). Para desligar o aviso, é preciso uma chamada nova depois dela. É o mesmo mecanismo do N-PRI-03.
- **O texto do A21 continua exato:** "só desliga quando uma reconstrução publica com corte posterior".
- **Ação:** a RB-T04, na P7, deve dizer isso junto com a condição de desligamento (R3-I1).

**R4-I3 — O `revisoes/LEIAME.md` aponta para um arquivo que não existe.**
- **O problema:** a linha da rodada 4 cita `obs-plataforma/PARECER-RODADA-4.md`, mas os pareceres desta rodada são `PARECER-OBSERVABILIDADE-RODADA-4.md` e `PARECER-PLATAFORMA-RODADA-4.md`. O `copiar-pareceres.sh` copia os dois.
- **Ação:** corrigir o nome ao preencher o `[[R4-OBS]]`. Não exige reconferência.

### Estado dos achados anteriores

| ID | Estado |
| --- | --- |
| R3-L1 (LOW) | **Resolvido** (item 1 da conferência) |
| R3-I1, R3-I2 (INFO) | Para a P7, como o plano e as respostas registram. Juntam-se ao R4-I1 e ao R4-I2 |
| R3-I3 (INFO) | Resolvido no resumo do plano. As faixas de linha ficaram, como o achado permitia |
| R3-I4 (INFO) | Sem ação e ainda válido na árvore `99817712` |
| OBS-L1, OBS-L2 (LOW) | Mantidos, sem bloquear (RR-R3-01) |
| OBS-B1, OBS-L3, OBS-I1, R2-I1 | Resolvidos |
| OBS-I2 a OBS-I6; R2-I2, na parte da RB-T04 | Mantidos (P7) |

## Fora do escopo desta avaliação

O mesmo da rodada 3: PR-OBS-01, PR-OBS-02, E-08, PR-TX-04 e TX-15 (P7), PR-BKP-01, E-07 e D-27 (P7/P10), PR-ADMIN-01, e RR-R3-01, RR-R3-05 e RR-R3-09. O custo da liberação por volta da projeção (R3-M1) é tema de `firestore-scale-cost-review` e já está no RR-R3-09.

## Condição de reconferência

Este parecer vale para a árvore de documentos `99817712` com o código `377c2f3f`.

**Nenhuma das mudanças previstas exige reconferência**, desde que:
1. **Cópia:** a cópia deste parecer e a do parecer de plataforma, feitas pelo `copiar-pareceres.sh`, sejam idênticas aos originais. Os dois não têm caminho temporário, então o `sed` do script não deve mudar nada.
2. **Registros:** o `[[R4-OBS]]` no plano e no `revisoes/LEIAME.md`, o `[[REVISOES-ESTADO]]` e, depois do gate, os marcadores de veredito, a linha da P5 e o histórico registrem com fidelidade:
   - os dois vereditos (observabilidade PASS e plataforma PASS no escopo da R3);
   - os INFO desta rodada;
   - os nomes reais dos arquivos (R4-I3).
3. **Plano:** nenhuma outra frase da §20.18 desta superfície mude. São elas:
   - o resumo do modelo (`:5111`);
   - as condições de implantação e de restauração;
   - as linhas de plataforma e de observabilidade, salvo o marcador;
   - o RR-R3-01, o subitem de DR do RR-R3-09 e o RR-R3-11;
   - o rollback.

**Exigem reconferência:**
- **qualquer mudança fora de `docs/`:** reconferência completa, com novo `verify:all`;
- **qualquer mudança nestes documentos:** `OBSERVABILITY.md`, `RUNBOOKS.md`, `INCIDENT_RESPONSE.md`, `BACKUP_RESTORE_DR.md` ou `FIREBASE_PRODUCTION.md`. Agora sem exceção;
- **um `.json` ou `.ts` em `docs/`** que case com o padrão da varredura de segredos;
- **mudança em script de teste** que passe a procurar arquivos em `docs/`. Isso já seria mudança fora de `docs/`.

## Verificação

Somente leitura. Não usei Emulator, build nem testes, não acessei Firebase real e não li segredos. As correspondências de padrões de segredo foram mostradas mascaradas. Escrevi só neste diretório (`sandbox/r4/` e os dois pareceres).

1. **Árvores:**
   - índice temporário próprio, que deu `99817712` duas vezes;
   - diff fora de `docs/` contra `377c2f3f`, vazio;
   - `--name-status` de `ad1660a3` → `99817712`: 17 arquivos, todos em `docs/`.
2. **`OBSERVABILITY.md`:** diff de uma linha e prova pelo hash da troca única (`sandbox/r4/OBS-r3-com-troca.md` → `3156e647`).
3. **Plano:**
   - diff completo (`sandbox/r4/diff-plano.patch`, 5 trechos);
   - comparação byte a byte, entre as duas árvores, do RR-R3-01, do rollback, dos itens de restauração, do subitem de DR do RR-R3-09 e da linha de plataforma.
4. **Código lido** (árvore `377c2f3f`):
   - `periods.ts:1194-1213, 1340-1369, 1387-1413`;
   - `transactions.ts:307-313`;
   - `rebuild.ts:206, 288-289, 392-425, 1633-1634`;
   - `basisSync.ts:418-450`;
   - `incomeReads.ts:14-32`;
   - `tests/unit/ai-backend-only.test.ts:26-90`;
   - `package.json`, scripts de teste e `deploy:*`;
   - `playwright.config.ts:39`;
   - `functions/package.json`, scripts de teste.
5. **Contagens no `firebase-debug.log`:** só linhas com `addWorker(`, sem imprimir conteúdo. W da R3: 96 no total e 7 de `getFinancialReport`. W da R2A: 96 e 6.
6. **`firebase-tools` 15.32.1:** `lib/emulator/functionsRuntimeWorker.js:228-320`.
7. **Buscas na árvore `99817712`:**
   - padrão de chave do Google em `docs/`: 0 arquivo;
   - padrões de Stripe, webhook e chave privada nas linhas acrescentadas: 0. As ocorrências antigas em `FIREBASE_PRODUCTION.md` e no plano são todas valores de exemplo (o prefixo de chave de teste do Stripe ou o de segredo de webhook, seguido da palavra "placeholder"), iguais às de `ad1660a3`;
   - identificador do projeto de produção nas linhas acrescentadas: 0;
   - nenhum script com `node --test` sem arquivos.
8. **Documentos lidos:** `respostas-rodada-3.md`, o parecer de escala da rodada 3 (R3-M1 e R3-I4), as linhas acrescentadas do `revisoes/LEIAME.md` e do desenho, e as cópias dos meus pareceres (hashes).
