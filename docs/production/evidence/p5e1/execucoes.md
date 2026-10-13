# P5-E1 — Execuções de validação (2026-10-12)

Todas as execuções foram feitas no Emulator, projeto `minhas-financas-local`, com o provedor de IA falso injetado. Não houve nenhuma chamada ao Google nem acesso a produção. Os logs completos ficaram fora do repositório, por tamanho.

## Impedimento ambiental: porta 8080

Um Firestore Emulator órfão (PID 7545, iniciado às 11:43, antes destas execuções) ocupa as portas 8080 e 9150.

- **O que não roda como está:** `npm run test:integration:emulator`, na parte de Rules, e `npm run test:e2e` usam essas portas fixas. Por isso `verify:all` não roda como está no repositório.
- **Por que o processo não foi encerrado:** isso foi recusado nesta sessão e está pendente de decisão do usuário. Não houve contorno.
- **Origem provável:** uma JVM que sobrou de uma execução E2E anterior. O Playwright não encerra a JVM do emulador; o mesmo efeito apareceu nas cópias abaixo e foi limpo só nelas.

Por isso as suítes foram executadas assim:

1. **Integração das Functions.** O `functions/lib` do repositório (build oficial) rodou contra um Emulator em portas próprias: Firestore 8180 e Auth 9199.
2. **Rules, ferramentas e E2E.** Cada execução usou uma **cópia isolada** do working tree, extraída por índice Git temporário. O índice real ficou intocado.
   - Na cópia, **só os números de porta** mudaram: 8080→8280, 9099→9299, 5001→5201 e 9150→9350; o hub foi para 4420, o logging para 4520 e a UI ficou desligada.
   - Arquivos tocados: `src/lib/firebase.ts`, `firebase.json`, `playwright.config.ts`, `package.json`, os specs E2E e os testes de Rules que fixam a porta.
   - Nenhuma asserção, timeout, `skip` ou `only` foi alterado.

## Resultados

| Suíte | Comando | Árvore | Resultado |
| --- | --- | --- | --- |
| Integração das Functions | `node --test` sobre `functions/lib/**/*.integration.test.js`, sequencial | working tree final | **941/941**, 0 falhas, 0 skips (base: 891) |
| Ferramentas e Rules | a parte não-Functions de `test:integration:emulator` (`test:tools:limpeza`, `test:tools:contas`, todas as `test:rules:*`), na cópia | `cb034ea5` | **273/273**, 0 falhas, 0 skips (base: 17 + 256) |
| E2E completo | `npm run test:e2e`, na cópia | `0470b373` | 167/169 (detalhe abaixo) |
| E2E: as duas specs que falharam | `npm run test:e2e -- e2e/ai-consent-extraction.spec.ts e2e/notifications-p5d2.spec.ts`, na cópia atualizada | `b14b6d5c` | `ai-consent-extraction` **11/11**; `notifications-p5d2` 8/9 (detalhe abaixo) |
| Unitários, lint, typecheck e builds | `npm run verify:fast`, no repositório | working tree final | OK (2026-10-12, de 13:50:16Z a 13:53:22Z, saída 0): typecheck; lint com 0 erros e 201 avisos (a base tinha 202; nenhum aviso em arquivo da P5-E1); builds do frontend e das Functions; **639** unitários das Functions (base: 573) e **763** do frontend (base: 735); 0 falhas e 0 skips |

A integração das Functions passou de 891 para 941 testes: os 50 a mais são as suítes novas `aiSecurity` (28) e `aiContext` (22). A `aiCredits` (30) foi adaptada ao contrato novo, sem perder casos.

**Totais.** 639 + 763 + 941 + 273 + 169 = **2.785 testes**, contra 2.630 na base: 66 unitários das Functions, 28 do frontend, 50 de integração e 11 E2E a mais; Rules e ferramentas sem mudança. Nenhum teste foi removido ou ignorado.

## As duas falhas do E2E completo

### 1. `ai-consent-extraction.spec.ts:241`: defeito do próprio teste novo

**O que falhava:** o passo "confirmar envia" apertava Enter com o campo vazio.

**Por quê:** o campo tinha sido limpo, de propósito, para o passo da pergunta sugerida. O produto está certo nos dois pontos:
- cancelar o diálogo não mexe no rascunho;
- o envio fica desabilitado com menos de 3 caracteres.

**Correção:** o passo que faltava, digitar de novo a pergunta antes de confirmar. Nenhuma asserção foi alterada.

**Resultado:** 11/11 na nova execução.

### 2. `notifications-p5d2.spec.ts:832`, variante celular com toque: falha intermitente preexistente

**Sintomas:**
- a notificação arquivada continua na lista (linha 971: `toHaveCount(7)` recebe 8);
- ou o painel fecha entre dois toques em "Arquivar para mim".

**Código envolvido:** o caminho é o do painel de notificações da P5-D2 (`Header`, `NotificationsPanel`, `modules/notifications`), sem diff na P5-E1. Nenhum componente da P5-E1 fica ativo nesse fluxo:
- o diálogo de confirmação não renderiza nada e não registra ouvinte enquanto está fechado;
- o chat da IA só monta na aba "IA Financeira";
- o formulário de lançamento fechado devolve `null`, e os efeitos novos só reagem à abertura;
- o SDK novo é carregado sob demanda, por `import()`.

**Comparação controlada.** Mesma cópia, mesmas portas e o mesmo comando, `--grep celular --repeat-each`. O spec é idêntico nas duas árvores.

| Árvore | Execuções | Falhas |
| --- | --- | --- |
| Base P5-D2.1 (`91ed2c58`, com as próprias dependências por `npm ci`) | 16 (6 + 10) | **1**, mesmo sintoma (linha 971) |
| P5-E1 | 20 (2 na suíte completa, 2 na nova execução, 6 e 10 isoladas) | 3 |

**Conclusão:** a falha **reproduz na base**, então não foi introduzida pela P5-E1.

**Causa mais provável:** uma disputa entre os toques do teste e a releitura assíncrona da lista e da contagem no painel. O painel tem uma camada transparente de tela cheia que o fecha ao clicar fora (`Header.tsx:234-238`).

**Encaminhamento:**
- Registrada como achado preexistente, fora do escopo da P5-E1, para o milestone dono das notificações.
- O teste não foi alterado nem enfraquecido.
- Pelo critério do gate, a falha preexistente continua impedindo `PASS` enquanto não for corrigida.

## Capturas

Feitas pela spec `ai-consent-extraction` na nova execução, com dados sintéticos, em desktop 1280×800 e mobile 390×844. Ficam em `capturas/` e só são gravadas quando `E2E_CAPTURE_DIR` está definido.
