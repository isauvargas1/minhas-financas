/*
 * P5-E1.1 — só no bundle de `e2e/notifications-exit-race.spec.ts`: ícones
 * vazios no lugar de `src/components/Icons.tsx` (que carrega pacotes de ícones
 * e o tema). O teste observa a lista animada, não os ícones.
 */
const Empty = ({ className }: { className?: string }) => <span aria-hidden="true" className={className} />;

export const CheckIcon = Empty;
export const CloseIcon = Empty;
export const DeleteIcon = Empty;
export const WarningIcon = Empty;
export const DynamicIcon = ({ className }: { name: string; className?: string }) => <Empty className={className} />;
