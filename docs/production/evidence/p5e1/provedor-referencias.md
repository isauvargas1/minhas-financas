# P5-E1 — Provedor Google: verificação documental (D-11.2)

Consulta: **2026-10-12**, somente leitura, sem credencial e sem chamada à API. Nenhum segredo foi lido, criado ou alterado.

**Limitação.** `ai.google.dev`, `docs.cloud.google.com`, `business.safety.google` e `firebase.google.com` estavam inacessíveis no ambiente de trabalho: o proxy bloqueou as consultas, sem contorno. Legenda:

- **[D]** lido direto: repositórios oficiais no GitHub, `registry.npmjs.org` e páginas de termos e preços em `cloud.google.com`.
- **[B]** resumo de busca sobre página oficial do Google. É secundário: números e datas precisam ser conferidos ao vivo em navegador antes de qualquer contratação.
- **[F]** fórum ou relato de usuário. Serve só como indício.

## Decisão de implementação desta etapa

| Tema | Decisão | Base |
|---|---|---|
| SDK | Migrar de `@google/generative-ai` 0.24.1 para `@google/genai` `~2.28.0` (fixado abaixo da 3.0.0, que exige Node ≥ 22). | Legado sem suporte desde 2025-11-30 [D]. O 2.28.0 é a versão estável de 2026-10-07, com `engines >= 20` [D]. |
| Instruções × dados | `config.systemInstruction` separado de `contents`. | API do SDK [D] |
| Saída estruturada | Extração com `responseMimeType: application/json` e `responseJsonSchema` (subconjunto JSON Schema; campo anulável como `anyOf` com `null`), revalidada por Zod no servidor. | API do SDK [D] |
| Tempo limite e repetição | `httpOptions.timeout` de 90 s, por tentativa, abaixo dos 120 s da callable. Sem `retryOptions`, ou seja, sem repetição automática: cada nova tentativa seria cobrada outra vez. | `_api_client.ts` repete só com `retryOptions` [D] |
| Raciocínio | `thinkingLevel: LOW`. Tetos de saída de 2.048 (análise) e 1.024 (extração), que cobrem raciocínio e resposta. | API do SDK [D]. Teto cobre o raciocínio [B/F] |
| Erros | Classificados por `ApiError.status` (408/429/4xx/5xx), sem guardar a mensagem do SDK. | `errors.ts` [D] |
| Modelo | **Mantido** `gemini-3-flash-preview`. | Preview desde 2025-12-17, sem data de desligamento anunciada e com aviso mínimo de 2 semanas [B] |
| Troca para modelo GA | **Pendente.** Candidatos: `gemini-3.5-flash-lite` (GA em 2026-07-21) e `gemini-3.8-flash` (estável). Exige conferência ao vivo da documentação e avaliação de qualidade em STAGING. | [B] |
| Credencial | Gemini API com chave apenas no Secret Manager (`GOOGLE_AI_API_KEY`, declarada em `secrets`). Nenhuma `VITE_*`. A rotação da chave exposta no passado (PR-AI-02/E-00) **não foi executada nem comprovada**. | `functions/src/ai/callables.ts` |

## Preços (US$ por 1M tokens, nível pago; a saída inclui o raciocínio) [B]; Agent Platform global [D]

| Modelo | Entrada | Saída |
|---|---|---|
| `gemini-3-flash-preview` (atual) | 0,50 | 3,00 |
| `gemini-3.5-flash-lite` | 0,30 | 2,50 |
| `gemini-3.8-flash`, promocional até 2026-12-31 | 0,75 | 3,75 |
| `gemini-3.8-flash`, a partir de 2027-01-01 | 1,50 | 7,50 |

Endpoints regionais da Vertex/Agent Platform custam +10% [D].

## Termos de dados

- **Gemini API, serviço pago** [B], Additional Terms com vigência em 2026-03-23:
  - não usa prompts nem respostas para melhorar produtos;
  - o tratamento segue o *Data Processing Addendum for Products Where Google is a Data Processor*, cujo texto não foi aberto;
  - o serviço não pago usa os dados para melhoria e pode ter revisão humana, por isso é inadequado para produção.
