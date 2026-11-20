#!/usr/bin/env node
/**
 * Backup e restauração do Firestore da produção (P6-A, Frente D). Executado só pelo proprietário, com o login de
 * pessoa do gcloud; agentes não executam. Regras em `backup.mjs`; roteiro no RUNBOOKS.md, "Backup e restauração".
 *
 *   node tools/operacao/backup-firestore.mjs plano               --project <id>
 *   node tools/operacao/backup-firestore.mjs ativar              --project <id> --confirmar <id>
 *   node tools/operacao/backup-firestore.mjs conferir            --project <id>
 *   node tools/operacao/backup-firestore.mjs ensaiar-restauracao --project <id> --confirmar <id> --backup <nome> --destino restauracao-ensaio-AAAAMMDD
 *   node tools/operacao/backup-firestore.mjs remover-ensaio      --project <id> --confirmar <id> --destino restauracao-ensaio-AAAAMMDD
 *
 * `plano` só imprime os comandos. `conferir` só lê e sai 1 quando o backup está falhando (acompanhamento diário).
 * Saídas: 0 sucesso, 1 conferência reprovada ou gcloud falhou, 2 argumentos, 3 recusa das guardas.
 */
import {spawnSync} from 'node:child_process';
import {ErroArgumentos, lerArgumentos} from '../ambiente/argumentos.mjs';
import {carregarConfiguracao} from '../ambiente/contrato.mjs';
import {
  avaliarConferencia, avaliarGuardas, comandosDeAtivacao, comandosDeEnsaio, comandosDeLeitura, comandosDeRemocaoDoEnsaio,
  lerEstado,
} from './backup.mjs';

const SUBCOMANDOS = ['plano', 'ativar', 'conferir', 'ensaiar-restauracao', 'remover-ensaio'];
const sair = (mensagem, codigo) => {
  process.stderr.write(`\n[backup] ${mensagem}\n`);
  process.exit(codigo);
};

const [subcomando, ...resto] = process.argv.slice(2);
if (!SUBCOMANDOS.includes(subcomando)) sair(`informe o passo: ${SUBCOMANDOS.join(', ')}.`, 2);
let args;
try {
  args = lerArgumentos(resto, {
    valores: ['project', 'confirmar', 'backup', 'destino'],
    proibidas: {only: 'não se aplica', force: 'não se aplica', token: 'use o login de pessoa do gcloud'},
  });
} catch (erro) {
  if (erro instanceof ErroArgumentos) sair(erro.message, 2);
  throw erro;
}
const project = args.get('project');
const motivos = avaliarGuardas({cfg: carregarConfiguracao(), subcomando, project, confirmar: args.get('confirmar'), env: process.env});
if (motivos.length > 0) sair(`recusado; nada foi executado:\n${motivos.map((m) => `  - ${m}`).join('\n')}`, 3);

/** Texto pronto para colar no bash: valores com parênteses ou espaço vão entre aspas simples (`--database='(default)'`). */
const citar = (argumento) => {
  if (/^[A-Za-z0-9_\-=.,/:@]+$/.test(argumento)) return argumento;
  const opcao = /^(--[a-z-]+=)(.*)$/.exec(argumento);
  const aspas = (valor) => `'${valor.replace(/'/g, "'\\''")}'`;
  return opcao ? `${opcao[1]}${aspas(opcao[2])}` : aspas(argumento);
};
const texto = ([comando, argumentos]) => `${comando} ${argumentos.map(citar).join(' ')}`;
const executarJson = ([comando, argumentos]) => {
  const r = spawnSync(comando, argumentos, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
  if (r.status !== 0) sair(`o gcloud falhou em: ${texto([comando, argumentos])}`, 1);
  try {
    return JSON.parse(r.stdout || 'null');
  } catch {
    sair(`saída inesperada do gcloud em: ${texto([comando, argumentos])}`, 1);
  }
  return null;
};
const lerTudo = () => {
  const leitura = comandosDeLeitura(project);
  return lerEstado({banco: executarJson(leitura.banco), agendamentos: executarJson(leitura.agendamentos)});
};

if (subcomando === 'plano') {
  const leitura = comandosDeLeitura(project, '<localizacao>');
  const ativacao = comandosDeAtivacao(project, {pitr: false, diario: null, semanal: null});
  console.log([...Object.values(leitura), ...ativacao].map(texto).join('\n'));
  process.exit(0);
}

if (subcomando === 'ativar') {
  const estado = lerTudo();
  const comandos = comandosDeAtivacao(project, estado);
  if (comandos.length === 0) console.log('[backup] PITR e agendamentos já estavam ativos: nada a alterar.');
  for (const comando of comandos) {
    console.log(`[backup] ${texto(comando)}`);
    executarJson(comando);
  }
  console.log('[backup] ativação concluída. Rode `conferir` amanhã: o primeiro backup aparece depois da primeira execução.');
  process.exit(0);
}

if (subcomando === 'conferir') {
  const estado = lerTudo();
  const backups = estado.localizacao ? executarJson(comandosDeLeitura(project, estado.localizacao).backups) : [];
  const resultado = avaliarConferencia({estado, backups, projectId: project, agora: new Date()});
  console.log(JSON.stringify(resultado.resumo, null, 2));
  if (!resultado.ok) sair(`conferência reprovada:\n${resultado.motivos.map((m) => `  - ${m}`).join('\n')}`, 1);
  console.log('[backup] conferência aprovada.');
  process.exit(0);
}

const plano = subcomando === 'ensaiar-restauracao'
  ? comandosDeEnsaio({projectId: project, backup: args.get('backup'), destino: args.get('destino')})
  : comandosDeRemocaoDoEnsaio({projectId: project, destino: args.get('destino')});
if (plano.motivos.length > 0) sair(`recusado; nada foi executado:\n${plano.motivos.map((m) => `  - ${m}`).join('\n')}`, 3);
for (const comando of plano.comandos) {
  console.log(`[backup] ${texto(comando)}`);
  executarJson(comando);
}
console.log(subcomando === 'ensaiar-restauracao'
  ? '[backup] restauração iniciada num banco novo; o (default) não foi tocado. Siga o RUNBOOKS.md para conferir e remover o ensaio.'
  : '[backup] banco de ensaio removido.');
