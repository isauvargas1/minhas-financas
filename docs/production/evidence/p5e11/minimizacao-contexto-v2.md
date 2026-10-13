# P5-E1.1 — O que vai ao provedor de IA: contexto da análise v2

## 1. Problema da v1 (P5-E1)

Na v1, o contexto da análise financeira enviava ao Google (Gemini API) o **nome livre** de até 5 categorias de despesa. O nome passava por `sanitizeUntrustedLabel`, com o limite de 40 caracteres de `ANALYSIS_CATEGORY_LABEL_MAX`.

O nome de categoria é digitado pelo usuário. Ele pode conter dado pessoal, como "Cliente João Silva CPF 123.456.789-00", "Pix maria@exemplo.com" ou "Tratamento da Ana". Sanitizar pontuação, controles e tamanho não é anonimizar.

## 2. Decisão (§4.2 e §4.3)

- **O campo é excluído, não filtrado.** As categorias entram como `"Grupo de despesas N"`, onde N é a posição 1…5 no ranking por valor. Não há regex de CPF, e-mail ou telefone, nem lista de nomes ou detecção probabilística.
- **Rótulo genérico e não reversível.** Não é nome interno, hash nem ID, e não existe mapa de reconstrução. O montador do contexto (`buildAnalysisContext`, em `topExpenseCategories`) não lê o nome nem a chave da categoria: um teste com getters que lançam erro prova isso. O relatório oficial continua com os nomes, porque a tela de Relatórios precisa deles.
- **Agregados preservados (§4.4):** valor em centavos (BRL formatado), participação em basis points, ordem por valor decrescente (empates na ordem do relatório oficial), teto de 5 grupos, cobertura, período e os demais indicadores. O relatório mostrado ao usuário continua com os nomes reais, e isso é verificado no P21/P22.
- **`ANALYSIS_CONTEXT_VERSION` = 2**, sem compatibilidade com o formato antigo e sem duplo payload (§4.7).
- **Taxonomia fixa do produto:** não foi usada. O catálogo de categorias é editável pelo usuário (P4-E), então só sobram rótulos genéricos.

## 3. Contrato v2 do bloco de categorias

| Campo enviado | Origem | Texto livre? |
| --- | --- | --- |
| `categorias.cobertura` | rótulo fixo do produto ("completo", "parcial"…) | não |
| `categorias.maioresDespesas[].grupo` | `"Grupo de despesas ${posição}"` | não (rótulo fixo) |
| `categorias.maioresDespesas[].valor` | `amountCents` do relatório oficial, em BRL | não |
| `categorias.maioresDespesas[].participacao` | `shareBasisPoints`, em % (ou "não calculável") | não |

Saíram do código o sanitizador, `ANALYSIS_CATEGORY_LABEL_MAX`, o rótulo "Sem categoria" do contexto e as regex que só o sanitizador usava. A busca por `sanitizeUntrustedLabel|ANALYSIS_CATEGORY_LABEL_MAX` em `functions/src/ai` só encontra as asserções de que o módulo não as exporta mais.

## 4. Comparação do payload antes e depois

Usamos as amostras sintéticas PF e PJ do mesmo relatório:

- v1: [`../p5e1/contexto-amostras-sinteticas.json`](../p5e1/contexto-amostras-sinteticas.json);
- v2: [`contexto-amostras-sinteticas-v2.json`](contexto-amostras-sinteticas-v2.json), produzida por [`gerador/context-samples.cjs`](gerador/context-samples.cjs), que falha se qualquer nome, ID ou chave de entrada aparecer na saída.

Comparamos campo a campo, depois de achatar o JSON de `DADOS FINANCEIROS`:

| | PF | PJ |
| --- | --- | --- |
| Campos que só existem na v1 | `categorias.maioresDespesas[0..2].nome` | `categorias.maioresDespesas[0..2].nome` |
| Campos que só existem na v2 | `categorias.maioresDespesas[0..2].grupo` | `categorias.maioresDespesas[0..2].grupo` |
| Valores alterados | só `versao` (1 → 2) | só `versao` (1 → 2) |
| Valores, participações e demais indicadores | idênticos | idênticos |
| Pergunta do usuário | idêntica | idêntica |
| Instrução de sistema | ganhou a regra dos grupos (§5) | idem |

