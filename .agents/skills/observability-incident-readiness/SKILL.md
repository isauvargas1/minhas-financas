---
name: observability-incident-readiness
description: Gate bloqueante de observabilidade, auditoria e prontidão para incidentes. Use sempre que uma tarefa criar, alterar, revisar ou aprovar logging (estrutura, campos, sanitização), correlation/request IDs, métricas, tratamento e reporte de erros, alertas, trilhas de auditoria, eventos de segurança, jobs de reconciliação financeira, detecção de falha e replay de webhooks, runbooks, processo de resposta a incidentes, preservação de evidência ou plano de disaster recovery — e antes de fechar milestones de hardening ou release para STAGING/PROD.
---

# Observability and Incident Readiness

Atue como gate bloqueante. Inspecione instrumentação real no código, configuração de alertas registrada, runbooks e evidência de exercícios; nunca aprove pela existência de um documento sem instrumentação ou exercício correspondente.

## Fronteiras com outras skills

- **Esta skill:** o que é registrado e como (logs, correlação, métricas, erros), o que dispara alerta e para quem, trilhas de auditoria, detecção de deriva financeira, operação de falhas de webhook, processo de incidente, evidência forense e plano/exercício de DR.
- `firebase-production-readiness`: existência da plataforma (Logging/Monitoring habilitados, retenção de logs, backups/PITR configurados, restore testado).
- `financial-domain-integrity`: a fórmula de reconciliação e a correção dos totais; esta skill verifica que a reconciliação roda, é observável e alerta.
- `billing-entitlement-integrity`: correção e idempotência do webhook; esta skill verifica detecção, alerta e procedimento de replay.
- `privacy-lgpd-data-lifecycle`: comunicação de incidente à ANPD/titulares e retenção legal de registros.
- `multi-tenant-security-review`: controles de acesso; esta skill verifica que violações e tentativas são registradas e alertadas.

## Workflow

1. Ler integralmente [references/observability-checklist.md](references/observability-checklist.md).
2. Inventariar pontos de entrada (callables, HTTP, gatilhos, crons, frontend) e, para cada um, o que é registrado, com quais campos, e como o erro chega ao usuário e ao operador.
3. Rastrear um `requestId`/correlation ID do cliente até logs, eventos de domínio, auditoria e efeitos assíncronos.
4. Mapear sinais críticos → métrica → alerta → destinatário → runbook. Sinal sem alerta ou alerta sem runbook é lacuna.
5. Avaliar cada item do checklist com evidência; executar testes de logging/sanitização e de correlação; conferir evidência de exercícios (alerta disparado em STAGING, drill de incidente, restore/DR).
6. Se implementação for pedida, corrigir e testar; em revisão, permanecer somente leitura.

## Política de decisão

- **Escopo da avaliação.** Em mudança ou fechamento de milestone, avaliar integralmente toda seção do checklist exercitada pelos caminhos alterados, toda invariante que o diff possa violar e todo item que o plano mestre (`docs/production/PRODUCTION_READINESS_PLAN.md` §6, §8 e §11) atribui ao milestone corrente ou a milestones anteriores. Itens atribuídos a milestone posterior e não afetados pelo diff ficam fora do escopo desta execução e são listados em "Fora do escopo desta avaliação" com o ID do plano (PR-\*, E-\*, D-\*); não são `N/A` nem `PASS`, e o veredito declara o escopo a que se aplica. Isso não é ressalva: dentro do escopo, qualquer falha ou evidência ausente é `FAIL`. Em release para STAGING/PROD, no lançamento e em P10, o escopo é o checklist integral e qualquer pendência é `FAIL`.
- `FAIL` para: logs não estruturados em caminho crítico; segredo, token, dado de cartão ou dado pessoal desnecessário em log; ausência de correlation ID propagado; erro interno exibido ao usuário; sinal crítico sem métrica ou sem alerta; alerta sem dono ou sem runbook; auditoria ausente, mutável pelo cliente ou incompleta para ação sensível; reconciliação financeira inexistente, não observável ou sem alerta de divergência; falha de webhook invisível ou sem replay seguro documentado; processo de incidente, severidades ou contatos ausentes; RTO/RPO indefinidos; DR ou restore nunca exercitados; item obrigatório sem evidência.
- Alertas e dashboards configurados fora do repositório exigem registro versionado em `docs/production/OBSERVABILITY.md` (sinal, condição, destinatário, runbook, data da última verificação). Sem registro, `FAIL`.
- `N/A` somente com prova. Não existe “PASS com ressalvas”.

## Saída obrigatória

Começar exatamente com `PASS — Observability and incident readiness` ou `FAIL — Observability and incident readiness`.

Em seguida:

- **Escopo:** pontos de entrada, jobs, integrações e documentos avaliados.
- **Mapa de sinais:** sinal crítico → log/métrica → alerta → destinatário → runbook, com lacunas marcadas.
- **Correlação:** caminho de um request/evento com evidência de propagação.
- **Auditoria:** ações sensíveis cobertas, campos, imutabilidade, retenção.
- **Matriz de evidência:** uma linha por seção do checklist com `PASS`, `FAIL` ou `N/A`.
- **Exercícios:** alertas testados, drills, restore/DR — data e resultado.
- **Achados bloqueantes:** cenário, impacto operacional e remediação.
- **Fora do escopo desta avaliação:** itens do checklist atribuídos a milestone posterior e não afetados pelo diff, com o ID do plano; vazio em release e em P10.
- **Verificação:** comandos e testes executados.
