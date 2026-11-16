# P5-F.1-R3.2 — mutantes

Todos os mutantes desta página rodaram na árvore de código final `5ea7fabee02c3ae4ca79400f416ce9e67e425ec7`, a mesma da execução oficial (`verify-all-r32-9`), depois dela e sem nada mais pesado ao mesmo tempo:
- **Cópias.** Cada roteiro roda na sua cópia da árvore (`git archive`, com `node_modules` por link), um mutante por vez.
- **Aplicação.** A troca tem de casar uma vez só no arquivo, senão o roteiro para com "NÃO APLICOU".
- **Restauração.** Os testes rodam, o arquivo é restaurado, e o roteiro confere por SHA-256 que ele voltou byte a byte.
- **Resultado.** "Morto" quer dizer que pelo menos um teste falhou; o número entre parênteses é a quantidade de testes que falharam. Antes de cada roteiro, a base (sem mutante) passa sem falha.

Os roteiros e as filas estão no pacote: `rodar-mutantes-finais.sh`, `scripts/mutantes-*.py` e `scripts/preparar-copias-finais.py`. Os logs são `saidas/mutantes-*-final*.log.txt` e `saidas/mutantes-cliente-r3*-na-r32.log.txt`.

| Conjunto | Mortos |
| --- | ---: |
| Frente A, as condições novas do cliente, com a guarda de texto | 26/26 |
| Frente A, os mesmos, sem a guarda de texto (só por comportamento) | 24/26 |
| Frente B, o executor em grupos, o marco da integração e a fiação | 57/57 |
| Regressão: os dirigidos da R3.1 na R3.2 | 12/12 |
| Regressão: os do cliente da R3 na R3.2 | 29/29 |

## Frente A — as condições novas de comprovação

Roteiro: `scripts/mutantes-cliente-r32.py`.
- **Testes.** `work-time-consistency`, `work-time-income-estimate`, `work-time-estimate`, `work-time-guard`, `report-basis-sync` e `report-basis-refresh`.
- **Sem a guarda.** A coluna "sem a guarda" roda os mesmos mutantes sem `work-time-guard.test.ts`: o mutante tem de morrer por comportamento, não só pelo texto do código.

| # | Mutante | Com a guarda | Sem a guarda |
| --- | --- | --- | --- |
| N01 | regra da leitura única de volta (como na R3.1: uma base, sem desconsiderada) | morto (37) | morto (36) |
| N02 | sem desconsiderada, nenhuma confirmação exigida (toda janela) | morto (45) | morto (44) |
| N03 | sem desconsiderada, a divergência entre bases e projeção é aceita | morto (11) | morto (10) |
| N04 | divergência entre bases e projeção nunca conferida | morto (14) | morto (13) |
| N05 | mês corrente (último da janela) sem conferência | morto (4) | morto (3) |
| N06 | só o último mês da janela conferido | morto (11) | morto (10) |
| N07 | sem bloco exato volta a ser provada (F-03 da revisão financeira) | morto (2) | morto (1) |
| N08 | sem bloco exato conferido só depois da projeção e das bases (a ordem das regras) | morto (2) | morto (1) |
| N09 | retorno do cache do SDK vale como do servidor | morto (11) | morto (9) |
| N10 | retorno do cache do SDK mantém a confirmação anterior (como na R3.1) | morto (8) | morto (6) |
| N11 | escuta encerrada mantém a confirmação | morto (11) | morto (9) |
| N12 | escuta reaberta (montagem, religar, outra janela) herda a confirmação | morto (2) | morto (1) |
| N13 | confirmação de outra conta, workspace ou janela aceita | morto (6) | morto (4) |
| N14 | prova não recalculada quando a confirmação muda | morto (43) | morto (43) |
| N15 | adaptador do SDK nunca marca o retorno do cache | morto (2) | **sobreviveu** |
| N16 | escuta sem as mudanças de metadados (a queda de conexão não chega) | morto (2) | **sobreviveu** |
| N17 | toda indisponível volta a esperar a prova (como antes do ADV-01) | morto (17) | morto (16) |
| N18 | a estimativa que converte passa sem prova (o portão invertido) | morto (114) | morto (113) |
| N23 | o tempo de interface troca também a falha por "em atualização" (o B08 da revisão adversarial, rodada 2; ADV-R2-07) | morto (7) | morto (6) |
| N24 | a indisponível sem números vira "em atualização" passado o tempo de interface (o B09 da revisão adversarial, rodada 2) | morto (18) | morto (17) |
| N21 | a indisponível que depende das receitas passa sem prova (rodada 1 da R3.2: só a pronta espera; F-08) | morto (22) | morto (21) |
| N22 | a regra estrutural da rodada 2 (só a pronta ou com meses espera): a de rotina ambígua passa sem prova (ADV-R3-01) | morto (8) | morto (7) |
| N25 | a véspera reduzida ambígua na lista dos decididos antes das receitas (ADV-R3-01) | morto (8) | morto (7) |
| N26 | a desconsiderada sem confirmação fora da lista (passa a esperar a prova: o estado legítimo some; ADV-01) | morto (2) | morto (1) |
| N19 | retorno do servidor sem documento mudado (reconexão) não restaura a confirmação (A02 da revisão adversarial) | morto (6) | morto (6) |
| N20 | retorno do cache só tira a confirmação com uma base e nenhuma desconsiderada (A09 da revisão adversarial) | morto (5) | morto (4) |

