# P5-F.1 — respostas à revisão independente 11

Cada achado de [`revisao-11.md`](revisao-11.md) e cada resíduo que ela apontou nos achados anteriores, com o que foi feito e onde está. A cópia de `revisao-11.md` é a do revisor, sem mudança. Execuções: `../execucoes.md`.

A revisão 11 não trouxe achado HIGH, MEDIUM nem LOW, e nenhum dos três INFO pediu mudança de código. R11-01 e R11-02 ficaram nos riscos da §20.15, com as condições, a atenuação e a correção sugerida, como a própria revisão oferece ("Ou registrar o caso nos riscos e ajustar as frases citadas"). R11-03 trata só de textos. Por isso o `verify:all` que rodava durante a revisão (o 14º, árvore `355b4d07`, saída 0, 3.073 testes) é o gate definitivo: depois dele, só mudaram documentos em `docs/`, com a prova no pacote de auditoria (`patches/mudancas-depois-do-verify-all.txt`).

## Resíduos dos achados anteriores

| ID | Situação na revisão 11 | Resposta | Prova |
| --- | --- | --- | --- |
| R10-01 | Corrigido | Sem mudança | — |
| R10-02 | Corrigido no caso novo; o resto, risco aceito | Sem mudança | §20.15, riscos |
| R10-03 | (1) corrigido; (2) corrigido em parte, com resíduos em R11-01 e R11-02 | **Os resíduos ficaram nos riscos, com R11-01 e R11-02** | Ver abaixo |
| R10-04 | Corrigido, com resíduo de texto | **Corrigido com R11-03** | Ver abaixo |
| R9-01, R5-02 | Corrigidos | Sem mudança | — |
| R9-04 | Corrigido; resíduo de contagem | **Corrigido com R11-03** | Ver abaixo |
| R9-02 | Corrigido no gancho; T1b em parte | **Os resíduos ficaram nos riscos, com R11-01 e R11-02** | Ver abaixo |
| R8-01 | Corrigido nos cenários apontados; resíduo anterior a esta rodada | **O resíduo ficou nos riscos, com R11-02** | Ver abaixo |
| R9-03, R7-01, R6-02 | Corrigidos nos cenários apontados; riscos registrados | Sem mudança | §20.15, riscos |
| R8-02, R1-19 | Riscos aceitos | Sem mudança | §20.15, riscos |

## Achados novos

