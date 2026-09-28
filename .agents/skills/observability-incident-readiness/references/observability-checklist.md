# Checklist de observabilidade e prontidão para incidentes

Citar arquivo:linha para instrumentação e o registro em `docs/production/OBSERVABILITY.md`, `docs/production/INCIDENT_RESPONSE.md`, `docs/production/BACKUP_RESTORE_DR.md` e `docs/production/RUNBOOKS.md` para o que é configurado ou exercitado fora do código.

## 1. Logging estruturado

- Um logger compartilhado no backend (ex.: `firebase-functions/logger`) com saída JSON, `severity` correto e campos padronizados: operação, resultado, código de erro estável, `requestId`/correlation ID, `workspaceId` e identificação do ator (pseudonimizada quando possível), chave de idempotência quando houver, duração.
- Nenhum `console.log` solto em caminho de produção; nenhum log com segredo, token, cabeçalho de autorização, dado de cartão, payload financeiro completo ou dado pessoal desnecessário. Sanitização testada.
- Frontend: captura de erros não tratados sem dados pessoais, com destino definido (e, se for serviço de terceiro, registrado como subprocessador).
- Volume de log limitado (sem log por item em loops grandes); amostragem definida onde necessário.

## 2. Correlação

- Correlation ID gerado no cliente ou na borda, propagado para callables, eventos de domínio, trilha de auditoria, gatilhos e jobs derivados, e devolvido ao cliente em erros para suporte.
- Eventos assíncronos (gatilhos, crons, webhooks) carregam a identidade do evento de origem.

## 3. Métricas

- Métricas (log-based ou custom) para: taxa de erro e latência por callable; falhas e atraso de webhooks; execuções de cron (sucesso, duração, itens processados, ausência de execução); divergências de reconciliação; rate limits atingidos; rejeições de App Check; negações de autorização; operações de billing; consumo de IA.
- Dashboards mínimos definidos por sinal crítico.

## 4. Erros

- Erros de backend mapeados para códigos estáveis e mensagens pt-BR seguras; detalhes técnicos apenas em log.
- Erros agrupados em Error Reporting (ou equivalente) com contexto suficiente para diagnóstico.
- Nenhum erro engolido silenciosamente em caminho financeiro, de billing ou de segurança.

## 5. Alertas

- Cada sinal crítico tem política de alerta com condição, janela, severidade, destinatário (pessoa/canal), runbook vinculado e dono.
- Alertas mínimos: pico de erros 5xx/`internal`; falhas consecutivas ou atraso de webhook Stripe; cron que não executou ou falhou; divergência de reconciliação financeira; picos de negação de autorização/App Check; budget; quota de API externa; falha de backup.
- Evidência de que cada alerta foi disparado em teste (STAGING) e chegou ao destinatário.

## 6. Auditoria

- Trilha append-only para ações sensíveis: criação/aceite/remoção de convite e membership, mudança de papel e ownership, mudanças de plano/assinatura, cancelamentos e estornos financeiros, exclusões/arquivamentos, exportações de dados, exclusão de conta, ações administrativas e de suporte.
- Cada registro: ator (ou serviço/evento externo), workspace efetivo, ação, alvo, resultado, antes/depois ou dados suficientes para reconstrução, correlation ID, timestamp de servidor.
- Gravação exclusiva pelo backend; Rules negam criação, alteração e exclusão pelo cliente; leitura restrita por papel e paginada.
- Retenção definida e compatível com obrigações legais e com a política de privacidade.

## 7. Eventos de segurança

- Registrados e com alerta para anomalias: falhas repetidas de autenticação, negações de permissão em callables, tentativas cross-tenant, falhas de App Check, mudanças de papel, acesso administrativo, alterações de configuração de segurança.

## 8. Reconciliação financeira

- Jobs que reconstroem totais a partir das fontes oficiais e comparam com projeções/agregados (cartões e faturas, caixa, investimentos, metas, empréstimos, recebíveis), limitados por execução (rodízio/cursor), idempotentes e com resultado persistido.
- Divergência gera alerta com contexto suficiente e runbook de reparo que não apaga histórico.

## 9. Webhooks e integrações externas

- Cada evento recebido registrado com id, tipo, status de processamento, tentativas e último erro.
- Falhas visíveis (fila/consulta paginada) e alertadas; procedimento de replay idempotente documentado em `docs/production/RUNBOOKS.md`.
- Dependências externas (Stripe, provedor de IA, e-mail) com timeout, tratamento de indisponibilidade e sinal de saúde.

## 10. Resposta a incidentes

- `docs/production/INCIDENT_RESPONSE.md` com: severidades (ex.: SEV1–SEV4) e critérios; papéis (coordenação, comunicação, técnico); canais; fluxo detecção → triagem → contenção → erradicação → recuperação → postmortem sem culpados; modelos de comunicação a clientes; integração com a avaliação de comunicação à ANPD/titulares (`privacy-lgpd-data-lifecycle`); contatos de suporte dos fornecedores.
- Mecanismos de contenção documentados e testáveis: desligar funcionalidade/Function, modo somente leitura, revogar sessões/tokens, rotacionar segredos, bloquear usuário.
- Drill de incidente executado com registro (data, cenário, tempo de resposta, ações de melhoria).

## 11. Evidência e forense

- Retenção de logs compatível com necessidades forenses e obrigações legais; sink para armazenamento com retenção/lock quando exigido.
- Acesso a logs e evidências restrito e auditado; procedimento de preservação (snapshot de logs, export do banco para análise isolada) sem alterar o ambiente afetado.

## 12. Disaster recovery

- RTO e RPO definidos por serviço e aprovados.
- Cenários cobertos: corrupção lógica de dados, exclusão acidental, indisponibilidade regional, comprometimento de credenciais/conta, erro de deploy (rollback de Functions/Rules/índices).
- Runbooks passo a passo em `docs/production/BACKUP_RESTORE_DR.md` e `docs/production/RUNBOOKS.md`, com dono.
- Exercício de DR além do restore, com evidência (data, cenário, RPO/RTO medidos, falhas encontradas, correções); o exercício de restore em si é evidenciado via `firebase-production-readiness` §11.

## 13. Testes obrigatórios

1. Logger: formato estruturado, campos obrigatórios, sanitização de segredos e dados pessoais.
2. Correlação: correlation ID presente em logs, eventos e auditoria gerados por um callable e por um gatilho derivado.
3. Auditoria: ação sensível gera registro completo; cliente não consegue criar/alterar/apagar registro (Rules no Emulator).
4. Reconciliação: divergência injetada é detectada e registrada.
5. Webhook: falha é registrada com status consultável e replay posterior é idempotente.
