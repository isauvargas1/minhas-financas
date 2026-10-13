# P5-E1 — Revisão adversarial independente

**Escopo da revisão.** Revisor Opus, somente leitura, sobre o diff da P5-E1 em relação à árvore `91ed2c58`. Não houve escrita no repositório nem no índice.

**Execuções do revisor:**

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` das Functions | passou |
| `tsc --noEmit` do frontend | passou |
| Unitários de IA das Functions | 77/77 |
| `test:unit:billing` | 65/65 |
| `test:unit:ai-chat` | 37/37 |

Integração e E2E foram lidos, não executados.

**Veredito: "aprovável com ressalvas".** Nenhum BLOCKER e nenhum HIGH. Foram apontados 3 MEDIUM, 7 LOW e 4 INFO. O tratamento de cada um está abaixo.

## MEDIUM

### M1 — Tempo limite do cliente abaixo do provedor e repetição em `deadline-exceeded`

**Achado.** O SDK do Firebase no navegador usa 70 s por padrão, menos que os 90 s do provedor. O cliente também repetia em `deadline-exceeded`: a resposta já cobrada se perdia, e a repetição voltava "já processada".

**Correção:**
- `httpsCallable(..., {timeout: AI_CLIENT_TIMEOUT_MS})` com 125 s, acima dos 120 s da função (`src/modules/ai/api.ts`, `src/modules/ai/callables.ts`).
- A repetição acontece só em `unavailable` ou erro sem `code`.
- Se a repetição encontra o pedido já processado, a mensagem avisa que a tentativa pode ter sido contabilizada (`AI_RETRY_ALREADY_PROCESSED_MESSAGE`).

**Testes** (`tests/unit/ai-client.test.ts`):
- "pedido que chegou ao servidor não é repetido";
- "repetição que encontra o pedido já processado…";
- `deadline-exceeded` na lista das respostas nunca repetidas.

### M2 — Extração tirava a pessoa da aba "Cartão" para "Despesa"

**Achado.** Com 0 ou 1 parcela, a extração trocava a aba, o que arriscava gravar débito em conta em vez de compra no cartão.

**Correção:**
- A partir de "Cartão", uma despesa continua compra no cartão, à vista ou parcelada.
- Só se entra em "Cartão" com 2 ou mais parcelas.
- Toda troca de aba é avisada: "O formulário mudou para a aba …" (`src/modules/ai/extractionForm.ts`).

**Testes:**
- `tests/unit/ai-extraction-form.test.ts`: "a partir da aba Cartão…" e as mensagens com a troca.
- E2E com a mensagem atualizada.

### M3 — Dívidas "sem movimento" com cartões indisponíveis

**Achado do revisor.** Com cartões indisponíveis, o bloco de dívidas sairia como "sem movimento".

**Verificação.** No caminho real, `executeGetFinancialReport` já rebaixa `debts` para `truncated`/`partial_sources` (`functions/src/reports/report.ts`), e o contexto mostra "parcial (leitura truncada)". O revisor estava certo, porém, sobre o teste: o X16 trocava o bloco `cards` depois de montado o relatório e não exercitava a propagação.

**Correção:**
- Teste no Emulator com o leitor de cartões falhando (código gRPC 14) dentro do relatório oficial (`aiContext` X16/X17).
- Guarda no contexto (`withPartialCardObligations`, em `functions/src/ai/analysisContext.ts`): dívidas sem obrigações de cartão nunca saem como "completo" nem como "sem movimento".
- Teste unitário em `analysisContext.test.ts`.

## LOW

| # | Achado | Tratamento |
|---|---|---|
| 1 | Confirmação do formulário não presa ao escopo em que abriu | O escopo é guardado na abertura (`aiConsentScopeRef`) e conferido na confirmação. Se o escopo mudou, nada é enviado e aparece "A sugestão da IA foi descartada porque o formulário mudou." Guarda estática em `ai-client.test.ts`. |
| 2 | Comprovante habilitado durante a gravação; o resultado da voz substituía outra confirmação | Botão "Escanear Comprovante" desabilitado enquanto grava. O `onresult` ignora o texto se já houver confirmação aberta. Guarda estática. |
| 3 | Ramo morto `AiProviderError` no log de falha de domínio | Removido. A classe e o status do provedor ficam no evento `ai.provider_failed`, e a documentação foi corrigida. |
| 4 | "Nada persistido" ignorava o histórico local do chat (D-41) | Inventário de privacidade corrigido: "não persistido no servidor; histórico só no navegador (D-41)". |
| 5 | Pergunta fora de 3 a 2.000 caracteres abria a confirmação | `maxLength` de 2.000 no campo. Envio e confirmação bloqueados abaixo de 3 caracteres (`ReportsAIChat.tsx`). Guarda estática. |
| 6 | `finishReason` não conferido | `MAX_TOKENS` anexa "(Resposta interrompida pelo limite de tamanho.)" (`gateway.ts`). Na extração, o JSON cortado segue inválido. Teste em `callables.test.ts`. |
| 7 | "provedor de IA contratado" pressupunha contrato (E-09 aberto) | Texto trocado para "provedor de IA usado pelo FênixGran" nos diálogos e nos testes. |

## INFO

| # | Observação | Tratamento |
|---|---|---|
| 1 | O S16 (chave sentinela fora do prompt) é trivialmente verdadeiro com o harness falso | Mantido como regressão: um mutante que injetasse a chave no pedido o derrubaria. O vazamento da chave pela mensagem do SDK é coberto pelo S21/S22 e pelo mutante M19. |
| 2 | O E2E aceita qualquer preset em `range` | Risco baixo: rótulo e faixa vêm de `dto.period.range`. Sem mudança. |
| 3 | Rótulos de período divergentes entre a tela e o prompt | Os presets do contexto usam os rótulos do seletor dos Relatórios: "Últimos 3 meses", "Ano Atual" e "Todo o Período". |
| 4 | Scripts de instalação do `@google/genai` | Sem ação. |

## O que o revisor verificou sem problema

- **Autoridade e contexto.** Schema estrito; PF/PJ e patrimônio vindos do relatório oficial com o papel relido; `omitTopClients`; sem IDs, nomes ou séries; aritmética inteira; cobertura preservada.
- **RBAC e corridas.** Kernel, transação de contexto e admissão; viewer, removido, suspenso e arquivado recusados.
- **Créditos e idempotência.** Recusas antes da admissão; mesma chave → "já processada"; chave por confirmação.
- **Confirmação de envio.** Estrita, versionada, por operação e anterior a qualquer leitura ou crédito; voz em duas etapas.
- **Prompt e saída.** `systemInstruction` separado; saída validada; React escapa; extração estrita, sem gravação automática.
- **Provedor.** Sem `retryOptions`; chave só via `secrets`; nenhuma `VITE_*` de IA; nenhuma afirmação de rotação; nenhuma chamada ao Google nas suítes.
- **Logs.** Sanitizados.
- **Frontend.** Isolamento P5-A, trava de duplo clique e diálogo acessível.
- **Testes.** Sem `skip`/`only` e com tempos limite no padrão do projeto.