Sem a guarda, sobrevivem: N15, N16. Os dois mudam o adaptador do SDK (`src/modules/reports/hooks.ts`), que o mundo simulado da unidade não atravessa: o comportamento deles é o do SDK real. Com a guarda, os dois morrem; com o SDK real, no E2E B03-g com o mutante aplicado, os dois reprovam ("sem conexão, o saldo em reais"): o N15 na árvore final (execução 74 do histórico) e o N16 na execução 36, com o mesmo `hooks.ts`, que não mudou desde a R3.1.

## Frente B — o executor em grupos, o marco da integração e a fiação

Roteiro: `scripts/mutantes-grupos-r32.py`. Testes: `tests/tools/e2e-grupos.test.mjs` e `tests/tools/integracao-marco.test.mjs`, com prazo de 600 s por mutante. Um mutante que trava a suíte até o prazo conta como morto, mas aparece à parte ("morto só pelo prazo"), porque não houve teste que reprovasse.

| # | Mutante | Resultado |
| --- | --- | --- |
| G01 | instável, ignorado ou falho aceito (só "unexpected" reprova) | morto (2) |
| G02 | mais de uma tentativa aceita | morto (1) |
| G03 | teste da lista que não rodou aceito | morto (2) |
| G04 | teste que rodou duas vezes aceito | morto (2) |
| G05 | grupo sem relatório aceito | morto (3) |
| G06 | teste fora da lista aceito | morto (1) |
| G07 | lista vazia aceita | morto (1) |
| G08 | opção fora da lista aceita (--shard, --last-failed, --retries… passam) | morto (2) |
| G09 | o valor de uma opção aceita pode ser outra opção (-g --shard=1/2) | morto (1) |
| G10 | quantidade 0 de grupos aceita | morto (2) |
| G11 | mais grupos do que arquivos | morto (1) |
| G12 | projeto fora da chave do teste | morto (6) |
| X01 | saída do grupo ignorada | morto (2) |
| X02 | conferência da lista ignorada | morto (2) |
| X03 | grupos que não rodaram não contam como sem relatório | morto (1) |
| X04 | build das Functions com falha ignorado | morto (1) |
| X05 | lista com falha ignorada | morto (1) |
| X06 | log do Emulator do grupo anterior não sai | morto (1) |
| X07 | relatório de todos os grupos no mesmo arquivo | morto (3) |
| X08 | argumentos não repassados aos grupos | morto (1) |
| W01 | nova tentativa no CI | morto (1) |
| W02 | .only permitido | morto (1) |
| W03 | Emulator encerrado com SIGKILL (sem desligamento limpo) | morto (1) |
| W04 | test:e2e direto no Playwright (sessão única) | morto (1) |
| W05 | CI com o Emulator da versão do dia | morto (1) |
| W06 | CI sem os testes do executor | morto (1) |
| P01 | porta presa depois do grupo ignorada | morto (1) |
| P02 | porta presa antes do primeiro grupo ignorada | morto (1) |
| P03 | "ainda em uso" fora da decisão | morto (1) |
| P04 | espera de 0 s por padrão | morto (5) |
| P05 | prazo da espera sem teto (pode estender) | morto (1) |
| P06 | porta recusada vista como livre | morto (7) |
| S01 | sinal não repassado ao grupo | morto (3) |
| S02 | Playwright no mesmo grupo de processos do executor | morto (3) |
| S03 | os grupos seguintes rodam depois da interrupção | morto (5) |
| S04 | saída 1 em vez de 128 + o sinal | morto (6) |
| S05 | SIGTERM sem tratamento | morto (5) |
| S07 | SIGHUP sem tratamento (o R01 da estabilidade, rodada 2; EST-11) | morto (1) |
| S08 | SIGQUIT sem tratamento (EST-12) | morto (1) |
| S09 | o sinal sem grupo em curso é ignorado (o R03 da estabilidade, rodada 2; EST-11) | morto (3) |
| S06 | interrupção depois do último grupo aprovada | morto (1) |
| A01 | qualquer opção com "=" aceita (--retries=1, --config=…) | morto (2) |
| A02 | formas curtas combinadas aceitas (-xj2, -xu) | morto (1) |
| T01 | o SIGINT só ao processo do npx, não ao grupo (ADV-R2-02) | morto (2) |
| T03 | prazo 0 aprova a porta ocupada (ADV-R2-04) | morto (1) |
| K01 | o firebase-debug.log não é guardado por link (EST-R3-01) | morto (1) |
| X09 | os relatórios de uma execução anterior não são apagados (EST-R3-02) | morto (1) |
| U01 | só o primeiro sinal é repassado (o U01 da revisão adversarial, rodada 3; ADV-R3-03) | morto (1) |
| U17 | o grupo morto por sinal conta como saída 0 (o U17 da revisão adversarial, rodada 3; ADV-R3-03) | morto (1) |
| S10 | cada sinal tratado uma vez só (process.once: o segundo mata o executor; EST-R3-02) | morto (1) |
| I01 | concluir sem marco aberto aceito | morto (1) |
| I02 | conferir aceita o marco aberto (a cadeia interrompida) | morto (2) |
| I03 | conferir não apaga o marco | morto (2) |
| I04 | iniciar não troca o marco fechado de uma execução anterior | morto (1) |
| I05 | test:integration:emulator sem conferir | morto (2) |
| I06 | concluir fora da cadeia do emulators:exec | morto (2) |
| I07 | CI sem os testes do marco | morto (1) |

