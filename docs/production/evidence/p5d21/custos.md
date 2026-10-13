# P5-D2.1 — custo por operação dos avisos de recebível vencido

Leituras e escritas de documento do Firestore. A leitura de documento ausente, dentro da transação, também é cobrada como leitura. Medido por interceptação do SDK no Emulator, na suíte `receivableOverdue.integration.test.ts` (§11) e no benchmark de volume (`escala.json`).

## Operações de domínio (escrita extra na mesma transação do recebível)

| Operação | Leituras extras | Escritas extras | Observação |
| --- | --- | --- | --- |
| Cadastro de recebível aberto com saldo (qualquer vencimento) | 0 | 1 (`set` do item da fila) | O estado anterior já foi lido pela operação |
| Edição sem mudar o vencimento nem a forma elegível | 0 | 0 | |
| Mudança de vencimento (recebível aberto) | 0 | 1 (`set`, novo episódio, tentativas zeradas) | |
| Recebimento parcial (continua aberto) | 0 | 0 | Não reescreve o trabalho: sem segundo aviso do mesmo episódio |
| Quitação (recebido) | 0 | 1 (`delete` do item, exista ou não) | |
| Estorno que reabre (recebido → aberto) | 0 | 1 (`set` do item) | Com a confirmação do episódio, a rotina encerra sem publicar |
| Estorno que mantém aberto | 0 | 0 | |
| Cancelamento | 0 | 1 (`delete`) | |

## Rotina (`processReceivableOverdueNotifications`, a cada 60 min)

| Caso | Leituras | Escritas |
| --- | --- | --- |
| Consulta da fila, por página | 1 por item devolvido (mínimo 1 por página) | 0 |
| Item publicado | 1 (consulta) + 4 (item, recebível, confirmação, aviso) = 5 | 3 (aviso, confirmação, remoção do item), num commit |
| Item com confirmação existente (já entregue) | 5 | 1 (remoção do item) |
| Aviso existente sem confirmação (reconciliação) | 5 | 2 (confirmação e remoção do item) |
| Recebido, cancelado ou sem saldo (item obsoleto) | 1 + 2 = 3 | 1 (remoção) |
| Ainda não venceu (item reagendado) | 3 | 1 (`update` do item) |
| Recebível fora do contrato | 3 | 1 (`update` com backoff) |
| Falha não transitória | 1 + até 4 | 1 (`update` com pré-condição, fora da transação) |
| Falha transitória (`UNAVAILABLE`, `ABORTED` etc.) | 1 + até 5 × 4 (o SDK repete a transação até 5 vezes) | 1 (`update` com pré-condição). Volta a cada execução horária nas 6 primeiras tentativas e depois uma vez por dia |
| Contagem final dos pendentes devidos | 1 por bloco de até 1.000 entradas de índice | 0 |
| Execução sem pendências | 2 (consulta vazia + contagem) | 0 |
| Execução com backlog (teto) | até 20.000 × 5 + contagem ≈ 100.000 + ⌈pendentes / 1.000⌉ (200 páginas de 100; na prática o limite de 420 s corta antes) | até 60.000 |
| Item além da cota de 500 do workspace (1ª passada) | 1 (consulta) | 0 (a página seguinte salta o restante desse workspace no mesmo dia; a 2ª passada lê o item de novo e o processa se sobrar tempo) |
| Item já tratado na execução, encontrado de novo na 2ª passada (falha com nova tentativa no mesmo dia) | 1 (consulta) | 0 (não é repetido) |

Limites por execução: páginas de 100 (até 200 no total das duas passadas), 10 transações simultâneas, 420 s para iniciar páginas (a primeira sempre começa) e 480 s para iniciar itens (o resto fica devido para a execução seguinte), tempo limite 540 s, `maxInstances: 1`. Justiça em duas passadas: na 1ª, 500 itens por workspace (esgotada a cota, o cursor salta o restante desse workspace no mesmo dia); na 2ª, se a 1ª chegou ao fim da fila e ainda há tempo e páginas, o excedente na ordem da fila, sem repetir o que a execução já tratou. A capacidade é limitada pelo tempo e pelo teto de páginas (com transações rápidas, é o teto que limita: até 20.000 itens lidos por execução), e a cota só reserva a vez dos demais workspaces: sem concorrência, um workspace usa a capacidade inteira. Teto de leituras de consulta por execução: 200 × 100 = 20.000 (itens adiados pela cota e relidos na 2ª passada incluídos).

Medido no benchmark (`escala.json`, rotina final): até 10.000 vencidos, 5,1 a 5,5 leituras e 3 escritas por aviso, fila vazia em 1 execução; 50.000 com 3 anos de atraso acumulado, 7,2 leituras por aviso (a 1ª passada lê até o teto de 200 páginas, com itens adiados pela cota relidos depois), 9 execuções; 20.000 concentrados num workspace, 7,0 leituras por aviso, 3 execuções.

## Custo diário sem trabalho

24 execuções × 2 leituras = 48 leituras por dia, qualquer que seja o tamanho do histórico. Recebíveis fechados e episódios já entregues nunca são lidos pela rotina: não há item na fila para eles. No benchmark, com 10.000 confirmações de histórico, a execução ociosa custou 2 leituras.

## Comparação com a P5-D2 (substituída)

A rotina diária da P5-D2 lia todo recebível aberto vencido na janela de 7 dias, inclusive os já avisados (até 7 releituras por episódio), e tentava `create` em cada um, mais 1 leitura e até 26 escritas do cursor global. A P5-D2.1 lê cada item uma vez por tentativa e o remove ao concluir.