Na entrada das amostras, os nomes são propositalmente pessoais e fictícios. Na v1, eles saíam sanitizados, por exemplo `"Alimentação script"` e `"Sem categoria"`. Na v2 saem `"Grupo de despesas 1"`, `"Grupo de despesas 2"` e `"Grupo de despesas 3"`.

## 5. Comportamento do consultor (§4.5)

Esta regra entrou na instrução de sistema (`functions/src/ai/prompts.ts`), separada da pergunta:

> As maiores despesas por categoria vêm identificadas só pela posição no ranking ("Grupo de despesas 1", "Grupo de despesas 2" e assim por diante): o resumo não traz o nome de nenhuma categoria. Nunca afirme, deduza nem invente nomes de categorias e nunca associe um grupo a um nome citado na pergunta. Se perguntarem qual é a categoria, informe a posição, o valor e a participação do grupo e explique que o nome da categoria não é enviado nesta análise. Não peça que esses nomes sejam enviados.

Não existe caminho para o navegador enviar nomes: o schema da análise é estrito e o contexto é montado só no servidor.

Limite conhecido: o comportamento do modelo real não é testado aqui, porque não há chamada real à API Gemini nesta etapa. O que os testes provam é que **o nome não sai** do servidor. A regra só reduz o risco de o modelo inventar um nome.

## 6. Demais campos enviados ao provedor (§4.6)

O formato completo do contexto é uma lista fechada de chaves, verificada pelo `ALLOWED_SHAPE` em `functions/src/ai/__tests__/aiContext.integration.test.ts`. Qualquer campo novo reprova o teste. Revisamos cada bloco:

| Bloco | Conteúdo | Texto livre de registro? |
| --- | --- | --- |
| `versao`, `perfil` | número; "PF"/"PJ" | não |
| `periodo.rotulo` | rótulo fixo do produto (preset ou "mês de ano") | não |
| `contas`, `caixa`, `indicadores`, `cartoes`, `dividas`, `investimentos` | valores formatados, contagens, coberturas e motivos fixos | não (sem nomes de contas, cartões, clientes, contrapartes ou descrições) |
| `alertas.itens[]` | `codigo` (enum), `severidade` (enum), `valores` (inteiros validados) | não (sem título ou mensagem de alerta) |
| `categorias.maioresDespesas[]` | `grupo` genérico, valor, participação | não (desde a v2) |

Fluxos distintos, cada um com seu próprio aviso no diálogo, inalterados:

1. **Pergunta digitada:** vai inteira, em parte separada da instrução e marcada como dado não confiável. O aviso diz que ela pode conter dados pessoais escritos pelo próprio usuário.
2. **Comprovante (imagem/PDF) para extração:** diálogo próprio, que informa que o documento pode ter dados pessoais e bancários.
3. **Voz:** diálogo próprio no início da captação e outro no envio da transcrição.

## 7. Transparência (§5): `AiShareConsentDialog`, variante `analysis`

