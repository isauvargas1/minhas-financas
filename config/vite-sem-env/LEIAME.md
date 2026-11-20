# Pasta de ambiente do Vite, vazia por desenho

O `vite.config.ts` aponta o `envDir` para esta pasta (P6-A, PR-PLAT-01). Ela existe para que o Vite **não** carregue os
arquivos `.env*` da estação, como um `.env.local` com a configuração do projeto real.

Quem define a configuração web do Firebase é o perfil de build, lido de `config/ambientes.json` por
`tools/ambiente/contrato.mjs`.

Não crie arquivos `.env*` aqui: o build recusa a pasta se encontrar algum.
