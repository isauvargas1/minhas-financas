#!/usr/bin/env node
/**
 * Varredura de segredos no bundle público (P5-GATE-FINAL, E-00 / PR-AI-02).
 *
 * Roda no fim de `npm run build` e `npm run build:e2e`: tudo que fica em `dist/` é servido a qualquer visitante.
 * A chave do Gemini já chegou ao bundle uma vez (pelo `define` do Vite). Esta varredura impede que uma credencial
 * volte a ser publicada, venha de onde vier (`define`, variável `VITE_*`, texto no código, dependência):
 *
 * - objeto de ambiente do Vite embutido (`VITE_…:` como chave de objeto): acontece quando o cliente lê
 *   `import.meta.env` como objeto, e aí TODAS as variáveis `VITE_*` do ambiente de build vão para o bundle;
 * - chave de API do Google (`AIza` + 35 caracteres) fora da configuração web do Firebase (`apiKey:"…"`, pública
 *   por desenho: identifica o projeto; o acesso aos dados depende das Rules e do App Check, e a própria chave precisa
 *   de restrição de API e de referrer no console, senão ela autoriza toda API habilitada no projeto, inclusive a do
 *   Gemini: E-00/E-03), e mais de uma chave distinta;
 * - chave secreta ou restrita do Stripe, segredo de webhook do Stripe, chave privada PEM, conta de serviço do
 *   Google (`private_key`, `client_email` de `iam.gserviceaccount.com`), segredo de cliente OAuth do Google;
 * - os nomes das variáveis de chave de IA do backend (`GOOGLE_AI_API_KEY`, `GEMINI_API_KEY`).
 *
 * Lê **todo** arquivo regular da pasta, de qualquer extensão (o Hosting publica tudo que está em `dist/`), como
 * bytes (latin1: os padrões são ASCII). Nunca imprime o valor encontrado: só o arquivo, o tipo e um trecho
 * mascarado. Sai com 1 se achar algo, e com 2 se a pasta não existir ou estiver vazia (sem bundle não há o que
 * aprovar).
 *
 * É só linha de comando (nada importa este módulo) e roda sempre: a condição de "ponto de entrada" que havia aqui
 * comparava `import.meta.url` com `file://` + o caminho e era falsa com espaço ou acento no caminho, por link
 * simbólico e no Windows; aí o processo saía com 0 sem varrer nada (PLAT-09, P5-GATE-FINAL, 2ª revisão).
 *
 * Uso: `node tools/seguranca/varrer-bundle.mjs <pasta do build>`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RULES = [
  {
    kind: 'objeto de ambiente do Vite embutido (todas as variáveis VITE_* do build)',
    pattern: /["']?\bVITE_[A-Z0-9_]+["']?\s*:/g,
  },
  { kind: 'chave secreta do Stripe', pattern: /\bsk_(?:live|test)_[0-9A-Za-z]{10,}/g },
  { kind: 'chave restrita do Stripe', pattern: /\brk_(?:live|test)_[0-9A-Za-z]{10,}/g },
  { kind: 'segredo de webhook do Stripe', pattern: /\bwhsec_[0-9A-Za-z]{10,}/g },
  { kind: 'chave privada PEM', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { kind: 'conta de serviço do Google', pattern: /["']private_key["']\s*:|[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/g },
  { kind: 'segredo de cliente OAuth do Google', pattern: /\bGOCSPX-[0-9A-Za-z_-]{10,}/g },
  { kind: 'nome de variável da chave de IA do backend', pattern: /\b(?:GOOGLE_AI_API_KEY|GEMINI_API_KEY)\b/g },
];

const GOOGLE_KEY = /AIza[0-9A-Za-z_-]{35}/g;
/** A configuração web do Firebase no bundle minificado: `apiKey:"AIza…"` (ou com aspas na chave). */
const FIREBASE_WEB_KEY = /["']?apiKey["']?\s*:\s*["'](AIza[0-9A-Za-z_-]{35})["']/g;

const mask = (value) => `${value.slice(0, 4)}…(${value.length} caracteres)`;

const filesUnder = (root) => {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
};

/** Achados de um texto (sem o valor: só o tipo e um trecho mascarado). */
const scanText = (text) => {
  const findings = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) findings.push({ kind: rule.kind, sample: mask(match[0]) });
  }
  const allowed = new Set([...text.matchAll(FIREBASE_WEB_KEY)].map((match) => match.index + match[0].indexOf(match[1])));
  const keys = new Set();
  for (const match of text.matchAll(GOOGLE_KEY)) {
    keys.add(match[0]);
    if (!allowed.has(match.index)) {
      findings.push({ kind: 'chave de API do Google fora da configuração web do Firebase', sample: mask(match[0]) });
    }
  }
  return { findings, googleKeys: keys };
};

const scanDirectory = (root) => {
  let stats;
  try {
    stats = statSync(root);
  } catch {
    return { error: `pasta do build não encontrada: ${root}` };
  }
  if (!stats.isDirectory()) return { error: `não é uma pasta: ${root}` };
  const files = filesUnder(root);
  if (files.length === 0) return { error: `pasta do build sem arquivos: ${root}` };
  const findings = [];
  const googleKeys = new Set();
  for (const file of files) {
    const result = scanText(readFileSync(file).toString('latin1'));
    for (const finding of result.findings) findings.push({ file: relative(root, file), ...finding });
    for (const key of result.googleKeys) googleKeys.add(key);
  }
  if (googleKeys.size > 1) {
    findings.push({ file: '(bundle inteiro)', kind: `${googleKeys.size} chaves de API do Google distintas (o app usa só a da configuração web do Firebase)`, sample: '—' });
  }
  return { files: files.length, findings };
};

const main = () => {
  const root = process.argv[2];
  if (!root) {
    console.error('Uso: node tools/seguranca/varrer-bundle.mjs <pasta do build>');
    process.exit(2);
  }
  const result = scanDirectory(root);
  if (result.error) {
    console.error(`[varredura do bundle] ${result.error}`);
    process.exit(2);
  }
  if (result.findings.length > 0) {
    console.error(`[varredura do bundle] ${result.findings.length} possível(is) segredo(s) no bundle público; o build falha:`);
    for (const finding of result.findings) console.error(`  - ${finding.file}: ${finding.kind} [${finding.sample}]`);
    console.error('Tire o segredo do cliente: credencial de servidor fica nas Functions (Secret Manager), nunca em VITE_* nem em define.');
    process.exit(1);
  }
  console.log(`[varredura do bundle] ${result.files} arquivo(s) de ${root} sem segredo.`);
};

main();
