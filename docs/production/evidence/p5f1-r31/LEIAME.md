# P5-F.1-R3.1 — evidência (2026-11-10)

**Base.** Correção pontual sobre a árvore final da R3 (`1c9155dbc8d6aedd35e6f39a63fac46b53d81919`; commit-base `1730a1df`). Corrige só o achado independente R3-AUD-01 (HIGH): `holdEstimate` devolvia a última estimativa provada como `status: 'done'` com `proven = false`, e a interface convertia os valores por ela como se fosse a atual, sem aviso imediato.

**Árvores.**
- Código final: `d9fed573c803d64827ba278c347215054a31e0d2`. É a dos mutantes finais. As execuções finais de regressão rodaram em árvores que diferem dela só em `docs/`: o `verify:all` três vezes (`b841ec69`, `9d688d9c`, `30abca0f`) e a etapa E2E em grupos (`4e1521a6`); no gate, o `verify:all` e a etapa E2E em grupos (`6137c201`).
- Final, com os documentos: no `LEIAME.md` do pacote de auditoria.
- Depois do `verify:all` final, só arquivos de `docs/` mudaram: o roteiro de empacotamento confere e recusa outro caso.

**Veredito global: PASS** no gate da etapa (`regression-release-gate`, rodada 1; `revisoes/gate/PARECER-RODADA-1.md`).
- O R3-AUD-01 está eliminado, e nenhuma área proibida foi tocada.
- A regressão completa foi aprovada por etapas, todas executadas pelo gate na árvore final.
- Nenhuma das quatro execuções completas do `verify:all` na árvore final terminou com saída 0, a do gate inclusive. Cada uma falhou por uma causa ambiental no fim do E2E (RR-R31-07, MEDIUM de processo). A etapa E2E passou 216/216 em grupos, duas vezes.
- O RR-R31-05 (MEDIUM) fica em aberto, para etapa própria antes de publicar.

Não publicar; sem commit, push ou deploy. A próxima milestone não foi iniciada.

| Arquivo | Conteúdo |
| --- | --- |
| `matriz-antes-depois.md` | O que mudou no código e 18 cenários, cada um com o comportamento e a evidência na R3 e na R3.1 |
| `testes-substituidos.md` | Cada teste reescrito (14 de unidade, a guarda e 1 E2E): o que afirmava, o que afirma, a justificativa e os prazos |
| `testes-e-resultados.md` | Testes novos, contagens por arquivo, todas as execuções em ordem (inclusive as falhas intermediárias), valores registrados no E2E, `verify:all` e memória |
| `mutantes.md` | Mutantes dirigidos (A01–A12) e os 29 do cliente da R3, por rodada |
| `revisoes/` | Pareceres independentes (adversarial, `financial-domain-integrity`, `ptbr-product-ui-review`) por rodada, com as respostas (`revisoes/LEIAME.md`) e o parecer do gate (`revisoes/gate/`) |
| `saidas/` | Saídas das execuções (`.log.txt`, porque o `.gitignore` do projeto ignora `*.log`), sem as linhas `[WebServer]` do Emulator nos E2E. Os logs completos do `verify:all` e do E2E estão no pacote de auditoria |

**Prova vermelha.** Os testes novos e reescritos rodaram sobre o código da R3: os três arquivos de `src/` da R3 numa cópia da árvore da R3.1. Em unidade, 8 de 8 falham. Em E2E, o B03-f e a "releitura que falha" falham; no B03-f, o saldo novo R$ 20.200,00 aparece como "≈ 808 h", isto é, pela renda anterior de R$ 25,00/h, sem aviso, por mais de 60 s. Nada disso acontece na R3.1.

**Correção no fechamento.** As linhas do Emulator nos logs E2E começam com um código ANSI antes de `[WebServer]`. Por isso, o filtro das cópias em `saidas/` não as removia. O filtro passou a rodar depois da limpeza ANSI, e as cópias foram regeneradas dos mesmos logs: nenhum arquivo saiu, e as linhas do Playwright e dos testes ficaram. Os logs completos, com as linhas do Emulator, estão no pacote de auditoria.