| Antes (P5-E1) | Depois (P5-E1.1) |
| --- | --- |
| "…a sua pergunta e um resumo financeiro deste espaço de trabalho preparado pelo servidor para o período: X." | "Para responder, o FênixGran envia ao Google (Gemini API), provedor de IA usado pelo FênixGran, o texto da sua pergunta e um resumo financeiro deste espaço de trabalho, preparado pelo sistema para o período: X." |
| "O resumo tem apenas totais: saldos, entradas e saídas, até 5 categorias de despesa, cartões, dívidas, investimentos (conforme sua permissão) e alertas. Não inclui lançamentos individuais, nomes de clientes, nomes de cartões nem identificadores." | "O resumo tem apenas valores agregados do período: saldos, entradas e saídas, receitas e despesas, indicadores, cartões, dívidas e valores a receber, movimentações de investimentos e, conforme sua permissão, o patrimônio investido, alertas, o tipo do espaço (pessoal ou empresa) e até 5 grupos de despesas identificados só pela posição (Grupo de despesas 1, 2…)." e "O resumo não inclui os nomes das categorias, nomes de clientes ou de cartões, descrições de lançamentos nem identificadores internos." |
| — | "A pergunta que você digitou vai inteira e pode conter dados pessoais que você mesmo tenha escrito. Evite incluir dados pessoais desnecessários." |
| "A resposta é gerada automaticamente, pode conter erros e não altera nenhum dado. Confira antes de tomar decisões." | "A resposta é gerada por IA, pode conter erros e não altera nenhum registro financeiro. Confira antes de tomar decisões." |
| crédito (mantido) | "Cada envio usa 1 crédito de IA do plano, mesmo que o serviço de IA falhe depois de aceitar o pedido." |

O diálogo não faz nenhuma das afirmações proibidas pelo §5.2: anonimização total, ausência de dado pessoal, dados que nunca saem, não armazenamento pelo Google ou transmissão exclusivamente nacional. A guarda `tests/unit/ai-share-contract.test.ts` verifica as frases obrigatórias e a ausência dessas promessas. O E2E `e2e/ai-consent-extraction.spec.ts` confere, no navegador, que três frases-chave aparecem no diálogo, e `tests/unit/ai-extraction-form.test.ts` compara os textos exatos.

Ficaram preservados (§5.4):

- `AI_PROVIDER_CONSENT_VERSION = "ai-provider-share-v1"`;
- confirmação por operação, sem caixa pré-marcada;
- a confirmação técnica não é apresentada como consentimento jurídico (LGPD);
- o momento da admissão dos créditos;
- nada é enviado se o usuário cancelar (P26/P27).

## 8. Prova estrutural (testes)

| Suíte | Cobertura | Resultado |
| --- | --- | --- |
| `functions/src/ai/__tests__/analysisContext.test.ts` (53) | 17 nomes perigosos (comum, CPF, CNPJ, e-mail, telefone, pessoa, conta, Pix, endereço, multilinha, *prompt injection*, invisíveis, 600+ caracteres, vazio, `null`, só espaços, neutro-privado), com ausência verificada no nome inteiro e em janelas de 8+ caracteres; 5 e mais de 5 grupos; empate; PF/PJ; indisponível, `rebuild_needed`, `not_requested` e parcial; getters que lançam erro em `name`/`categoryKey`; versão 2; regra na instrução | 661/661 no unitário das Functions |
| `functions/src/ai/__tests__/aiMinimization.integration.test.ts`, P01–P28 | pipeline real do callable no Emulator com gateway falso. Compara exatamente o que foi enviado: nome, fragmentos, chave e ID da categoria, UIDs e workspaces do tenant e de outro tenant, CPF, CNPJ e e-mail ausentes; `grupo`/`valor`/`participacao`; instrução igual à estática; nenhuma escrita financeira. Também: PF/PJ com dados semeados, sem permissão de investimentos, indisponível, parcial, sem confirmação, confirmação de outra operação e concorrência com a mesma chave (um débito, um recibo, uma chamada) | 108/108 nas quatro suítes de IA (`aiContext`, `aiMinimization`, `aiSecurity`, `aiCredits`) |
| `aiContext.integration.test.ts` X01/X29 | `grupo: "Grupo de despesas 1"`; nome malicioso, fragmentos e ID da categoria ausentes | incluído acima |
| `tests/unit/ai-share-contract.test.ts` (3) | frases obrigatórias do diálogo, promessas proibidas e correspondência com o `analysisContext.ts` (só `grupo`, sem `nome:`, `item.name` nem `categoryKey`) | 3/3 |

As mutações dirigidas a esta correção ficam em [`mutacoes.md`](mutacoes.md).
