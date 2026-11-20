/**
 * Backup e restauração do Firestore da produção única (P6-A, Frente D; PR-DR-01). Funções puras: os comandos do
 * gcloud que cada passo executa, a avaliação do estado lido e as guardas. A linha de comando é `backup-firestore.mjs`.
 *
 * Desenho (FIREBASE_PRODUCTION.md §14 e RUNBOOKS.md "Backup e restauração"):
 * - PITR ligado no banco `(default)`: janela de 7 dias, recuperação por minuto (custo de armazenamento, cobrado à parte);
 * - agendamento diário com retenção de 7 dias e semanal (domingo) com retenção de 14 semanas, o máximo do produto;
 * - conferência só de leitura (`conferir`): PITR ligado, os dois agendamentos com a retenção esperada e um backup
 *   `READY` com no máximo 36 horas. É o acompanhamento de falhas: sai com código diferente de zero se algo falta;
 * - restauração SEMPRE num banco novo do mesmo projeto, com nome `restauracao-ensaio-AAAAMMDD`. O `(default)` nunca é
 *   destino, e só um banco de ensaio pode ser removido.
 *
 * Nada aqui lê dados de negócio, credenciais ou valores de segredo.
 */

export const BANCO = '(default)';
export const RETENCAO_DIARIA = '7d';
export const RETENCAO_SEMANAL = '14w';
export const RETENCAO_DIARIA_SEGUNDOS = 7 * 24 * 3600;
export const RETENCAO_SEMANAL_SEGUNDOS = 14 * 7 * 24 * 3600;
export const IDADE_MAXIMA_DO_ULTIMO_BACKUP_HORAS = 36;
export const DESTINO_DE_ENSAIO = /^restauracao-ensaio-\d{8}$/;
const NOME_DO_BACKUP = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/backups\/[A-Za-z0-9_-]+$/;

const gcloud = (projectId, ...argumentos) => ['gcloud', [...argumentos, `--project=${projectId}`, '--format=json', '--quiet']];

/** Leituras usadas pela ativação (idempotente) e pela conferência. */
export const comandosDeLeitura = (projectId, localizacao = null) => ({
  banco: gcloud(projectId, 'firestore', 'databases', 'describe', `--database=${BANCO}`),
  agendamentos: gcloud(projectId, 'firestore', 'backups', 'schedules', 'list', `--database=${BANCO}`),
  backups: localizacao ? gcloud(projectId, 'firestore', 'backups', 'list', `--location=${localizacao}`) : null,
});

/** Escritas da ativação, só as que faltam (o estado lido decide). */
export const comandosDeAtivacao = (projectId, estado) => {
  const comandos = [];
  if (!estado.pitr) comandos.push(gcloud(projectId, 'firestore', 'databases', 'update', `--database=${BANCO}`, '--enable-pitr'));
  if (!estado.diario) {
    comandos.push(gcloud(projectId, 'firestore', 'backups', 'schedules', 'create', `--database=${BANCO}`,
      '--recurrence=daily', `--retention=${RETENCAO_DIARIA}`));
  }
  if (!estado.semanal) {
    comandos.push(gcloud(projectId, 'firestore', 'backups', 'schedules', 'create', `--database=${BANCO}`,
      '--recurrence=weekly', '--day-of-week=SUN', `--retention=${RETENCAO_SEMANAL}`));
  }
  return comandos;
};

const segundos = (duracao) => {
  const casou = /^(\d+)s$/.exec(String(duracao ?? ''));
  return casou ? Number(casou[1]) : null;
};

/** Interpreta a saída JSON do gcloud. Campos desconhecidos são ignorados; ausência é falha, nunca sucesso. */
export const lerEstado = ({banco, agendamentos}) => {
  const lista = Array.isArray(agendamentos) ? agendamentos : [];
  const diario = lista.find((a) => a && typeof a === 'object' && 'dailyRecurrence' in a) ?? null;
  const semanal = lista.find((a) => a && typeof a === 'object' && 'weeklyRecurrence' in a) ?? null;
  return {
    localizacao: typeof banco?.locationId === 'string' ? banco.locationId : null,
    pitr: banco?.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED',
    diario: diario ? {retencao: segundos(diario.retention)} : null,
    semanal: semanal ? {retencao: segundos(semanal.retention), dia: semanal.weeklyRecurrence?.day ?? null} : null,
  };
};

/**
 * Conferência (acompanhamento de falhas). `backups`: saída de `gcloud firestore backups list`. `agora`: Date.
 * Devolve `{ok, motivos, resumo}`; o resumo só tem estados, datas e contagens.
 */
