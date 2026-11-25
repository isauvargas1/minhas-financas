# FênixGran — Contraste preliminar dos tokens candidatos

Cálculo de luminância relativa sRGB e razão de contraste WCAG. Não constitui auditoria da interface; estados hover/focus sobre superfícies inverse/accent, ícones, charts, temas personalizados, tamanhos e comportamento ainda exigem testes. Critérios 4,5 para texto normal e 3 para informação não textual quando aplicável. Bordas decorativas não são avaliadas como controles.

| Modo | Primeiro plano | Fundo | Contraste | Mínimo | Resultado |
|---|---|---|---:|---:|---|
| Claro | text.primary `#1D1D1B` | surface.page `#F4F2EE` | 15.10:1 | 4.5:1 | PASS |
| Claro | text.primary `#1D1D1B` | surface.panel `#FFFFFF` | 16.88:1 | 4.5:1 | PASS |
| Claro | text.primary `#1D1D1B` | surface.subtle `#F9F9F7` | 16.02:1 | 4.5:1 | PASS |
| Claro | text.secondary `#5D5B53` | surface.page `#F4F2EE` | 6.08:1 | 4.5:1 | PASS |
| Claro | text.secondary `#5D5B53` | surface.panel `#FFFFFF` | 6.80:1 | 4.5:1 | PASS |
| Claro | text.secondary `#5D5B53` | surface.subtle `#F9F9F7` | 6.45:1 | 4.5:1 | PASS |
| Claro | text.heading `#16365B` | surface.page `#F4F2EE` | 10.97:1 | 4.5:1 | PASS |
| Claro | text.heading `#16365B` | surface.panel `#FFFFFF` | 12.26:1 | 4.5:1 | PASS |
| Claro | text.heading `#16365B` | surface.subtle `#F9F9F7` | 11.63:1 | 4.5:1 | PASS |
| Claro | link `#16365B` | surface.page `#F4F2EE` | 10.97:1 | 4.5:1 | PASS |
| Claro | link `#16365B` | surface.panel `#FFFFFF` | 12.26:1 | 4.5:1 | PASS |
| Claro | link `#16365B` | surface.subtle `#F9F9F7` | 11.63:1 | 4.5:1 | PASS |
| Claro | finance.income `#4F6C4E` | surface.page `#F4F2EE` | 5.24:1 | 4.5:1 | PASS |
| Claro | finance.income `#4F6C4E` | surface.panel `#FFFFFF` | 5.85:1 | 4.5:1 | PASS |
| Claro | finance.income `#4F6C4E` | surface.subtle `#F9F9F7` | 5.55:1 | 4.5:1 | PASS |
| Claro | finance.expense `#881812` | surface.page `#F4F2EE` | 8.59:1 | 4.5:1 | PASS |
| Claro | finance.expense `#881812` | surface.panel `#FFFFFF` | 9.61:1 | 4.5:1 | PASS |
| Claro | finance.expense `#881812` | surface.subtle `#F9F9F7` | 9.11:1 | 4.5:1 | PASS |
| Claro | finance.investment `#16365B` | surface.page `#F4F2EE` | 10.97:1 | 4.5:1 | PASS |
| Claro | finance.investment `#16365B` | surface.panel `#FFFFFF` | 12.26:1 | 4.5:1 | PASS |
| Claro | finance.investment `#16365B` | surface.subtle `#F9F9F7` | 11.63:1 | 4.5:1 | PASS |
| Claro | finance.pending `#814800` | surface.page `#F4F2EE` | 6.57:1 | 4.5:1 | PASS |
| Claro | finance.pending `#814800` | surface.panel `#FFFFFF` | 7.34:1 | 4.5:1 | PASS |
| Claro | finance.pending `#814800` | surface.subtle `#F9F9F7` | 6.96:1 | 4.5:1 | PASS |
| Claro | action.primary.fg `#FFFFFF` | action.primary.bg `#16365B` | 12.26:1 | 4.5:1 | PASS |
| Claro | action.accent.fg `#16365B` | action.accent.bg `#EA9543` | 5.18:1 | 4.5:1 | PASS |
| Claro | status.success.fg `#4F6C4E` | status.success.bg `#EBF1EB` | 5.11:1 | 4.5:1 | PASS |
| Claro | status.warning.fg `#814800` | status.warning.bg `#FBEDE0` | 6.39:1 | 4.5:1 | PASS |
| Claro | status.error.fg `#881812` | status.error.bg `#EBD8D7` | 7.01:1 | 4.5:1 | PASS |
| Claro | status.info.fg `#16365B` | status.info.bg `#D8DDE4` | 8.98:1 | 4.5:1 | PASS |
| Claro | border.control `#7D7A72` | surface.page `#F4F2EE` | 3.83:1 | 3.0:1 | PASS |
| Claro | border.control `#7D7A72` | surface.panel `#FFFFFF` | 4.29:1 | 3.0:1 | PASS |
| Claro | border.control `#7D7A72` | surface.subtle `#F9F9F7` | 4.07:1 | 3.0:1 | PASS |
| Claro | focus.ring `#A95F00` | surface.page `#F4F2EE` | 4.34:1 | 3.0:1 | PASS |
| Claro | focus.ring `#A95F00` | surface.panel `#FFFFFF` | 4.86:1 | 3.0:1 | PASS |
| Claro | focus.ring `#A95F00` | surface.subtle `#F9F9F7` | 4.61:1 | 3.0:1 | PASS |
| Escuro | text.primary `#F9F9F7` | surface.page `#101B29` | 16.45:1 | 4.5:1 | PASS |
| Escuro | text.primary `#F9F9F7` | surface.panel `#19283A` | 14.17:1 | 4.5:1 | PASS |
| Escuro | text.primary `#F9F9F7` | surface.subtle `#24354A` | 11.84:1 | 4.5:1 | PASS |
| Escuro | text.secondary `#B1BCC8` | surface.page `#101B29` | 9.00:1 | 4.5:1 | PASS |
| Escuro | text.secondary `#B1BCC8` | surface.panel `#19283A` | 7.75:1 | 4.5:1 | PASS |
| Escuro | text.secondary `#B1BCC8` | surface.subtle `#24354A` | 6.47:1 | 4.5:1 | PASS |
| Escuro | text.heading `#F9F9F7` | surface.page `#101B29` | 16.45:1 | 4.5:1 | PASS |
| Escuro | text.heading `#F9F9F7` | surface.panel `#19283A` | 14.17:1 | 4.5:1 | PASS |
| Escuro | text.heading `#F9F9F7` | surface.subtle `#24354A` | 11.84:1 | 4.5:1 | PASS |
| Escuro | link `#D8DDE4` | surface.page `#101B29` | 12.70:1 | 4.5:1 | PASS |
| Escuro | link `#D8DDE4` | surface.panel `#19283A` | 10.94:1 | 4.5:1 | PASS |
| Escuro | link `#D8DDE4` | surface.subtle `#24354A` | 9.14:1 | 4.5:1 | PASS |
| Escuro | finance.income `#B1C6B0` | surface.page `#101B29` | 9.56:1 | 4.5:1 | PASS |
| Escuro | finance.income `#B1C6B0` | surface.panel `#19283A` | 8.23:1 | 4.5:1 | PASS |
| Escuro | finance.income `#B1C6B0` | surface.subtle `#24354A` | 6.88:1 | 4.5:1 | PASS |
| Escuro | finance.expense `#D7B2B0` | surface.page `#101B29` | 8.99:1 | 4.5:1 | PASS |
| Escuro | finance.expense `#D7B2B0` | surface.panel `#19283A` | 7.74:1 | 4.5:1 | PASS |
| Escuro | finance.expense `#D7B2B0` | surface.subtle `#24354A` | 6.47:1 | 4.5:1 | PASS |
| Escuro | finance.investment `#B1BCC8` | surface.page `#101B29` | 9.00:1 | 4.5:1 | PASS |
| Escuro | finance.investment `#B1BCC8` | surface.panel `#19283A` | 7.75:1 | 4.5:1 | PASS |
| Escuro | finance.investment `#B1BCC8` | surface.subtle `#24354A` | 6.47:1 | 4.5:1 | PASS |
| Escuro | finance.pending `#F4CAA1` | surface.page `#101B29` | 11.41:1 | 4.5:1 | PASS |
| Escuro | finance.pending `#F4CAA1` | surface.panel `#19283A` | 9.82:1 | 4.5:1 | PASS |
| Escuro | finance.pending `#F4CAA1` | surface.subtle `#24354A` | 8.20:1 | 4.5:1 | PASS |
| Escuro | action.primary.fg `#001836` | action.primary.bg `#B1BCC8` | 9.20:1 | 4.5:1 | PASS |
| Escuro | action.accent.fg `#16365B` | action.accent.bg `#EA9543` | 5.18:1 | 4.5:1 | PASS |
| Escuro | status.success.fg `#C4D4C4` | status.success.bg `#345034` | 5.79:1 | 4.5:1 | PASS |
| Escuro | status.warning.fg `#F4CAA1` | status.warning.bg `#51341C` | 7.43:1 | 4.5:1 | PASS |
| Escuro | status.error.fg `#EBD8D7` | status.error.bg `#3F0000` | 12.66:1 | 4.5:1 | PASS |
| Escuro | status.info.fg `#D8DDE4` | status.info.bg `#0B2C50` | 10.32:1 | 4.5:1 | PASS |
| Escuro | border.control `#8B9BAD` | surface.page `#101B29` | 6.10:1 | 3.0:1 | PASS |
| Escuro | border.control `#8B9BAD` | surface.panel `#19283A` | 5.26:1 | 3.0:1 | PASS |
| Escuro | border.control `#8B9BAD` | surface.subtle `#24354A` | 4.39:1 | 3.0:1 | PASS |
| Escuro | focus.ring `#EA9543` | surface.page `#101B29` | 7.33:1 | 3.0:1 | PASS |
| Escuro | focus.ring `#EA9543` | surface.panel `#19283A` | 6.31:1 | 3.0:1 | PASS |
| Escuro | focus.ring `#EA9543` | surface.subtle `#24354A` | 5.27:1 | 3.0:1 | PASS |

Total: 72 pares; 0 abaixo do limiar. Resultados derivados dos candidatos deste relatório, não do produto em execução.
