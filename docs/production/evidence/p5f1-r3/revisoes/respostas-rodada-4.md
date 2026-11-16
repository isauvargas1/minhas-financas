# P5-F.1-R3 — respostas à rodada 4 (confirmação das correções da rodada 3)

A rodada 4 conferiu só documentos, sobre a árvore `99817712`. A árvore de código continua `377c2f3f`. As três revisões deram PASS:
- `privacy-lgpd-data-lifecycle`: `privacidade/PARECER-RODADA-4.md`, sem achado novo;
- `firestore-scale-cost-review`: `escala-custo/PARECER-RODADA-4.md`;
- `observability-incident-readiness` e `firebase-production-readiness`: `obs-plataforma/PARECER-OBSERVABILIDADE-RODADA-4.md` e `obs-plataforma/PARECER-PLATAFORMA-RODADA-4.md`.

| ID | Revisão | Severidade | Resposta | Onde |
| --- | --- | --- | --- | --- |
| R4-L1 | Escala | LOW | **Corrigido**, com o texto do revisor. A linha de custo da matriz diz que o limite por hora vem do orçamento dos agendadores nas releituras agendadas e dos limites de escrita do servidor na liberação por volta da projeção. Ela também registra o PASS da rodada 4 | `matriz-requisitos.md` |
| R4-I1 | Escala | INFO | **Resolvido.** O `.gitignore` ignora diretórios `logs`, então os logs das sondas dos revisores de escala e de pt-BR ficavam fora da árvore. Eles foram para `saidas/`, com o mesmo conteúdo. O roteiro de cópia passou a gravar em `saidas/` e a avisar se restar evidência ignorada. O índice das revisões explica onde ficam os logs citados como `logs/` nos pareceres | `revisoes/escala-custo/saidas/`; `revisoes/ptbr/saidas/`; `revisoes/LEIAME.md` |
| R4-I1 | Observabilidade | INFO | **Para a P7.** A frase do A21 sobre o orçamento vale para as releituras da própria falha da prova. Com escritas que fazem a projeção divergir e voltar, a liberação relê sem orçamento, inclusive durante o aviso. O custo dessa liberação está no RR-R3-09 | — |
| R4-I2 | Observabilidade | INFO | **Para a P7, no runbook.** Chamar a reconstrução com outra em andamento retoma o corte antigo. Se esse corte for anterior ao incidente, o A21 continua ligado e é preciso uma chamada nova. É o mesmo ponto do N-PRI-03, que está no RR-R3-08 | — |
| R4-I3 | Observabilidade | INFO | **Corrigido.** O índice das revisões cita os dois arquivos reais da rodada 4 | `revisoes/LEIAME.md` |
| PLAT-R4-I1 | Plataforma | INFO | Sem ação. Os scripts `deploy:*` continuam fixos no projeto de produção. Isso é herdado (PR-PLAT-01, P6), e a D-ORD-04 impede publicar antes da P6. Nenhum agente executa esses scripts | — |
| PLAT-R4-I2 | Plataforma | INFO | Sem ação. "Rules anteriores" vale para as Rules do HEAD e da R2A | — |

**Depois desta resposta, antes do gate (rodada 2):**
- a cópia dos pareceres da rodada 4 por `copiar-pareceres.sh`;
- o relatório, que fica fora da árvore.

Depois do gate, só os marcadores de veredito, a linha da P5, o histórico do plano e a cópia do parecer do gate.