| ID | Sev. | Resposta | Prova |
| --- | --- | --- | --- |
| R11-01 | INFO | **Registrado como risco.** A análise confere com o código. Com a volta antes de a leitura de antes da saída chegar, a troca de chave se junta à busca em curso (TanStack Query 5.0.0, sem `cancelRefetch`), e `fetchStatus` não distingue essa leitura da leitura na hora: a marca é consumida sem agendar. A leitura chega com o estado de antes do pedido e desfaz a desatualização; a base fica sem releitura pendente até o próximo sinal. Não é regressão: em `46abcd23` o resultado era o mesmo (P1). O caso pede, juntos, um pedido durante uma leitura do mês avulso, a saída e a volta da janela de 12 meses antes de essa leitura chegar, e a escuta reaberta na volta sem responder (encerrada de novo, com a ressalva) ou a mudança fora da receita das projeções (a reconstrução marcada). Com a escuta reaberta respondendo, o primeiro retorno do servidor compara e pede as duas bases. A correção sugerida (Z1: decidir a volta pela ordem do registro, com a guarda acompanhando e o T1b com a volta antes da chegada) está citada no risco e não foi aplicada: mudaria o código depois do gate definitivo por um valor transitório da estimativa informativa, num caminho estreito | §20.15, riscos ("Base que volta a ser usada antes de a leitura de antes da saída chegar", com o exemplo P1e da revisão: R$ 36.500,00 no lugar de R$ 36.000,00). Frases corrigidas: plano (atualização automática e o item da revisão 10), `DATA_MODEL.md`, `VEREDITOS.md` (a retenção e o custo da volta), `elegibilidade-receitas.md`, `autorizacao-isolamento.md` e uma nota em `respostas-revisao-10.md` |
| R11-02 | INFO | **Registrado como risco.** A análise confere com o código. A base atrás só conta com a releitura já agendada. A nova tentativa depois de uma falha é agendada no efeito das falhas, depois da renderização que mostra a falha, e a base marcada que volta é agendada no efeito do registro, depois da primeira renderização. Sem receita desconsiderada, essa renderização não tem retenção: mostra uma base nova com a antiga da outra, e `holdEstimate` a guarda. A retenção seguinte mostra esse estado, com a ressalva da falha, até a nova tentativa chegar. Com receita desconsiderada, a espera da leitura dependente cobre essa renderização. O caso é anterior a esta rodada (vem da retenção na renderização da revisão 9; P3 e P3e dão o mesmo em `46abcd23`) e precisa de um sinal sem pedido da escuta: a volta, a virada do mês sem troca do mês avulso ou o "Tentar de novo" com uma base já desatualizada. Com o pedido da escuta, a sincronização segura até as bases chegarem. As correções sugeridas (contar como a ser relidas a base marcada que volta e a desatualizada que falhou abaixo do teto, ou agendar a nova tentativa fora do efeito, com o teste da nova tentativa também sem receita desconsiderada) estão citadas no risco e não foram aplicadas, pelo mesmo motivo de R11-01 | §20.15, riscos ("Renderização sem retenção antes do efeito que agenda a releitura", com a duração: 5 s do agrupamento mais a leitura, até 2 min com o orçamento da escuta gasto, e uma nova falha levando ao teto; e o exemplo P3e da revisão: R$ 36.500,00 durante a nova tentativa, com a ressalva). Frases corrigidas: plano (atualização automática), `VEREDITOS.md`, `elegibilidade-receitas.md` e a nota em `respostas-revisao-10.md` |
| R11-03 | INFO | **Corrigido.** (1) `respostas-revisao-10.md` diz 50 testes de gancho, a contagem final daquela rodada: o 50º, o da base única, entrou com os sobreviventes dos mutantes, depois da resposta. (2) A nota de `respostas-revisao-9.md` diz 100 e 100, com 50 testes de gancho e 20 da estimativa inteira. (3) Onde se lia "dois testes novos" para U153 e U176, lê-se um teste novo (a base única) e uma parte nova do teste do registro (a leitura que falha): `mutantes.md` (refeito por `escrever-mutantes-md.py`, com a cópia `.txt` atualizada) e `execucoes.md` (as linhas dos unitários, das repetições e dos mutantes da revisão 10). (4) As frases de R11-01 e R11-02, como acima. (5) `LEIAME.md` põe os roteiros `atualizar-mutantes-r4` a `-r10` nas rodadas das revisões 4 a 10. O comentário da guarda ficou como está (abaixo) | Documentos |

## O que ficou como está

Mudar qualquer arquivo fora de `docs/` depois do `verify:all` definitivo anularia o gate. Por isso estes comentários ficaram como estão, com o texto certo nos documentos:

- `src/modules/reports/basisSync.ts:179-181`: "já em leitura (a chave trocada lê a desatualizada na hora)". A leitura em curso pode ser a de antes da saída (R11-01).
- `src/modules/reports/basisSync.ts:314-316`: a nova tentativa "segura a base nova da outra até chegar". Ela segura só a partir do efeito que a agenda (R11-02).
- `src/modules/reports/basisSync.ts:320-322`: "é relida quando volta, mesmo que a leitura em curso na saída termine depois" (R11-01).
- `tests/unit/work-time-guard.test.ts:382-385`: o comentário descreve a regra das bases fora de passo de antes da revisão 10. As asserções logo abaixo fixam a regra atual, como a revisão conferiu.

Nenhum deles muda comportamento, teste ou asserção. A correção entra na próxima mudança de código desses arquivos.

## Observação da revisão, sem achado

Em "Verificado sem achado" (6), a revisão notou que a nova tentativa interna do React Query também pausa com a aba oculta, e não só sem rede, e que a espera dura até a aba voltar. A frase do plano sobre a busca pausada passou a dizer isso.