export const avaliarConferencia = ({estado, backups, projectId, agora}) => {
  const motivos = [];
  if (!estado.localizacao) motivos.push('o banco (default) não foi encontrado ou não informou a localização.');
  if (!estado.pitr) motivos.push('PITR desligado no banco (default).');
  if (!estado.diario) motivos.push('agendamento diário de backup ausente.');
  else if (estado.diario.retencao !== RETENCAO_DIARIA_SEGUNDOS) motivos.push('agendamento diário com retenção diferente de 7 dias.');
  if (!estado.semanal) motivos.push('agendamento semanal de backup ausente.');
  else if (estado.semanal.retencao !== RETENCAO_SEMANAL_SEGUNDOS) motivos.push('agendamento semanal com retenção diferente de 14 semanas.');
  const doBanco = (Array.isArray(backups) ? backups : []).filter((b) => b?.database === `projects/${projectId}/databases/${BANCO}`);
  const prontos = doBanco.filter((b) => b.state === 'READY' && !Number.isNaN(Date.parse(b.snapshotTime ?? '')));
  const ultimo = prontos.map((b) => Date.parse(b.snapshotTime)).sort((a, b) => b - a)[0] ?? null;
  const idadeHoras = ultimo === null ? null : (agora.getTime() - ultimo) / 3_600_000;
  if (ultimo === null) motivos.push('nenhum backup READY do banco (default).');
  else if (idadeHoras > IDADE_MAXIMA_DO_ULTIMO_BACKUP_HORAS) {
    motivos.push(`o último backup READY tem ${Math.floor(idadeHoras)} h (limite ${IDADE_MAXIMA_DO_ULTIMO_BACKUP_HORAS} h): o agendamento está falhando.`);
  }
  const falhos = doBanco.filter((b) => b.state && !['READY', 'CREATING'].includes(b.state)).length;
  if (falhos > 0) motivos.push(`${falhos} backup(s) em estado de falha ou indisponível.`);
  return {
    ok: motivos.length === 0,
    motivos,
    resumo: {
      localizacao: estado.localizacao,
      pitr: estado.pitr,
      agendamentoDiario: Boolean(estado.diario),
      agendamentoSemanal: Boolean(estado.semanal),
      backupsProntos: prontos.length,
      ultimoBackup: ultimo === null ? null : new Date(ultimo).toISOString(),
    },
  };
};

/** Restauração de ensaio: sempre num banco novo, nunca no (default). */
export const comandosDeEnsaio = ({projectId, backup, destino}) => {
  const motivos = [];
  if (!NOME_DO_BACKUP.test(backup ?? '') || !backup.startsWith(`projects/${projectId}/`)) {
    motivos.push('--backup precisa ser o nome completo de um backup deste projeto (projects/<id>/locations/<local>/backups/<id>).');
  }
  if (!DESTINO_DE_ENSAIO.test(destino ?? '')) {
    motivos.push('--destino precisa ser restauracao-ensaio-AAAAMMDD: a restauração nunca escreve no (default) nem em outro banco.');
  }
  if (motivos.length > 0) return {motivos, comandos: []};
  return {
    motivos,
    comandos: [gcloud(projectId, 'firestore', 'databases', 'restore', `--source-backup=${backup}`, `--destination-database=${destino}`)],
  };
};

/** Remoção do banco de ensaio (cópia, não histórico): só nomes de ensaio. */
export const comandosDeRemocaoDoEnsaio = ({projectId, destino}) => {
  if (!DESTINO_DE_ENSAIO.test(destino ?? '')) {
    return {motivos: ['só um banco restauracao-ensaio-AAAAMMDD pode ser removido por esta ferramenta.'], comandos: []};
  }
  return {motivos: [], comandos: [gcloud(projectId, 'firestore', 'databases', 'delete', `--database=${destino}`)]};
};

/** Guardas comuns: projeto de produção do contrato, confirmação nas escritas, ambiente sem conflito. */
export const avaliarGuardas = ({cfg, subcomando, project, confirmar, env}) => {
  const motivos = [];
  const producao = cfg?.producao?.projectId;
  if (!project) motivos.push('--project ausente: informe o Project ID por extenso.');
  else if (project !== producao) motivos.push('o projeto informado não é o projeto de produção do contrato (o Emulator não tem backup gerenciado).');
  const escreve = ['ativar', 'ensaiar-restauracao', 'remover-ensaio'].includes(subcomando);
  if (escreve && confirmar !== project) motivos.push('--confirmar precisa repetir exatamente o Project ID (passo que altera a produção).');
  if (!escreve && confirmar !== undefined) motivos.push('--confirmar só se aplica a passos que alteram a produção.');
  for (const nome of ['CLOUDSDK_CORE_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[nome] !== undefined && env[nome] !== project) motivos.push(`${nome} no ambiente aponta para outro projeto (conflito de ambiente).`);
  }
  const emuladores = Object.keys(env).filter((nome) => nome.endsWith('_EMULATOR_HOST'));
  if (emuladores.length > 0) motivos.push(`variáveis de Emulator no ambiente (${emuladores.join(', ')}): nunca misturar Emulator e produção.`);
  return motivos;
};