## Regressão — os mutantes da R3.1 e da R3 rodados na R3.2

Os mesmos mutantes das etapas anteriores, com as âncoras ajustadas ao código da R3.2 quando a linha mudou (`scripts/mutantes-cliente-r31-na-r32.py`, `scripts/mutantes-cliente-r3-na-r32.py`).

| # | Mutante (R3.1, dirigidos ao `holdEstimate` e ao "em atualização") | Resultado |
| --- | --- | --- |
| A01 | retenção reintroduzida (a última pronta mostrada sem prova, como na R3) | morto (43) |
| A02 | sem prova, a atual aparece | morto (87) |
| A03 | sincronização ignorada | morto (7) |
| A04 | sincronização não passada ao holdEstimate | morto (3) |
| A05 | prova não passada ao holdEstimate | morto (84) |
| A06 | sem "em atualização" | morto (33) |
| A07 | "em atualização" só sem prova (não na sincronização) | morto (1) |
| A08 | falha da leitura vira "calculando" | morto (19) |
| A09 | "em atualização" sem esperar o tempo de interface | morto (38) |
| A10 | com uma leitura em falha, a estimativa sem prova aparece | morto (24) |
| A11 | a atual provada perde o aviso da releitura que falhou | morto (10) |
| A12 | o "em atualização" herdado do período anterior (o prazo não volta a zero ao sair da espera) | morto (1) |

