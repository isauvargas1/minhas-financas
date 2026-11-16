PASS — regression release gate

# Gate de regressão — P5-F.1-R3, rodada 2

Revisor independente, somente leitura, em 2026-11-09, de cerca de 23:14 a 23:26 UTC. Skill `regression-release-gate`, com as mesmas regras e o mesmo formato do `references/release-checklist.md` da rodada 1 (`gate/PARECER-RODADA-1.md`).

O que este gate não fez:
- não alterou nenhum arquivo do worktree (WT), do repositório ou do plano;
- não usou Firebase, nem Emulator: a única execução foi um teste de unidade numa cópia própria, sob o lock `wt-r3-runtime.lock`;
- não rodou `npm run dev` nem `preview`, não fez commit, push nem deploy e não leu nenhum `.env*`.

**Decisão: PASS.**
- **O bloqueador da rodada 1 (B-01) está resolvido.** A privacidade reconferiu os documentos nas rodadas 3 (PASS, `ad1660a3`) e 4 (PASS, `99817712`), e as condições da rodada 4 valem contra o estado atual `d9f3059d`.
- **Os outros pareceres cobrem o estado final, nas condições que cada um declarou:**
  - segurança: PASS na rodada 3;
  - observabilidade: PASS nas rodadas 3 e 4;
  - plataforma: PASS na rodada 4;
  - escala: FAIL na rodada 3 pelo R3-M1, só de texto; corrigido; PASS na rodada 4.
- **O código não mudou.** O diff fora de `docs/` contra `377c2f3f` é vazio, então continuam valendo o `verify:all` do executor (saída 0, 3.250 testes) e a reexecução do gate na rodada 1. A única falha dela, E-01, é ambiental e comprovada.
- **A mudança de `docs/` não altera teste.** O único teste que lê `docs/` é a varredura de segredos. Reexecutei o arquivo com índice completo sobre `d9f3059d`: 5 de 5.

## 1. Escopo Git