- **Monitoramento de abuso na Gemini API** [B]: retenção de 55 dias; ZDR só por pedido, por projeto; sem seletor de região, com armazenamento em qualquer país onde o Google tenha instalações; o Brasil consta como país disponível.
- **Vertex / Agent Platform** [D]:
  - está no escopo do Cloud DPA, que tem anexo Brasil (LGPD, Cláusulas-Padrão BR);
  - os termos não guardam prompts e saídas além do necessário (20.h);
  - AI/ML Data Location oferece multi-região us/eu;
  - Pre-GA fica fora do DPA e não deve tratar dado pessoal (§5(d)).
- **Residência em `southamerica-east1`** para os modelos atuais: **não confirmada** [B].

## Pendências externas (abertas)

1. Ler na íntegra os Gemini API Additional Terms e o DPA de processador. Confirmar a forma de aceite, os subprocessadores e o mecanismo de transferência internacional (LGPD). **E-09**
2. Conferir ao vivo os itens [B]: preços, modelos estáveis, limites, ZDR e log de abuso. **E-10**
3. Projeto Cloud em Tier pago:
   - Prepay ou Postpay;
   - alertas de orçamento;
   - limites RPM/TPM/RPD reais por modelo, que são por projeto.
4. Pedido de ZDR ou isenção do log de abuso.
5. Vertex como alternativa: contrato, `aiplatform.googleapis.com`, região do modelo escolhido e IAM por service account.
6. Jurídico/DPO: base legal, RIPD, política de privacidade com o Google como operador. **PR-AI-01, P8**
7. Rotação da chave exposta no passado. **PR-AI-02 / E-00**
8. `engines.node "24"` em `functions/package.json` × Node v22 local.

## Referências (todas consultadas em 2026-10-12)

| Marca | URL | O que confirma |
|---|---|---|
| [D] | https://github.com/google-gemini/deprecated-generative-ai-js | SDK antigo legado; fim de suporte em 2025-11-30 |
| [D] | https://github.com/googleapis/js-genai | v2.28.0; Node ≥ 20 (3.0.0 exige ≥ 22); `systemInstruction`, `responseJsonSchema`, `thinkingConfig`, `httpOptions.timeout`, `ApiError`, repetição só com `retryOptions` |
| [D] | https://registry.npmjs.org/@google/genai | `latest` 2.28.0 (2026-10-07) |
| [D] | https://registry.npmjs.org/@google/generative-ai | 0.24.1 (2025-04-29) |
| [D] | https://cloud.google.com/terms/service-terms | Pre-GA sem DPA; 20.h; AI/ML Data Location (modificado em 2026-10-08) |
| [D] | https://cloud.google.com/terms/data-processing-addendum | Cloud DPA com anexo Brasil/LGPD (modificado em 2026-06-08) |
| [D] | https://cloud.google.com/terms/services | Generative AI on Agent Platform no escopo; Gemini API ausente (modificado em 2026-09-30) |
| [D] | https://cloud.google.com/terms/data-residency | Generative AI com multi-região só para modelos em "ML processing" (modificado em 2026-09-08) |
| [D] | https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing | Preços; +10% regional; promoção até 2026-12-31 |
| [B] | https://ai.google.dev/gemini-api/docs/deprecations | Status do `3-flash-preview` |
| [B] | https://ai.google.dev/gemini-api/docs/changelog | GA do 3.5 Flash-Lite e 3.8 Flash |
| [B] | https://ai.google.dev/gemini-api/docs/models | Modelos estáveis e política de preview |
| [B] | https://ai.google.dev/gemini-api/docs/pricing | Preços; free × pago |
| [B] | https://ai.google.dev/gemini-api/docs/rate-limits | Tiers e dimensões RPM/TPM/RPD |
| [B] | https://ai.google.dev/gemini-api/terms | Pago × não pago; DPA de processador |
| [B] | https://ai.google.dev/gemini-api/docs/zdr | Condições de ZDR |
| [B] | https://ai.google.dev/gemini-api/docs/logs-policy | 55 dias de log de abuso |
| [B] | https://ai.google.dev/gemini-api/docs/available-regions | Brasil disponível; sem seletor de região |
| [B] | https://ai.google.dev/gemini-api/docs/file-input-methods | Limites inline |
| [B] | https://ai.google.dev/gemini-api/docs/structured-output | JSON Schema |
| [B] | https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention | ZDR e log de 30 dias na Vertex |
| [B] | https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/data-residency | Residência; ML processing do 3.8 Flash em us/eu |
