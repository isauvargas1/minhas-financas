# D-18-NOTIF — custo de leitura, escrita e acessos das Rules

Medido onde há medição (Emulator); estimado e identificado como tal no resto. Nada aqui é custo monetário: são contagens de operações.

## Acessos das Rules (medido no Emulator)

| Operação | Acessos | Origem |
| --- | --- | --- |
| Qualquer requisição ou lote do estado privado | 5 fixos | `exists` e `get` do perfil e do membership, `get` do workspace (cache por requisição) |
| Criação de estado | +1 por estado | `get` do evento (`isNotificationStateOfLiveEvent`) |
| Atualização de estado | +0 | usa o `expiresAt` já copiado no próprio estado |
| Exclusão para si (`deleted`) | +0 | `hasRole` reaproveita o `get` do membership |

- Teto das Rules: 20 acessos por lote.
- Medição (`tests/firestore/notifications-d18.rules.integration.test.mjs`, teste "medição"): `writeBatch` com 15 criações passa e com 16 é recusado, tanto com `read` quanto com `deleted`. As duas condições são afirmadas no teste.
- Um lote de 10 atualizações com `deleted` passa.
- O cliente grava em lotes de 10 (`NOTIFICATION_MARK_BATCH_SIZE`): 15 acessos, com 5 de margem.

## Leituras e escritas por ação do usuário (estimativa a partir do código)

| Ação | Leituras | Escritas |
| --- | --- | --- |
| Abrir o painel (1ª página) | até 26 eventos (25 + 1 de sondagem) + até 25 estados numa consulta `in` | 0 |
| "Carregar mais" | até 26 eventos + até 25 estados | 0 |
| Marcar exibidas como lidas | por lote de 10: 10 estados + 1 evento por estado novo (na transação) | até 10 |
| Arquivar ou excluir para mim | 1 estado + 1 evento se o estado for novo | 1 |
| Expiração com o painel aberto | 0 (timer local, sem polling nem listener) | 0 |

## Produtor (medido pelo código; teste de integração)

- Fechamento de fatura: +1 leitura por fatura fechada (o aviso é lido antes das escritas e só criado se ausente). Nenhuma escrita extra.
- Vencimento e atraso: sem mudança (`create()` com ALREADY_EXISTS ignorado).

## TTL (pendente de publicação, E-07)

- Quando publicado e ativo, o TTL remove cada documento vencido como 1 exclusão, sem leitura; o evento e cada estado são documentos separados.
- Sem job de varredura nem Function agendada: nenhuma leitura periódica.
- Volume estimado: até 3 eventos por fatura (fechada, a vencer, vencida), ou seja, até 3 por cartão ativo por mês. Com 8 cartões, são até 24 eventos por mês e cerca de 144 vivos em 180 dias. No teto de 50 cartões por workspace (`CARD_LIMIT_PER_WORKSPACE`), até 150 por mês e cerca de 900 vivos. Há no máximo 1 estado por (usuário, evento). O painel lê só por página (25 + 1), então o volume vivo não muda o custo de abrir o painel.

## O que não foi medido

- A remoção física pelo TTL: o Emulator não executa TTL.
- O custo real em PROD/STAGING: nada foi publicado.
