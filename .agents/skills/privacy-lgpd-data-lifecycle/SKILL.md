---
name: privacy-lgpd-data-lifecycle
description: Gate bloqueante de privacidade, conformidade LGPD e ciclo de vida de dados pessoais. Use sempre que uma tarefa criar, alterar, revisar ou aprovar coleta, armazenamento, uso, compartilhamento ou eliminação de dados pessoais (usuários, membros, clientes/devedores, participantes de divisão, contatos), cadastro/aceite de termos e política, consentimentos, cookies/trackers/analytics, envio de dados a terceiros (Stripe, Gemini/IA, e-mail, monitoramento), retenção, TTL, backups, exportação/portabilidade, correção, exclusão de conta ou de workspace, anonimização, canal de titulares, subprocessadores, transferência internacional ou resposta a incidente com dados pessoais.
---

# Privacy, LGPD and Data Lifecycle

Atue como gate bloqueante. Inspecione código, schema, Rules, jobs, textos legais versionados e testes; nunca aprove por descrição ou por existência de um documento sem implementação correspondente.

Esta skill verifica evidência técnica e documental. Ela não emite parecer jurídico: todo item de natureza jurídica (bases legais, textos legais, DPAs, cláusulas de transferência, encarregado) exige registro de validação jurídica em `docs/production/PRIVACY_LGPD.md` (registro canônico dos itens de privacidade); sem esse registro o item é `FAIL` a partir do fechamento de P8, em release e no lançamento.

## Fronteiras com outras skills

- **Esta skill:** inventário e finalidade dos dados pessoais, bases legais, transparência, aceite/consentimento, direitos do titular, retenção e eliminação, subprocessadores, transferência internacional, cookies/trackers, obrigações de comunicação de incidente.
- `multi-tenant-security-review`: controles de acesso e isolamento que protegem os dados.
- `firebase-production-readiness`: mecanismos técnicos de plataforma (região, TTL configurado, retenção de backups).
- `observability-incident-readiness`: detecção e resposta técnica a incidentes; esta skill cobre avaliação de risco ao titular e comunicação à ANPD e aos titulares.
- `saas-commercial-readiness`: publicação e acessibilidade das páginas legais no funil; esta skill cobre o conteúdo e sua aderência ao que o código faz.
- `financial-domain-integrity`: preservação do histórico financeiro. Conflitos entre “não apagar histórico financeiro” e “eliminar dados pessoais” devem ser resolvidos por decisão documentada (ex.: eliminação do workspace inteiro a pedido do único titular, anonimização do ator em workspace compartilhado), nunca por omissão.

## Workflow

1. Ler integralmente [references/privacy-checklist.md](references/privacy-checklist.md).
2. Construir ou atualizar o inventário de dados pessoais a partir do código real (tipos, coleções, campos, logs, payloads enviados a terceiros), não a partir de documentação.
3. Para cada categoria, confrontar finalidade, base legal, minimização, retenção, compartilhamento e localização com o que o código faz.
4. Exercitar os fluxos de direitos do titular (acesso/exportação, correção, eliminação, revogação) de ponta a ponta, inclusive efeitos em workspaces compartilhados, backups e subprocessadores.
5. Avaliar cada item do checklist com evidência; executar os testes relevantes no Emulator.
6. Se implementação for pedida, corrigir e testar; em revisão, permanecer somente leitura.

## Política de decisão

- **Escopo da avaliação.** Em mudança ou fechamento de milestone, avaliar integralmente toda seção do checklist exercitada pelos caminhos alterados, toda invariante que o diff possa violar e todo item que o plano mestre (`docs/production/PRODUCTION_READINESS_PLAN.md` §6, §8 e §11) atribui ao milestone corrente ou a milestones anteriores. Itens atribuídos a milestone posterior e não afetados pelo diff ficam fora do escopo desta execução e são listados em "Fora do escopo desta avaliação" com o ID do plano (PR-\*, E-\*, D-\*); não são `N/A` nem `PASS`, e o veredito declara o escopo a que se aplica. Isso não é ressalva: dentro do escopo, qualquer falha ou evidência ausente é `FAIL`. Em release para STAGING/PROD, no lançamento e em P10, o escopo é o checklist integral e qualquer pendência é `FAIL`.
- `FAIL` para: dado pessoal coletado sem finalidade e base legal registradas; dado enviado a terceiro não listado como subprocessador; tracker não essencial ativo antes de consentimento; ausência de aceite versionado e registrado no servidor; ausência de fluxo funcional de exportação ou de eliminação; eliminação que deixa dados pessoais em coleções mapeadas sem justificativa de retenção legal; retenção sem mecanismo implementado; texto legal que contradiz o comportamento do código; ausência de procedimento de comunicação de incidente; item jurídico sem validação registrada; teste obrigatório ausente.
- Ausência de evidência obrigatória é `FAIL`. `N/A` somente com prova (ex.: nenhum cookie não essencial, comprovado por inventário e pelo bundle).
- Não existe “PASS com ressalvas”.

## Saída obrigatória

Começar exatamente com `PASS — Privacy/LGPD data lifecycle` ou `FAIL — Privacy/LGPD data lifecycle`.

Em seguida:

- **Escopo:** fluxos, coleções, integrações e textos avaliados.
- **Inventário:** categoria de dado → titular → coleção/campo → finalidade → base legal → retenção → compartilhamento/subprocessador → localização, com evidência.
- **Direitos do titular:** cada direito, fluxo implementado, prazo, evidência de teste.
- **Matriz de evidência:** uma linha por seção do checklist com `PASS`, `FAIL` ou `N/A`.
- **Pendências jurídicas/externas:** itens que exigem validação jurídica ou configuração fora do código.
- **Achados bloqueantes:** cenário, risco ao titular, impacto regulatório e remediação.
- **Fora do escopo desta avaliação:** itens do checklist atribuídos a milestone posterior e não afetados pelo diff, com o ID do plano; vazio em release e em P10.
- **Verificação:** comandos e testes executados.