| Item | Valor |
| --- | --- |
| Worktree | `<scratchpad>/wt-p5f1-r3`, branch local `feat/p5-f1-r3-2026-11-09`; `HEAD` `1730a1df0d3870ff52496933f45cb73a8dacd29b`; R3 sem commit; índice real intocado |
| Base da comparação | Árvore entregue da R2A `f82679226ec93e18f906731be09d0675326fd764` (objeto `tree`; não há merge-base) |
| Árvore de código | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`, sem mudança |
| Árvore atual do WT | `d9f3059dc57d0d18721ea95e414818941152f7ae`, calculada com índice temporário meu (`read-tree HEAD`, `add -A`, `write-tree`) |
| Fora de `docs/`, `377c2f3f` → `d9f3059d` | 0 arquivo |
| Árvores intermediárias | `ad1660a336f043c7331e158e9a85efdae17e277b` (rodada 3) e `998177124585f0e4ab478f2ddc0d42e421cbcb5f` (rodada 4), as duas objetos `tree` |
| Desde a rodada 1 (`914f8b69` → `d9f3059d`) | 45 arquivos, todos em `docs/` (37 novos e 8 alterados), +3.775/−30 |
| Desde a rodada 4 (`99817712` → `d9f3059d`) | 27 arquivos, todos em `docs/` (ver §3, "Depois da rodada 4") |

**O que mudou, por tipo (só `docs/`):**
- os pareceres das rodadas 3 e 4 e os seus hashes;
- 3 sondas novas de revisores, já presentes em `99817712`;
- os logs de sondas de escala e pt-BR, movidos de `logs/`, que o `.gitignore` ignora, para `saidas/`;
- as respostas (`respostas-gate-1.md`, `respostas-rodada-3.md`, `respostas-rodada-4.md`);
- a cópia do meu parecer da rodada 1;
- edições de texto em `testes-e-resultados.md`, `testes-substituidos.md`, `matriz-requisitos.md`, `revisoes/LEIAME.md`, no desenho (só §9), no plano (§20.18), em `OBSERVABILITY.md` (§13) e em `FIREBASE_PRODUCTION.md` (§5).

## 2. Evidências

| Etapa | Comando ou inspeção | Resultado | Artefato |
| --- | --- | --- | --- |
| Árvore e código | Índice temporário próprio; `git diff --name-only 377c2f3f d9f3059d` | `d9f3059d`; 0 arquivo fora de `docs/`. Blobs de `firestore.rules` `133b422e`, `firestore.indexes.json` `f4322d86`, `package.json` `b207ac92` e `firebase.json` `04e17615`, os fixados pela segurança | — |
| Execuções de código (herdadas, válidas) | `verify:all` do executor em `377c2f3f`; reexecução do gate, rodada 1 | Executor: saída 0, 3.250 testes, 0 falha, skip ou todo. Gate: `verify:fast` 1.746/1.746 e integração 1.289/1.289, iguais script a script; E2E 214/215 com E-01 ambiental e o spec isolado 6/6. Nada a reexecutar: o código não mudou | `p5f1r3/logs/verify-all-final.log`; `revisoes/gate/logs/` |
| Teste que lê `docs/` (RR-R3-12) | `node --test tests/unit/ai-backend-only.test.ts` numa cópia de `d9f3059d` (`git archive`), com índice git completo (árvore do índice = `d9f3059d`, sem commit), sob o lock | **5/5**, 0 fail, skip ou todo. A guarda de SDK de IA viu 262 arquivos `src`; a varredura de segredos, 763 arquivos, 137 deles em `docs/` | `revisoes/gate/logs/ai-backend-only-r2.log` e `.meta` |
| Outros leitores de `docs/` | Scripts com `--test`, `tsconfig.json`, `playwright.config.ts` | Nenhum `node --test` sem lista explícita; o `tsc` não inclui `docs/`; o Playwright só lê `e2e/`. O `sonda-r3-liberacao.test.mts` em `docs/` não é apanhado por nenhum executor | — |
| Padrão de segredo em `docs/` | `grep` do padrão de chave em todos os arquivos de `docs/`; `.ts` em `docs/` | 0 e 0 | — |
| Linhas acrescentadas desde a rodada 1 | Projeto de produção; padrões fortes de segredo | 0 e 0 | `revisoes/gate/added-lines-r2.txt` |
| Sondas novas em `docs/` | Busca por `initializeApp`, Admin SDK, rede e `child_process` | 3 sondas, todas já em `99817712`. Duas só importam a classe `Timestamp`; nenhuma inicia o Admin SDK ou acessa a rede | — |
| Cópias dos pareceres | `cmp` com os originais, depois da mesma troca de caminho do `copiar-pareceres.sh` | Observabilidade 3 e 4, plataforma 4, segurança 3 e os hashes: idênticos byte a byte. Privacidade 3 e 4 e escala 3 e 4: iguais depois da troca. A cópia de segurança tem sha256 `cd8a1c7c…`, igual ao original e a `hashes-rodada-3.txt`. A cópia do meu parecer da rodada 1 é igual ao original | — |
| Logs movidos (R4-I1 de escala) | `cmp` de cada `saidas/*.txt` com o original em `revisoes/<revisor>/logs/` | 18 de 18 idênticos (14 de escala e 4 de pt-BR); nenhum arquivo ignorado sobra em `docs/` | — |
| Marcadores | `grep '\[\[...\]\]'` no plano e na evidência | Sobram só `[[VEREDITO]]` (`LEIAME.md:5`) e `[[GATE]]` (`revisoes/LEIAME.md:31`), que dependem deste parecer; os de `respostas-gate-1.md` são citações | — |
| Plano mestre | §20.18, linha da P5 (56) e histórico (816) | §20.18 com as rodadas 3 e 4, os riscos RR-R3-11 a 14 e a linha da rodada 1 do gate fiel ao meu parecer. Estado e veredito "pendentes", como previsto | plano, linhas 5167–5180, 5219–5235 e 5239 |

## 3. Achados

### B-01 da rodada 1 — resolvido

| Condição de reconferência da privacidade (rodada 4, `PARECER-RODADA-4.md:142-151`) | Conferência contra `d9f3059d` | Resultado |
| --- | --- | --- |
| Os quatro documentos | `PRIVACY_LGPD.md` `de16a890`, `DATA_RETENTION_LIFECYCLE.md` `b622c9a2`, `DATA_MODEL.md` `59e2056d` e o desenho `7c4ab334`: os blobs registrados pelo revisor | Sem mudança |
| "Poda", "Privacidade" e RR-R3-08 da §20.18 | Depois de `99817712`, o plano só mudou nas linhas 5173, 5174 e 5177, que são as linhas de revisão | Sem mudança |
| Condição de implantação (plano 5148; `FIREBASE_PRODUCTION.md:201`) | Linha 5148 igual (sha256 da linha); `FIREBASE_PRODUCTION.md` `9f81074f` igual | Sem mudança |
| Fora de `docs/` | 0 arquivo | Sem mudança |
| Registros previstos (`[[R4-PRIV]]` no plano e em `revisoes/LEIAME.md:23`, e `[[REVISOES-ESTADO]]`) | Os três dizem "PASS, sem achado novo; o N-PRI-03 está no RR-R3-08, e o N-PRI-04 fica para a P8", como o revisor exigiu | Fiéis |

### L-01 da rodada 1 — resolvido

| Revisor | Veredito | Condições conferidas contra `d9f3059d` |
| --- | --- | --- |
| Segurança, rodada 3 (`ad1660a3`) | **PASS**: 0 HIGH, 0 MEDIUM, 0 LOW e 2 INFO | Fora de `docs/` e blobs fixados: iguais. `DATA_MODEL.md`, `PRIVACY_LGPD.md`, `AUTH_RBAC_WORKSPACES.md` `7c12f7cf` e `THREAT_MODEL.md` `39cca036`: iguais. Na §20.18, os itens que o revisor marcou como "conteúdo de segurança" ficaram assim: <ul><li>"Modelo de permissões" e Rollback: iguais;</li><li>condição de implantação: aplica o R3-I2, com o sentido do §6;</li><li>RR-R3-12: aplica o R3-I1, com os três testes, o critério "fora do índice" e a regra de reexecução;</li><li>RR-R3-08: ganhou um subitem de privacidade (ver G2-I1).</li></ul> A cópia do parecer tem sha256 `cd8a1c7c…` |
| Escala, rodada 3 → rodada 4 (`99817712`) | Rodada 3: **FAIL** pelo R3-M1 (MEDIUM, texto). Rodada 4: **PASS** | `firestore.indexes.json` `f4322d86` e desenho `7c4ab334`: iguais. As linhas de custo e risco da §20.18 (5137–5145, 5148, 5182–5188 e 5208–5212) estão iguais, por sha256. O R4-L1 foi corrigido com o texto literal sugerido (`matriz-requisitos.md:115`). O R4-I1 tem os logs em `saidas/`, idênticos |
| Observabilidade, rodadas 3 e 4 (`99817712`) | **PASS** nas duas | `OBSERVABILITY.md` `3156e647`, `RUNBOOKS.md` `e3211d04`, `INCIDENT_RESPONSE.md` `344dcf8d`, `BACKUP_RESTORE_DR.md` `61edcdb6` e `FIREBASE_PRODUCTION.md` `9f81074f`: iguais. Nenhum `.json` ou `.ts` em `docs/` com o padrão. Cópias idênticas. Na linha 5177 só mudou o marcador; o registro é fiel aos dois vereditos e aos INFO, e cita os nomes reais dos arquivos (R4-I3) |
| Plataforma, rodada 4 (`99817712`) | **PASS no escopo da R3** | Sem mudança no §5 de `FIREBASE_PRODUCTION.md`, em `BACKUP_RESTORE_DR.md`, na condição de implantação, no Rollback, no RR-R3-11 ou na linha de plataforma (5176). Nenhuma sonda nova depois de `99817712`. Cópia idêntica |

### Os outros achados da rodada 1

- **I-01:** corrigido. `testes-substituidos.md:11` diz 26 → 33 e 30 → 38; a matriz diz 38 e Rules 17/17.
- **I-03:** corrigido. `testes-e-resultados.md:107` registra o SIGTERM na JVM do E2E.
- **E-01:** no histórico (`testes-e-resultados.md` §3, linhas 89, 90 e 100, e §4, linha 118) e no RR-R3-11, com a descrição mais precisa: um processo por chamada concorrente, sem encerrar os ociosos.
- **L-02:** no RR-R3-12, com o R3-I1 de segurança e a regra de reexecução, que este gate cumpriu.
- **L-03:** no RR-R3-13.
- **I-05:** no RR-R3-14.
- **I-02:** só sobram os marcadores do gate.
- **I-04:** sem ação.

### Bloqueadores

Nenhum.

### INFO (novos)

- **G2-I1 — RR-R3-08 mudou depois da segurança, sem tocar conteúdo de segurança.**
  - **Onde:** a condição 3 do parecer de segurança da rodada 3 (`PARECER-RODADA-3.md`, §8) cita o RR-R3-08 entre os lugares do "conteúdo de segurança da §20.18". Depois de `ad1660a3`, o RR-R3-08 ganhou o subitem do N-PRI-03 (plano, linha 5207).
  - **O que o gate conferiu:** os seis subitens anteriores são idênticos aos de `ad1660a3`, inclusive o de segurança (impressões legíveis por membros e PR-RULES-02, I1). O subitem novo é o texto literal do N-PRI-03, conferido pela privacidade na rodada 4: o procedimento de exclusão e reconstrução da P8. Ele não afirma nada sobre autenticação, papéis, Rules, isolamento entre tenants, autorização de callables ou Storage.
  - **Conclusão:** o conteúdo de segurança não mudou, e a condição não foi acionada. Não exige ação.
- **G2-I2 — Arquivo com nome de teste em `docs/`.** `revisoes/escala-custo/sondas/sonda-r3-liberacao.test.mts` não é executado hoje, porque todo `node --test` do projeto recebe lista explícita. Um script futuro com descoberta automática do `node --test` o apanharia. Basta manter as listas explícitas ou, numa próxima edição, dar outro nome à sonda.

## 4. Skips e cobertura

O código é o da rodada 1, então as contagens são as mesmas:
- `verify:fast`: 1.746;
- integração e Rules: 1.289;
- Playwright: 215;
- total: 3.250, contra 3.153 da R2A (+97, só testes novos).

Nas duas execuções completas: 0 skip, 0 todo e 0 cancelled. A única falha é a E-01 da reexecução do gate, com causa ambiental comprovada. Nesta rodada: 5/5 no `ai-backend-only`, sem skip.

**Cobertura:** sem instrumentação no repositório, como na rodada 1. É anterior à R3.

## 5. Mudanças de superfície

Nenhuma desde a rodada 1:
- **UI, textos visíveis, rotas, contratos, Rules, índices, scripts e configuração:** sem mudança. A árvore fora de `docs/` é `377c2f3f`.
- **Documentação:** as mudanças são todas de texto em `docs/`, conferidas acima. Os textos novos estão em pt-BR.

## 6. Riscos residuais

Os da §20.18 (RR-R3-01 a RR-R3-14), aceitos e registrados. Os que vieram deste gate:
- **RR-R3-11 (E-01):** a suíte E2E termina perto do limite de memória do ambiente. Mitigação: separar o E2E em grupos, ou reiniciar o emulador de Functions entre eles.
- **RR-R3-12 (L-02):** três testes não veem arquivos fora do índice. Até a correção, todo gate de etapa sem commit reexecuta o arquivo com índice completo, como fiz nesta rodada.
- **RR-R3-13 (L-03):** a fixture de visões tem paridade unilateral.
- **RR-R3-14 (I-05):** dois scripts unitários ficam fora do CI.
- **Do R3-M1 de escala:** a liberação por volta da projeção relê a prova sem orçamento no cliente, até cerca de 720 vezes por hora por membro que escreve, cerca de 321 mil leituras por hora no teto. O limite vem das escritas do servidor. Fica para a P7, no RR-R3-09.
- **Sem cobertura instrumentada:** uma perda de cobertura de linha ou ramo não seria vista.

## 7. Bloqueadores para PASS

Nenhum.

## 8. Skills de domínio

| Skill | Rodada usada | Veredito | Estado coberto | Referência |
| --- | --- | --- | --- | --- |
| `financial-domain-integrity` | 2 | **PASS** | Código `377c2f3f`. As edições posteriores de documentos são de custo, estado e privacidade, e não tocam valor, delta nem prova | `revisoes/financeiro/PARECER-RODADA-2.md` |
| `multi-tenant-security-review` | 3 | **PASS** | Código `377c2f3f` + documentos `ad1660a3`, com as condições conferidas contra `d9f3059d` (G2-I1) | `revisoes/seguranca/PARECER-RODADA-3.md` |
| `firestore-scale-cost-review` | 4 | **PASS** (rodada 3 FAIL, R3-M1 corrigido) | Código + documentos `99817712`, com as condições conferidas | `revisoes/escala-custo/PARECER-RODADA-4.md` |
| `privacy-lgpd-data-lifecycle` | 4 | **PASS** | Código + documentos `99817712`, com as condições conferidas (B-01 resolvido) | `revisoes/privacidade/PARECER-RODADA-4.md` |
| `ptbr-product-ui-review` | 2 | **PASS** | Sem mudança de UI ou texto visível depois dela; os logs dela foram movidos idênticos | `revisoes/ptbr/PARECER-RODADA-2.md` |
| `observability-incident-readiness` | 4 | **PASS** | Código + documentos `99817712`, com as condições conferidas | `revisoes/obs-plataforma/PARECER-OBSERVABILIDADE-RODADA-4.md` |
| `firebase-production-readiness` | 4 | **PASS no escopo da R3** | Código + documentos `99817712`, com as condições conferidas | `revisoes/obs-plataforma/PARECER-PLATAFORMA-RODADA-4.md` |
| Arquitetura (pedido da R3) | 2 | **PASS** | §4, §6 e §10 do desenho sem mudança desde então; depois da rodada 1 do gate, o desenho só mudou no §9 | `revisoes/arquitetura/PARECER-ARQUITETURA-R3-RODADA-2.md` |
| `billing-entitlement-integrity`, `saas-commercial-readiness` | — | Não exigidas | O delta não toca essas superfícies | — |

## 9. Mudanças previstas depois deste parecer

**Aceito, sem nova rodada,** as mudanças listadas pelo coordenador:
1. `[[GATE]]` em `revisoes/LEIAME.md:31`.
2. `[[VEREDITO]]` em `LEIAME.md:5`.
3. Na §20.18, a linha "rodada 2: pendente, depois da reconferência de privacidade (rodada 3)." (5180) e o "**Estado.** Veredito da etapa pendente do gate final (`regression-release-gate`)." (5239).
4. A linha da P5 (plano, 56) e a do histórico de 2026-11-09 (816), no trecho "veredito pendente do gate final".
5. A cópia deste parecer como `revisoes/gate/PARECER-RODADA-2.md`.

**Condições:**
- **Só essas mudanças.** Qualquer outro arquivo, linha ou trecho fica idêntico a `d9f3059d`, e nada muda fora de `docs/`.
- **A cópia** é igual a este arquivo. Ele não tem caminho temporário, então o `sed` do `copiar-pareceres.sh` não muda nada.
- **Os textos novos reproduzem este parecer sem acrescentar nada:**
  - "PASS — regression release gate" na rodada 2, com a referência a `gate/PARECER-RODADA-2.md`;
  - se houver resumo, que diga que o B-01 foi resolvido pela reconferência de privacidade (rodadas 3 e 4), que nenhum código mudou e que a E-01 é falha ambiental registrada no RR-R3-11;
  - nenhuma afirmação de execução que não ocorreu, como "todas as execuções verdes".
- **A linha da P5 e o histórico** mantêm "não publicar; sem commit, push ou deploy" e não declaram a P5 concluída: o gate da P5 não foi iniciado.
- **Os registros dos vereditos de domínio**, se citados nesses trechos, continuam fiéis aos pareceres. É a mesma condição de privacidade, segurança, escala, observabilidade e plataforma.

**Exige nova rodada deste gate:**
- qualquer mudança fora de `docs/`, que também exige reexecução completa;
- qualquer outra mudança em `docs/`;
- um texto que não atenda às condições acima.