| # | Mutante (R3, prova pelas marcas, gancho, leitura por id e releitura) | Resultado |
| --- | --- | --- |
| P01 | mês sem etiqueta aceito | morto (2) |
| P02 | gerações diferentes aceitas | morto (2) |
| P03 | bases sem conferência com os meses | morto (3) |
| P04 | marca quebrada vale como nada | morto (5) |
| P05 | pendência ignorada | morto (5) |
| P06 | impressão não comparada | morto (26) |
| P07 | estorno sem recebimento aceito | morto (1) |
| P08 | âncora depois de raiz absent aceita | morto (2) |
| P09 | geração mais nova na posição ignorada | morto (4) |
| P10 | raiz event sem âncora aceita | morto (2) |
| P11 | criação casa com qualquer nó | morto (2) |
| P12 | chaves do mapa sem ordenar | morto (2) |
| P13 | Timestamp sem nanossegundos | morto (2) |
| P14 | posições diferentes aceitas | morto (1) |
| P15 | absorção ignora o conteúdo | morto (6) |
| P16 | nó ausente com o lido presente prova (A02) | morto (5) |
| C01 | regra 5 ignorada | morto (26) |
| C02 | prova ausente vale como provada | morto (3) |
| H01 | itens das leituras mesmo provado | morto (1) |
| H02 | leitura de outra janela aceita | morto (1) |
| H03 | marcas dos estornos não lidas | morto (5) |
| H04 | sem estimativa em atualização | morto (33) |
| H05 | sem releitura por motivo passageiro | morto (4) |
| R01 | impressão do normalizado, não do bruto | morto (47) |
| Q01 | releitura cancela sempre (comportamento antigo) | morto (2) |
| Q02 | começo igual à mudança conta como depois | morto (1) |
| Q03 | primeira leitura sem releitura depois | morto (1) |
| Q04 | começo da leitura não anotado | morto (1) |
| Q05 | leitura em curso nunca relida | morto (4) |

## Rodadas anteriores (no histórico)

Ficam no histórico (`testes-e-resultados.md`), com as árvores de cada uma:
- **Execuções 13 a 15.** 16/16 do cliente; a Frente B deu 24/26 e depois 25/26. O G02 sobreviveu por uma lacuna real, corrigida com um teste; o X03 era equivalente e morre desde os testes de porta presa.
- **Execuções 27 a 31.** O cliente deu 20/20 com a guarda e 18/20 sem ela (N15 e N16, do adaptador do SDK). A Frente B travou no P06 por um defeito do próprio teste, corrigido no `finally` do auxiliar.
- **Execuções 48, 50 e 59.** Os mutantes dos sinais (S01–S10, T01, U01, U17), do F-08 (N17, N18, N21, N22) e do ADV-R3-01 (N25, N26), todos mortos.
- **Execuções 64, 67 e 68.** S01, S05 e U01 com a limpeza do ajudante; na 67, um falso `npx` ficou órfão e foi encerrado.
- **Execução 55.** Os mutantes finais na árvore `ef514869` foram interrompidos e superados pela mudança de código seguinte; os logs ficam no pacote com o sufixo `-ef514869-interrompido`.
