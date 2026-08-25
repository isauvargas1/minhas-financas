module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,

    /*
     * Formatação é aviso; correção é erro.
     *
     * O `lint` existia e não estava em nenhum gate (dívida registrada na
     * auditoria de prontidão), de modo que o backend acumulou 2.351 violações
     * — **todas** de formatação: indentação, comprimento de linha, JSDoc e
     * espaçamento. Nenhuma de correção.
     *
     * Colocar o `lint` no gate exigindo formatação perfeita significaria
     * reformatar o domínio financeiro inteiro imediatamente antes do
     * congelamento de release: muito churn e nenhum ganho de correção. Manter
     * o `lint` fora do gate significaria continuar sem rede contra variável
     * não usada, import quebrado ou `case` sem `break`.
     *
     * A escolha é o meio termo honesto: as regras que apontam **defeito**
     * seguem como erro e bloqueiam o gate; as puramente estéticas viram aviso
     * e ficam visíveis para limpeza incremental.
     */
    "indent": ["warn", 2],
    "max-len": ["warn", {code: 80}],
    "valid-jsdoc": "off",
    "require-jsdoc": "off",
    "object-curly-spacing": ["warn", "never"],
    "eol-last": "warn",
    "operator-linebreak": "warn",
    "no-trailing-spaces": "warn",
    "camelcase": "warn",
    "new-cap": "warn",
    "@typescript-eslint/no-explicit-any": "warn",

    // Estas apontam defeito, não estilo.
    "curly": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {argsIgnorePattern: "^_", varsIgnorePattern: "^_"},
    ],
    "no-constant-condition": "error",
    "no-fallthrough": "error",
    "eqeqeq": ["error", "smart"],
  },
};
