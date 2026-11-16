# P5-F.1-R3 — respostas à rodada 3 (documentos finais, pedida pelo gate)

A rodada 3 conferiu só documentos, com a árvore de código `377c2f3f` inalterada. Partiu da árvore de documentos `ad1660a3`. As respostas abaixo mudam só documentos em `docs/`.

## `privacy-lgpd-data-lifecycle` — PASS (`privacidade/PARECER-RODADA-3.md`)

| ID | Severidade | Resposta | Onde |
| --- | --- | --- | --- |
| N-PRI-03 | INFO | **Registrado.** O texto proposto pelo revisor entrou literalmente no RR-R3-08, como requisito da P8. Ele diz que o procedimento do §6.4 roda sem reconstrução em andamento, com uma chamada nova de corte posterior à exclusão, e o que "todas as entregas aplicadas" quer dizer | plano §20.18, RR-R3-08 |
| N-PRI-04 | INFO | **Classificado, para a P8.** A preparação abandonada já está descrita e aceita no RR-R3-08. Os quatro documentos da condição de privacidade não a citam, mas também não a contradizem. Mencioná-la nesses documentos reabriria a conferência deles por um ponto de completude. Entra na próxima edição deles, no máximo na P8. Risco residual: o leitor dos quatro documentos não vê que a preparada pode ficar sem prazo até a próxima chamada da reconstrução | — |

## `multi-tenant-security-review` — PASS (`seguranca/PARECER-RODADA-3.md`)

| ID | Severidade | Resposta | Onde |
| --- | --- | --- | --- |
| R3-I1 | INFO | **Aplicado.** O RR-R3-12 corrige três pontos: são três testes cegos (`:33`, `:46` e `:76`), o critério é estar fora do índice, e o CI só detecta depois do push. Acrescenta que, até a correção, o gate de cada etapa feita sem commit reexecuta o arquivo com o índice completo | plano §20.18, RR-R3-12 |
| R3-I2 | INFO | **Aplicado.** A condição de implantação pede as Rules e os índices da R3 antes das Functions, ou junto, e explica o efeito de Rules anteriores. O efeito fica dentro do workspace, com a escrita negada | plano §20.18, "Condições de implantação"; `FIREBASE_PRODUCTION.md` §5 |

## `observability-incident-readiness` e `firebase-production-readiness` — PASS (`obs-plataforma/PARECER-OBSERVABILIDADE-RODADA-3.md`)

| ID | Severidade | Resposta | Onde |
| --- | --- | --- | --- |
| R3-L1 | LOW | **Corrigido.** A §13 diz "A01–A21". É a única mudança no arquivo, como o revisor indicou | `OBSERVABILITY.md:471` |
| R3-I1 | INFO | **Para a P7.** Há três nuances: a do "corte posterior" no empate, que o código trata como coberto; a da estimativa que fica em reais só quando depende da marca quebrada; e a condição de desligamento, que ainda não está na RB-T04. Os três pontos vão para a implantação do A21 | — |
| R3-I2 | INFO | **Para a P7.** `lastMarkIssueAt` é regravado a cada quebra e não marca o início do aviso. A duração "por mais de 1 h" do A21 precisa da varredura agendada ou de um campo de início | — |
| R3-I3 | INFO | **Corrigido no plano.** O resumo do modelo de estados usa "cada cadeia (lançamento × geração)" e os seis campos duráveis. As faixas de linha da coluna de evidência do `OBSERVABILITY.md` §2.1 ficaram como estão, para não mexer de novo no arquivo; elas mudam a cada edição do código | plano §20.18, "Modelo de estados e invariantes" |
| R3-I4 | INFO | Sem ação. Corrige uma frase da rodada 2 do próprio revisor: a varredura de segredos lê os `.json` de `docs/`, e nenhum deles tem o padrão de chave | — |
| PLAT-R3-I1 | INFO | **Corrigido.** O RR-R3-11 diz que o emulador de Functions cria um processo por chamada concorrente de cada função e não encerra os ociosos, com as contagens de `getFinancialReport`. O mesmo texto entrou em `testes-e-resultados.md` §3 | plano §20.18, RR-R3-11; `testes-e-resultados.md` |

## `firestore-scale-cost-review` — FAIL (`escala-custo/PARECER-RODADA-3.md`)

| ID | Severidade | Resposta | Onde |
| --- | --- | --- | --- |
| R3-M1 | MEDIUM | **Corrigido no documento**, com o texto do revisor. O código não muda: o revisor exige só a correção do modelo de custo. O que entrou:<br>• uma linha nova no §9 para a projeção que diverge e volta, com 1 prova por volta, até cerca de 720 voltas por hora por membro que escreve e cerca de 321 mil leituras por hora no teto (R2A: cerca de 78 mil);<br>• a última frase do §9 trocada: o orçamento dos agendadores não limita essa liberação, que fica limitada pelas escritas do servidor;<br>• a mesma ressalva nos custos da §20.18 e no RR-R3-09, com a recomendação para a P7 de passar essa releitura pelo orçamento do agendador da prova.<br>Risco residual (LOW, como o L3): sem orçamento no cliente, o custo dessa releitura é limitado pelos limites de escrita do servidor, que estão implementados | `DESENHO-MARCAS-B03.md` §9; plano §20.18 (custos, RR-R3-09) |
| R3-I1 | INFO | **Aplicado.** "de cerca de 4 a 7 vezes nos casos desta seção; a razão cresce com m e cai com u" | desenho §9 |
| R3-I2 | INFO | **Aplicado.** Os 78 por hora valem com as bases em passo. Fora de passo, o teto é de até cerca de 121 por hora e cerca de 54 mil leituras por hora, por leitura do código, sem medição | desenho §9; plano §20.18 |
| R3-I3 | INFO | **Aplicado.** "de 373 B a 726 B" | plano §20.18 |
| R3-I4 | INFO | **Aplicado.** A queda de 20% a 28% vale na página padrão (300). Com a de 500, a queda chega a cerca de 44%, com a mesma capacidade absoluta | desenho §9; plano §20.18 (custos, RR-R3-09) |
| R3-I5 | INFO | Sem ação, como o revisor indicou: o valor é contrafactual (sem isenção) | — |
| R3-I6 | INFO | **Aplicado.** O 446 é o teto da janela, com 12 meses e 100 marcas; o código aceita até 13 meses | plano §20.18 |

**Rodada 4.** As correções acima mudaram o §9 do desenho, que aciona a condição de privacidade. Também mudaram a condição de implantação, o RR-R3-09, o RR-R3-11, o `FIREBASE_PRODUCTION.md` e o §13 do `OBSERVABILITY.md`, que acionam a condição de observabilidade e plataforma. Por isso confirmam a rodada 4:
- escala (o R3-M1 e os INFO);
- privacidade (o §9 e o N-PRI-03 no RR-R3-08);
- observabilidade e plataforma (as linhas da sua superfície).

A segurança dispensou nova rodada para o R3-I1 e o R3-I2 aplicados no sentido do parecer. O gate confere isso.
