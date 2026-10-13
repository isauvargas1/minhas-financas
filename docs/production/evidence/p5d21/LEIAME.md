# Evidência — P5-D2.1, avisos de recebível vencido sem limite de dias (2026-10-12)

Tudo contra o Emulator (`minhas-financas-local`). Nenhum acesso ao projeto de produção, nada publicado.

| Arquivo | Conteúdo |
| --- | --- |
| `custos.md` | Leituras e escritas por operação de domínio e por caso da rotina, execução ociosa, teto diário e comparação com a P5-D2 |
| `escala.json` | Benchmark de volume (100, 1.000, 5.000, 10.000 e 50.000 recebíveis vencidos): execuções até esvaziar, publicados × esperados, comparação por conjunto de IDs, defeituosos mantidos, leituras e escritas por execução |
| `escala-benchmark.cjs` | Script do benchmark (rotina real compilada em `functions/lib`, limites de produção). Uso: `firebase emulators:exec --only firestore --project minhas-financas-local "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node docs/production/evidence/p5d21/escala-benchmark.cjs 100,1000 saida.json"` |
| `mutacoes.json` | Mutantes aplicados numa cópia isolada, com o teste que matou cada um e a conferência SHA-256 da restauração |
| `prova-remocao.txt` | Busca do legado substituído da P5-D2 (janela de 7 dias, cursor global, consulta de grupo de `receivables`, índice) e das Rules das coleções novas |
| `revisao-independente.md` | As três rodadas da revisão independente (Opus, somente leitura): achados, severidade e tratamento |
| `VEREDITOS.md` | Vereditos das skills de domínio e do `regression-release-gate` sobre o estado final |

## Benchmark de volume (`escala.json`)

Rotina final (duas passadas, cota de 500 por workspace na 1ª, teto de 200 páginas, limites de tempo de produção), rodada até a fila esvaziar. Recebíveis autoritativos e itens da fila semeados no formato do domínio (instrumentação permitida pelo §11), espalhados por 10 workspaces (2 no cenário de 100), com vencimentos de ontem a cerca de 3 anos atrás (backlog acumulado, o pior caso para o salto da cota, que só vale dentro do mesmo dia). Em cada cenário, 1% fora do contrato (saldo inconsistente) e um histórico de recebíveis já avisados (confirmação gravada, sem item na fila; até 10.000). O cenário concentrado põe 90% dos itens num único workspace.

| Recebíveis | Execuções com trabalho | Publicados / esperados | Conjunto de IDs | Fora do contrato mantidos na fila | Leituras | Escritas | Leituras por aviso | Execução ociosa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 2 | 99 / 99 | igual | 1 de 1 | 506 | 299 | 5,1 | 2 leituras |
| 1.000 | 2 | 990 / 990 | igual | 10 de 10 | 5.015 | 2.990 | 5,1 | 2 leituras |
| 5.000 | 2 | 4.950 / 4.950 | igual | 50 de 50 | 25.105 | 14.950 | 5,1 | 2 leituras |
| 10.000 | 2 | 9.900 / 9.900 | igual | 100 de 100 | 54.914 | 29.900 | 5,5 | 2 leituras |
| 50.000 | 9 | 49.500 / 49.500 | igual | 500 de 500 | 356.835 | 149.500 | 7,2 | 2 leituras |
| 20.000, concentrado (18.000 num workspace) | 3 | 19.800 / 19.800 | igual | 200 de 200 | 139.286 | 59.800 | 7,0 | 2 leituras |

- Em todos os cenários, publicados = esperados e o conjunto de IDs por workspace é exatamente o esperado: nenhuma perda, nenhuma duplicidade. Na 2ª execução, os fora do contrato vão para o dia seguinte (backoff), sem bloquear os demais.
- O histórico (10.000 episódios já entregues) nunca é lido: a execução ociosa custa 2 leituras em todos os cenários.
- Até 10.000 vencidos, a fila esvazia na 1ª execução; o custo fica em 5 leituras e 3 escritas por aviso.
- Concentrado: os 9 workspaces leves foram atendidos por inteiro já na 1ª execução (1ª passada), e os 18.000 itens do workspace pesado saíram em 3 execuções (2ª passada). Com a cota fixa, sem a 2ª passada, eram 36 execuções e cerca de 19 leituras por aviso.
- 50.000 com 3 anos de atraso acumulado: a 1ª passada lê até o teto de 200 páginas (itens de cada workspace espalhados por muitos dias, de modo que o salto da cota quase não economiza leituras); são cerca de 5.000 avisos por execução até o volume cair. É o pior caso de leituras por aviso (7,2); o teto de leituras de consulta por execução é 20.000.
- Tempo no Emulator: até 340 s por execução no cenário de 50.000 (banco grande), dentro do orçamento de 420 s; abaixo de 50 s nos demais.
