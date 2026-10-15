# Evidência visual — P5-A, isolamento do histórico do chat de IA (2026-10-08)

Capturas de Relatórios › IA Financeira no build E2E contra o Emulator (`minhas-financas-local`), com a mesma conta e o mesmo roteiro na base (`f0c172b`, checkpoint da P4) e na árvore da P5-A. A resposta da IA é simulada no limite de rede da callable `analyzeFinancialQuestion` (texto fixo); o provedor não é chamado.

- **Telas:** chat vazio no PF, PF com uma pergunta e a resposta, PJ logo depois da troca de workspace e PF de volta — em desktop (1440×900) claro e escuro. No celular (390×844), claro e escuro, o chat vazio e com conversa: o menu da conta, que troca o workspace pelo cabeçalho, não aparece nessa largura (`hidden sm:flex`, comportamento anterior à P5-A).
- **Comparação:** `diferencas-pixels.txt` — base × P5-A, por captura (limiar 48 por pixel): **0 pixel diferente nas 12 capturas**.
- **Medições:** `antes-relatorio.json` e `depois-relatorio.json` — rolagem horizontal 0 em todas as capturas, idênticas nas duas árvores.

Arquivos:

- `depois/` — 12 capturas da árvore da P5-A (as da base são idênticas e não foram versionadas em duplicata).

Vazamento transitório: o E2E `e2e/ai-chat-isolation.spec.ts` instala um `MutationObserver` antes do app e registra todo quadro em que o chat de um contexto (PF, PJ, outra conta) contenha texto de outro — inclusive nós que saem da tela por animação. Ao fim do roteiro (PF → PJ → PF, recarga, resposta atrasada que chega com o PJ aberto, limpeza, logout e login de outra conta na mesma página), a lista de vazamentos é vazia.

Arquivo temporário de captura (fora da suíte): `p5a-evidence.spec.ts`, executado e removido.
