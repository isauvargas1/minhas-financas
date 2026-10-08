/*
 * Propriedades específicas de cada pacote de ícones (V-01, UX-H1).
 *
 * O `AppIcon` passa a mesma espessura de traço do tema para os três pacotes,
 * mas cada um a recebe por uma propriedade diferente:
 * - Tabler: `stroke` é a espessura do traço (a cor vem de `color`);
 * - Phosphor: não tem traço, e sim `weight` (light/regular/bold);
 * - Lucide: lê `strokeWidth` e **não pode** receber a chave `stroke`, porque o
 *   lucide-react 0.263 espalha as props restantes depois de
 *   `stroke: currentColor` — até `stroke: undefined` apaga o traço e o ícone
 *   some.
 *
 * Fica fora do `.tsx` para ser testado com os componentes reais dos pacotes.
 */
export type IconPackName = 'lucide' | 'tabler' | 'phosphor';

export type PhosphorWeight = 'light' | 'regular' | 'bold';

export const phosphorWeightFor = (strokeWidth: number): PhosphorWeight =>
    strokeWidth <= 1.5 ? 'light' : strokeWidth >= 2.5 ? 'bold' : 'regular';

export const iconPackProps = (
    pack: IconPackName,
    strokeWidth: number,
): { stroke?: number; weight?: PhosphorWeight } => {
    if (pack === 'tabler') return { stroke: strokeWidth };
    if (pack === 'phosphor') return { weight: phosphorWeightFor(strokeWidth) };
    return {};
};
