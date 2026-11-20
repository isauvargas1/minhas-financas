import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {carregarConfiguracao} from '../../tools/ambiente/contrato.mjs';
import {criarRaizTemporaria} from './support/raiz-temporaria.mjs';
import {
  BANCO, avaliarConferencia, avaliarGuardas, comandosDeAtivacao, comandosDeEnsaio, comandosDeRemocaoDoEnsaio, lerEstado,
} from '../../tools/operacao/backup.mjs';

/**
 * P6-A, Frente D: backup e restauração do Firestore da produção. Funções puras e a CLI com um `gcloud` falso no PATH
 * (marca e sai 99), para provar que nenhuma recusa chega ao gcloud. Nada aqui fala com o Google Cloud.
 */
const cfg = carregarConfiguracao();
const PRODUCAO = cfg.producao.projectId;
const AGORA = new Date('2026-11-17T12:00:00Z');
const BANCO_COMPLETO = `projects/${PRODUCAO}/databases/${BANCO}`;
const backup = (horasAtras, state = 'READY') => ({
  name: `projects/${PRODUCAO}/locations/southamerica-east1/backups/b${horasAtras}`,
  database: BANCO_COMPLETO,
  snapshotTime: new Date(AGORA.getTime() - horasAtras * 3_600_000).toISOString(),
  state,
});
const estadoOk = lerEstado({
  banco: {locationId: 'southamerica-east1', pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED'},
  agendamentos: [{dailyRecurrence: {}, retention: '604800s'}, {weeklyRecurrence: {day: 'SUNDAY'}, retention: '8467200s'}],
});

test('ativação: só os comandos que faltam, sempre com --project explícito e no banco (default)', () => {
  const tudo = comandosDeAtivacao(PRODUCAO, {pitr: false, diario: null, semanal: null}).map(([c, a]) => `${c} ${a.join(' ')}`);
  assert.equal(tudo.length, 3);
  assert.match(tudo[0], /^gcloud firestore databases update --database=\(default\) --enable-pitr --project=/);
  assert.match(tudo[1], /schedules create --database=\(default\) --recurrence=daily --retention=7d/);
  assert.match(tudo[2], /schedules create --database=\(default\) --recurrence=weekly --day-of-week=SUN --retention=14w/);
  for (const linha of tudo) assert.ok(linha.includes(`--project=${PRODUCAO}`) && linha.endsWith('--format=json --quiet'), linha);
  assert.deepEqual(comandosDeAtivacao(PRODUCAO, estadoOk), [], 'idempotente: nada a fazer quando tudo existe');
});

test('conferência: aprova com PITR, os dois agendamentos e backup READY recente', () => {
  const r = avaliarConferencia({estado: estadoOk, backups: [backup(30), backup(6)], projectId: PRODUCAO, agora: AGORA});
  assert.equal(r.ok, true, r.motivos.join(' | '));
  assert.equal(r.resumo.backupsProntos, 2);
  assert.equal(r.resumo.ultimoBackup, backup(6).snapshotTime);
});

test('conferência: reprova PITR desligado, agendamento ausente ou com retenção errada', () => {
  const casos = [
    [{...estadoOk, pitr: false}, /PITR desligado/],
    [{...estadoOk, diario: null}, /diário de backup ausente/],
    [{...estadoOk, semanal: null}, /semanal de backup ausente/],
    [{...estadoOk, diario: {retencao: 3600}}, /diário com retenção diferente/],
    [{...estadoOk, semanal: {retencao: 604800, dia: 'SUNDAY'}}, /semanal com retenção diferente/],
    [{...estadoOk, localizacao: null}, /localização/],
  ];
  for (const [estado, motivo] of casos) {
    const r = avaliarConferencia({estado, backups: [backup(2)], projectId: PRODUCAO, agora: AGORA});
    assert.equal(r.ok, false);
    assert.ok(r.motivos.some((m) => motivo.test(m)), `${motivo}: ${r.motivos.join(' | ')}`);
  }
});

test('conferência (acompanhamento de falhas): sem backup, backup velho, backup falho ou de outro banco reprovam', () => {
  const reprova = (backups, motivo) => {
    const r = avaliarConferencia({estado: estadoOk, backups, projectId: PRODUCAO, agora: AGORA});
    assert.equal(r.ok, false);
    assert.ok(r.motivos.some((m) => motivo.test(m)), `${motivo}: ${r.motivos.join(' | ')}`);
  };
  reprova([], /nenhum backup READY/);
  reprova([backup(37)], /tem 37 h \(limite 36 h\)/);
  reprova([backup(2, 'CREATING')], /nenhum backup READY/);
  reprova([backup(2), backup(1, 'NOT_AVAILABLE')], /estado de falha/);
  reprova([{...backup(2), database: `projects/${PRODUCAO}/databases/restauracao-ensaio-20261117`}], /nenhum backup READY/);
  reprova(null, /nenhum backup READY/);
});

test('restauração de ensaio: só em banco novo restauracao-ensaio-AAAAMMDD, nunca no (default)', () => {
  const nome = `projects/${PRODUCAO}/locations/southamerica-east1/backups/abc-123`;
  const ok = comandosDeEnsaio({projectId: PRODUCAO, backup: nome, destino: 'restauracao-ensaio-20261117'});
  assert.deepEqual(ok.motivos, []);
  const linha = `${ok.comandos[0][0]} ${ok.comandos[0][1].join(' ')}`;
  assert.match(linha, /^gcloud firestore databases restore --source-backup=projects\/.+ --destination-database=restauracao-ensaio-20261117 --project=/);
  for (const destino of ['(default)', 'default', 'restauracao-ensaio-2026', 'producao', '', undefined]) {
    assert.ok(comandosDeEnsaio({projectId: PRODUCAO, backup: nome, destino}).motivos.some((m) => /--destino/.test(m)), String(destino));
  }
  for (const outro of ['projects/outro-projeto-123/locations/x/backups/y', 'b1', '']) {
    assert.ok(comandosDeEnsaio({projectId: PRODUCAO, backup: outro, destino: 'restauracao-ensaio-20261117'}).motivos.length > 0, outro);
  }
});

test('remoção: só o banco de ensaio, nunca o (default)', () => {
  assert.equal(comandosDeRemocaoDoEnsaio({projectId: PRODUCAO, destino: 'restauracao-ensaio-20261117'}).comandos.length, 1);
  for (const destino of ['(default)', 'qualquer', undefined]) {
    const r = comandosDeRemocaoDoEnsaio({projectId: PRODUCAO, destino});
    assert.equal(r.comandos.length, 0);
    assert.ok(r.motivos.length > 0);
  }
});

test('guardas: projeto da produção, confirmação nas escritas, ambiente sem conflito nem Emulator', () => {
  const base = {cfg, project: PRODUCAO, env: {}};
  assert.deepEqual(avaliarGuardas({...base, subcomando: 'conferir'}), []);
  assert.deepEqual(avaliarGuardas({...base, subcomando: 'ativar', confirmar: PRODUCAO}), []);
  assert.ok(avaliarGuardas({...base, subcomando: 'ativar'}).some((m) => /--confirmar/.test(m)));
  assert.ok(avaliarGuardas({...base, subcomando: 'ensaiar-restauracao', confirmar: 'outro'}).some((m) => /--confirmar/.test(m)));
  assert.ok(avaliarGuardas({...base, subcomando: 'conferir', confirmar: PRODUCAO}).some((m) => /só se aplica/.test(m)));
  assert.ok(avaliarGuardas({...base, subcomando: 'conferir', project: 'minhas-financas-local'}).some((m) => /não é o projeto de produção/.test(m)));
  assert.ok(avaliarGuardas({...base, subcomando: 'conferir', project: undefined}).some((m) => /--project ausente/.test(m)));
  assert.ok(avaliarGuardas({...base, subcomando: 'conferir', env: {CLOUDSDK_CORE_PROJECT: 'outro'}}).some((m) => /CLOUDSDK_CORE_PROJECT/.test(m)));
  assert.ok(avaliarGuardas({...base, subcomando: 'conferir', env: {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}}).some((m) => /Emulator/.test(m)));
});

// CLI com gcloud falso, numa cópia da raiz cujo projeto de produção é FICTÍCIO: mesmo que o gcloud real fosse achado
// (diretório temporário montado como noexec, por exemplo), ele só falaria com um projeto inexistente (PLT-3).
const FICTICIO = 'fenix-ficticio-nao-existe';
const copia = criarRaizTemporaria({ajustarContrato: (contrato) => { contrato.producao.projectId = FICTICIO; }});
test.after(() => copia.remover());
const pasta = mkdtempSync(join(tmpdir(), 'backup-cli-'));
const marca = join(pasta, 'gcloud-chamado');
writeFileSync(join(pasta, 'gcloud'), `#!/bin/sh\necho "$@" > "${marca}"\nexit 99\n`);
chmodSync(join(pasta, 'gcloud'), 0o755);
test.after(() => rmSync(pasta, {recursive: true, force: true}));
const CLI = join(copia.raiz, 'tools', 'operacao', 'backup-firestore.mjs');
const rodar = (argumentos, extra = {}) => {
  rmSync(marca, {force: true});
  const r = spawnSync(process.execPath, [CLI, ...argumentos], {
    encoding: 'utf8', env: {PATH: `${pasta}${delimiter}${process.env.PATH}`, HOME: process.env.HOME ?? '', ...extra},
  });
  return {code: r.status, out: r.stdout, err: r.stderr, gcloud: existsSync(marca)};
};

test('CLI: recusas saem 2 ou 3 sem chamar o gcloud', () => {
  const casos = [
    [[], 2],
    [['apagar', '--project', FICTICIO], 2],
    [['ativar', '--project', FICTICIO], 3],
    [['ativar', '--project', FICTICIO, '--confirmar', 'outro'], 3],
    [['conferir', '--project', 'minhas-financas-local'], 3],
    [['conferir', '--project', FICTICIO, '--force'], 2],
    [['ensaiar-restauracao', '--project', FICTICIO, '--confirmar', FICTICIO, '--backup', 'x', '--destino', '(default)'], 3],
    [['remover-ensaio', '--project', FICTICIO, '--confirmar', FICTICIO, '--destino', '(default)'], 3],
  ];
  for (const [argumentos, codigo] of casos) {
    const r = rodar(argumentos);
    assert.equal(r.code, codigo, `${argumentos.join(' ')}: ${r.err}`);
    assert.equal(r.gcloud, false, `${argumentos.join(' ')}: o gcloud não pode ser chamado`);
  }
  const conflito = rodar(['conferir', '--project', FICTICIO], {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'});
  assert.equal(conflito.code, 3);
  assert.equal(conflito.gcloud, false);
});

test('CLI: plano só imprime os comandos, sem chamar o gcloud', () => {
  const r = rodar(['plano', '--project', FICTICIO]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.gcloud, false);
  assert.match(r.out, /gcloud firestore databases update --database='\(default\)' --enable-pitr/, 'pronto para colar no bash');
  assert.match(r.out, /--recurrence=weekly --day-of-week=SUN --retention=14w/);
});

test('CLI: conferir chega ao gcloud (o falso sai 99) e a falha vira saída 1, sem aprovar', () => {
  const r = rodar(['conferir', '--project', FICTICIO]);
  assert.equal(r.gcloud, true);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.out, /aprovada/);
});
