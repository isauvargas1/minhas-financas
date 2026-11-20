/**
 * Leitura estrita de argumentos das ferramentas de ambiente e de publicação (P6-A).
 *
 * Aceita só `--nome valor` e `--nome=valor` para as opções com valor, e `--nome` para as booleanas. Recusa opção
 * desconhecida, repetida, sem valor ou com valor vazio, e argumento posicional. Nada é inferido: uma opção a mais nunca
 * sobrepõe a decisão do guard, porque ela é recusada antes.
 */
export class ErroArgumentos extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroArgumentos';
  }
}

/**
 * @param {string[]} argv argumentos (sem `node` e o script)
 * @param {{valores?: string[], booleanas?: string[], proibidas?: Record<string, string>}} especificacao
 */
export const lerArgumentos = (argv, {valores = [], booleanas = [], proibidas = {}} = {}) => {
  const resultado = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const bruto = argv[i];
    if (bruto === '-P' || /^-[A-Za-z]/.test(bruto) && !bruto.startsWith('--')) {
      throw new ErroArgumentos(`opção curta não aceita: ${bruto}`);
    }
    if (!bruto.startsWith('--') || bruto === '--') throw new ErroArgumentos(`argumento posicional não aceito: ${bruto}`);
    const corpo = bruto.slice(2);
    const igual = corpo.indexOf('=');
    const nome = igual === -1 ? corpo : corpo.slice(0, igual);
    if (Object.hasOwn(proibidas, nome)) throw new ErroArgumentos(`--${nome} não é aceito: ${proibidas[nome]}`);
    if (resultado.has(nome)) throw new ErroArgumentos(`--${nome} repetido (cada opção só pode aparecer uma vez)`);
    if (booleanas.includes(nome)) {
      if (igual !== -1) throw new ErroArgumentos(`--${nome} não aceita valor`);
      resultado.set(nome, true);
      continue;
    }
    if (!valores.includes(nome)) throw new ErroArgumentos(`opção desconhecida: --${nome}`);
    let valor = igual === -1 ? argv[i + 1] : corpo.slice(igual + 1);
    if (igual === -1) i += 1;
    if (valor === undefined || valor === '' || valor.startsWith('--')) {
      throw new ErroArgumentos(`--${nome} exige um valor`);
    }
    if (/\s/.test(valor)) throw new ErroArgumentos(`--${nome} não aceita espaço no valor`);
    resultado.set(nome, valor);
  }
  return resultado;
};

/** Opções que nenhuma ferramenta aceita: escolher o projeto é do contrato, nunca da linha de comando. */
export const OPCOES_DE_PROJETO_PROIBIDAS = Object.freeze({
  project: 'o projeto vem do contrato de ambientes (config/ambientes.json), nunca da linha de comando',
  projeto: 'o projeto vem do contrato de ambientes (config/ambientes.json), nunca da linha de comando',
  only: 'os alvos são fixos por --alvo',
  force: 'publicação forçada não existe',
  config: 'o firebase.json do repositório é o único aceito',
  token: 'credencial por linha de comando não é aceita',
  'non-interactive': 'o guard define o modo do firebase-tools',
  mode: 'o perfil define o modo do Vite',
});
