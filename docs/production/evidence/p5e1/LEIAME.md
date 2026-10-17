# Evidências da P5-E1 — Consolidação da Inteligência Artificial

Estado: **P5-E1 NÃO CONCLUÍDA — BLOQUEADORES IDENTIFICADOS.** A implementação está completa no working tree. O gate fica em `FAIL` por dois bloqueadores alheios ao código da P5-E1: `verify:all` como está não roda, porque a porta 8080 está presa por um emulador órfão; e há uma falha intermitente preexistente das notificações no celular, que reproduz na base (`execucoes.md`, `VEREDITOS.md`). Nenhum commit, push, deploy ou publicação foi feito. Nenhum segredo foi lido, criado ou alterado. Nenhuma chamada real ao Google foi feita nas suítes.

| Arquivo | Conteúdo |
|---|---|
| `provedor-referencias.md` | Verificação documental do Google em 2026-10-12: SDK, modelos, preços, termos, pendências e URLs ([D] lido direto, [B] por busca, [F] fórum) |
| `matriz-prompts.md` | Entradas adversariais → controle → teste que prova |
| `contexto-amostras-sinteticas.json` | Pedido completo ao provedor (instrução de sistema, bloco de dados e pergunta) para PF e PJ, gerado de relatórios sintéticos, sem dado real |
| `gerador/context-samples.cjs` | Gerador das amostras: `node gerador/context-samples.cjs <functions/lib compilado>` |
| `custos.md` | Leituras e escritas por pergunta e por extração; custo máximo de provedor por chamada |
| `mutacoes.json` | Mutantes, asserções que os mataram e conferência SHA-256 da restauração |
| `capturas/` | Diálogos de confirmação (consultor, comprovante, voz) e painel de sugestão, desktop 1280×800 e mobile 390×844, dados sintéticos |
| `execucoes.md` | Execuções de validação (integração, Rules e E2E em portas próprias por causa da porta 8080 ocupada), as duas falhas do E2E e a comparação controlada com a base |
| `VEREDITOS.md` | Vereditos das skills e do gate |
| `revisao-independente.md` | Revisão adversarial (Opus, somente leitura) e tratamento dos achados |
