# Evidência visual e de acessibilidade — gate final da P4 (2026-10-08)

Capturas das telas P4 e dos principais diálogos, com os mesmos dados semeados pelas callables reais (cartão com compra parcelada e à vista, recorrente, grupo de divisão com despesa, investimento com instituição, carteira e categoria do catálogo), no build E2E contra o Emulator (`minhas-financas-local`), workspace PJ, owner.

- **Telas:** Cartões Corporativos, Contratos & Recorrências, Rateios & Reembolsos, Investimentos e Configurações › Cadastros (Categorias › Despesas), em desktop (1440×900) e celular (390×844), claro e escuro.
- **Diálogos:** novo cartão, nova recorrência, novo rateio, novo investimento, novo cadastro e "Nova Transação" na aba Cartão (compra parcelada; categorias de despesa), em desktop claro e escuro e celular claro.
- **Medições:** rolagem horizontal, axe-core 4.13 (WCAG 2.0/2.1 A e AA) nas telas em desktop e nos diálogos em desktop claro, foco dentro do diálogo depois de abrir e de seis Tabs, Escape e erros de console.

Arquivos:

- `depois/` — 38 capturas da árvore do gate.
- `depois-relatorio.json` e `antes-relatorio.json` — medições da árvore do gate e da base (`0d97901`, árvore do checkpoint), com o mesmo roteiro.
- `diferencas-pixels.txt` — base × gate, por captura (limiar 48 por pixel). Só a área do cartão em Cartões (0,13%) e uma linha de texto em Investimentos (0,02%) diferem.
- `ruido-mesma-arvore.txt` — duas capturas da **mesma** árvore do gate: as mesmas áreas variam (até 0,11%). A diferença base × gate é ruído de renderização (antialiasing do texto e do brilho do cartão); visualmente nada mudou.

Resultados:

- Rolagem horizontal: 0 em todas as capturas.
- Console: só recursos externos bloqueados pelo proxy do ambiente (`ERR_TUNNEL_CONNECTION_FAILED`, `ERR_CERT_AUTHORITY_INVALID`); nenhum erro da aplicação.
- Base e gate têm medições idênticas (42 entradas: rolagem, axe, foco e Escape).
- Achados de acessibilidade, todos anteriores à P4 e iguais na base: contraste (telas e diálogos), botões sem nome acessível nos seletores de ícone e cor (novo cadastro, novo rateio, novo cartão), rótulos sem `htmlFor` e `<select>` sem nome (novo cartão, novo rateio, "Nova Transação"), setor do gráfico sem texto alternativo no painel e Escape que não fecha os diálogos de cartão, recorrência, rateio e cadastro. Registrados no plano mestre (§19.7) para a etapa de acessibilidade (LAUNCH_CHECKLIST 8.9, P9, ou etapa de UX autorizada).

Arquivo temporário de captura (fora da suíte): `e2e/p4gate-evidence.spec.ts`, executado e removido.
