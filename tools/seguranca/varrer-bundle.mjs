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
 * P6-A (PR-AUTH-04, PR-PLAT-01): também confere o perfil do build pelo marcador `fenix-build.json` que o Vite grava na
 * raiz (`vite.config.ts`):
 * - fora dos perfis de Emulator (`verificacao`, `release` ou sem marcador), reprova qualquer vestígio de teste: o
 *   marcador dos módulos de Emulator e de login E2E, o botão e os parâmetros do login E2E, o domínio das contas de teste,
 *   o projeto do Emulator e a chave fictícia do E2E;
 * - `--perfil <p>` exige o marcador desse perfil;
 * - `--publicacao` exige um build de release da produção (`publicavel: true`), nunca E2E, Emulator ou verificação. É o
 *   modo do predeploy do Hosting.
 * Continua sem importar nada do repositório: roda de qualquer caminho (PLAT-09).
 *
 * Uso: `node tools/seguranca/varrer-bundle.mjs <pasta do build> [--perfil <perfil>] [--publicacao]`
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/** Vestígios de teste que só podem existir num build de Emulator (perfis `local` e `e2e`). */
const TEST_MARKERS = [
  { kind: 'módulo de conexão com o Emulator', pattern: /fenixgran:conexao-emuladores/g },
  { kind: 'módulo de login E2E', pattern: /fenixgran:login-e2e/g },
  { kind: 'botão ou parâmetro do login E2E', pattern: /e2e-login-button|e2ePassword|e2eEmail/g },
  { kind: 'domínio das contas de teste', pattern: /@minhas-financas\.local/g },
  { kind: 'projeto do Emulator', pattern: /minhas-financas-local/g },
  { kind: 'chave fictícia do E2E', pattern: /e2e-api-key/g },
];
const EMULATOR_PROFILES = new Set(['local', 'e2e']);
const BUILD_MARKER = 'fenix-build.json';

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

const readMarker = (root) => {
  const path = join(root, BUILD_MARKER);
  if (!existsSync(path)) return { marker: null };
  try {
    return { marker: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { error: `${BUILD_MARKER} ilegível` };
  }
};

/** Vestígios de teste de um texto (só o tipo e um trecho mascarado). */
const scanTestMarkers = (text) => {
  const findings = [];
  for (const rule of TEST_MARKERS) {
    for (const match of text.matchAll(rule.pattern)) findings.push({ kind: `vestígio de teste fora do Emulator: ${rule.kind}`, sample: mask(match[0]) });
  }
  return findings;
};

const scanDirectory = (root, { allowTestMarkers = false } = {}) => {
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
    const text = readFileSync(file).toString('latin1');
    const result = scanText(text);
    for (const finding of result.findings) findings.push({ file: relative(root, file), ...finding });
    if (!allowTestMarkers && relative(root, file) !== BUILD_MARKER) {
      for (const finding of scanTestMarkers(text)) findings.push({ file: relative(root, file), ...finding });
    }
    for (const key of result.googleKeys) googleKeys.add(key);
  }
  if (googleKeys.size > 1) {
    findings.push({ file: '(bundle inteiro)', kind: `${googleKeys.size} chaves de API do Google distintas (o app usa só a da configuração web do Firebase)`, sample: '—' });
  }
  return { files: files.length, findings };
};

const parseArgs = (argv) => {
  const [root, ...rest] = argv;
  const options = { root, profile: null, publication: false, error: null };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--perfil' && options.profile === null && rest[i + 1] && !rest[i + 1].startsWith('--')) {
      options.profile = rest[i + 1];
      i += 1;
    } else if (rest[i] === '--publicacao' && !options.publication) {
      options.publication = true;
    } else {
      options.error = `argumento não aceito: ${rest[i]}`;
    }
  }
  return options;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options.root || options.root.startsWith('--') || options.error) {
    console.error(`Uso: node tools/seguranca/varrer-bundle.mjs <pasta do build> [--perfil <perfil>] [--publicacao]${options.error ? ` (${options.error})` : ''}`);
    process.exit(2);
  }
  const root = options.root;
  const { marker, error: markerError } = existsSync(root) ? readMarker(root) : { marker: null };
  if (markerError) {
    console.error(`[varredura do bundle] ${markerError}`);
    process.exit(2);
  }
  const profileFindings = [];
  if ((options.profile || options.publication) && !marker) {
    profileFindings.push({ file: BUILD_MARKER, kind: 'build sem marcador de perfil (o build oficial passa por tools/ambiente/construir.mjs)', sample: '—' });
  }
  if (marker && options.profile && marker.perfil !== options.profile) {
    profileFindings.push({ file: BUILD_MARKER, kind: `perfil do build diferente do esperado (${marker.perfil} × ${options.profile})`, sample: '—' });
  }
  const emulatorBuild = Boolean(marker && EMULATOR_PROFILES.has(marker.perfil));
  if (marker && !emulatorBuild && (marker.emuladores || marker.loginE2E)) {
    profileFindings.push({ file: BUILD_MARKER, kind: 'build sem Emulator marcado com Emulator ou login E2E', sample: '—' });
  }
  if (options.publication && marker && !(marker.perfil === 'release' && marker.publicavel === true && marker.ambiente === 'prod' &&
      marker.emuladores === false && marker.loginE2E === false)) {
    profileFindings.push({ file: BUILD_MARKER, kind: `build do perfil ${marker.perfil} não é publicável (só o release da produção)`, sample: '—' });
  }
  const result = scanDirectory(root, { allowTestMarkers: emulatorBuild && !options.publication });
  if (result.error) {
    console.error(`[varredura do bundle] ${result.error}`);
    process.exit(2);
  }
  const findings = [...profileFindings, ...result.findings];
  if (findings.length > 0) {
    console.error(`[varredura do bundle] ${findings.length} problema(s) no bundle público; o build falha:`);
    for (const finding of findings) console.error(`  - ${finding.file}: ${finding.kind} [${finding.sample}]`);
    console.error('Tire o segredo do cliente: credencial de servidor fica nas Functions (Secret Manager), nunca em VITE_* nem em define. Vestígio de teste só existe no build de Emulator (dist-e2e).');
    process.exit(1);
  }
  console.log(`[varredura do bundle] ${result.files} arquivo(s) de ${root} sem segredo${marker ? ` (perfil ${marker.perfil})` : ''}.`);
};

main();
