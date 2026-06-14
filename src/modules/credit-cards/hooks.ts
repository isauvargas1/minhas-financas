import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCreditCards, createCreditCard, updateCreditCard, deleteCreditCard } from './api';
import {
    createCreditCardPurchase,
    type CreateCreditCardPurchaseFrontendInput,
} from './purchasesApi';
import {
    registerCreditCardInvoicePayment,
    reverseCreditCardInvoicePayment,
    type RegisterCreditCardInvoicePaymentFrontendInput,
    type ReverseCreditCardInvoicePaymentFrontendInput,
} from './invoicePaymentsApi';

import {
    cancelCreditCardPurchase,
    closeCreditCardInvoice,
    rebuildCardInvoicesForCard,
    recalculateCardLimit,
    reopenCreditCardInvoice,
    type CancelCreditCardPurchaseFrontendInput,
    type CloseCreditCardInvoiceFrontendInput,
    type RebuildCardInvoicesForCardFrontendInput,
    type RecalculateCardLimitFrontendInput,
    type ReopenCreditCardInvoiceFrontendInput,
} from './persistence/callableApi';

import {
    CREDIT_CARD_COMPATIBILITY_KEYS,
} from './compatibility';
import {
    listCardLimitSnapshotsByWorkspace,
    listCreditCardInstallmentsByInvoice,
    listCreditCardInvoicePaymentsByInvoice,
    listCreditCardPurchasesByIds,
    listOpenCreditCardInvoicesByCard,
    listCreditCardPurchasesByCard,
    listCreditCardAuditLogsByCard,
    listCreditCardOperationalMetrics,
} from './persistence/readApi';
import { CreditCard } from '../../types';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export const KEYS = {
    all: (ws: string) => ['creditCards', ws],
    invoicesByCard: (ws: string, cardId: string) => ['creditCardInvoicesByCard', ws, cardId],
    invoiceInstallments: (ws: string, invoiceId: string) => ['creditCardInvoiceInstallments', ws, invoiceId],
    invoicePayments: (ws: string, invoiceId: string) => ['creditCardInvoicePayments', ws, invoiceId],
    purchasesByIds: (ws: string, purchaseIds: string[]) => [
        'creditCardPurchasesByIds',
        ws,
        ...purchaseIds,
    ],
    recentPurchasesByCard: (ws: string, cardId: string) => ['creditCardRecentPurchasesByCard', ws, cardId],
        auditLogsByCard: (ws: string, cardId: string) => ['creditCardAuditLogsByCard', ws, cardId],
    operationalMetrics: (ws: string) => ['creditCardOperationalMetrics', ws],
};

const mergeCardsWithLimitSnapshots = async (
    workspaceId: string
): Promise<CreditCard[]> => {
    const [cards, snapshots] = await Promise.all([
        listCreditCards(workspaceId),
        listCardLimitSnapshotsByWorkspace(workspaceId),
    ]);

    const snapshotByCardId = new Map(
        snapshots.map((snapshot) => [String(snapshot.cardId), snapshot])
    );

    return cards.map((card) => {
        const snapshot = snapshotByCardId.get(String(card.id));

        if (!snapshot) {
            return card;
        }

        return {
            ...card,
            limitTotal: snapshot.limitTotal ?? card.limitTotal,
            limitUsed: snapshot.limitUsed,
            limitAvailable: snapshot.limitAvailable,
        };
    });
};

export const useCreditCards = () => {
    const { activeWorkspace } = useWorkspace();

    return useQuery({
        queryKey: KEYS.all(activeWorkspace.id),
        queryFn: () => mergeCardsWithLimitSnapshots(activeWorkspace.id),
        enabled: !!activeWorkspace.id && activeWorkspace.id !== 'loading'
    });
};

export const useCreateCreditCard = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (card: Omit<CreditCard, 'id'>) => createCreditCard(card, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

export const useUpdateCreditCard = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<CreditCard> }) =>
            updateCreditCard(id, data, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

export const useDeleteCreditCard = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => deleteCreditCard(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

const isWorkspaceReady = (workspaceId?: string): workspaceId is string =>
    Boolean(workspaceId) && workspaceId !== 'loading';

export const useCreateCreditCardPurchaseDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (
            input: Omit<CreateCreditCardPurchaseFrontendInput, 'workspaceId'>
        ) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return createCreditCardPurchase({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async () => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: KEYS.all(activeWorkspace.id),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: CREDIT_CARD_COMPATIBILITY_KEYS.invoiceTransactionProjections(
                        activeWorkspace.id,
                    ),
                    refetchType: 'active',
                }),
            ]);
        },
    });
};

const invalidateCreditCardDomainQueries = async (
    queryClient: ReturnType<typeof useQueryClient>,
    workspaceId: string,
    cardId?: string,
    invoiceId?: string
): Promise<void> => {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: KEYS.all(workspaceId),
            refetchType: 'active',
        }),
        cardId
            ? queryClient.invalidateQueries({
                queryKey: KEYS.invoicesByCard(workspaceId, cardId),
                refetchType: 'active',
            })
            : Promise.resolve(),
        invoiceId
            ? queryClient.invalidateQueries({
                queryKey: KEYS.invoicePayments(workspaceId, invoiceId),
                refetchType: 'active',
            })
            : Promise.resolve(),
        invoiceId
            ? queryClient.invalidateQueries({
                queryKey: KEYS.invoiceInstallments(workspaceId, invoiceId),
                refetchType: 'active',
            })
            : Promise.resolve(),
        cardId
            ? queryClient.invalidateQueries({
                queryKey: KEYS.recentPurchasesByCard(workspaceId, cardId),
                refetchType: 'active',
            })
            : Promise.resolve(),
        cardId
            ? queryClient.invalidateQueries({
                queryKey: KEYS.auditLogsByCard(workspaceId, cardId),
                refetchType: 'active',
            })
            : Promise.resolve(),
        queryClient.invalidateQueries({
            queryKey: KEYS.operationalMetrics(workspaceId),
            refetchType: 'active',
        }),
        queryClient.invalidateQueries({
            queryKey: CREDIT_CARD_COMPATIBILITY_KEYS.invoiceTransactionProjections(workspaceId),
            refetchType: 'active',
        }),
        queryClient.invalidateQueries({
            queryKey: ['transactions', workspaceId],
            refetchType: 'active',
        }),
    ]);
};

export const useOpenCreditCardInvoicesByCard = (cardId?: string | null) => {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id;

    return useQuery({
        queryKey: isWorkspaceReady(workspaceId) && cardId
            ? KEYS.invoicesByCard(workspaceId, cardId)
            : ['creditCardInvoicesByCard', 'disabled'],
        queryFn: () => {
            if (!isWorkspaceReady(workspaceId) || !cardId) {
                return Promise.resolve([]);
            }

            return listOpenCreditCardInvoicesByCard(workspaceId, cardId, {
                limit: 24,
            });
        },
        enabled: isWorkspaceReady(workspaceId) && Boolean(cardId),
        staleTime: 1000 * 60 * 2,
    });
};

export const useRegisterCreditCardInvoicePaymentDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (
            input: Omit<RegisterCreditCardInvoicePaymentFrontendInput, 'workspaceId'>
        ) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return registerCreditCardInvoicePayment({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async (_result, variables) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: KEYS.all(activeWorkspace.id),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: KEYS.invoicesByCard(activeWorkspace.id, variables.cardId),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: CREDIT_CARD_COMPATIBILITY_KEYS.invoiceTransactionProjections(
                        activeWorkspace.id,
                    ),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: ['transactions', activeWorkspace.id],
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: KEYS.invoicePayments(activeWorkspace.id, variables.invoiceId),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: KEYS.invoiceInstallments(activeWorkspace.id, variables.invoiceId),
                    refetchType: 'active',
                }),


            ]);


        },


    });


};

export const useCreditCardInvoiceInstallments = (
    invoiceId?: string | null
) => {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id;

    return useQuery({
        queryKey: isWorkspaceReady(workspaceId) && invoiceId
            ? KEYS.invoiceInstallments(workspaceId, invoiceId)
            : ['creditCardInvoiceInstallments', 'disabled'],
        queryFn: () => {
            if (!isWorkspaceReady(workspaceId) || !invoiceId) {
                return Promise.resolve([]);
            }

            return listCreditCardInstallmentsByInvoice(workspaceId, invoiceId);
        },
        enabled: isWorkspaceReady(workspaceId) && Boolean(invoiceId),
        staleTime: 1000 * 60 * 2,
    });
};

export const useCreditCardInvoicePayments = (
    invoiceId?: string | null
) => {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id;

    return useQuery({
        queryKey: isWorkspaceReady(workspaceId) && invoiceId
            ? KEYS.invoicePayments(workspaceId, invoiceId)
            : ['creditCardInvoicePayments', 'disabled'],
        queryFn: () => {
            if (!isWorkspaceReady(workspaceId) || !invoiceId) {
                return Promise.resolve([]);
            }

            return listCreditCardInvoicePaymentsByInvoice(workspaceId, invoiceId);
        },
        enabled: isWorkspaceReady(workspaceId) && Boolean(invoiceId),
        staleTime: 1000 * 60 * 2,
    });
};

export const useRecentCreditCardPurchasesByCard = (
    cardId?: string | null
) => {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id;

    return useQuery({
        queryKey: isWorkspaceReady(workspaceId) && cardId
            ? KEYS.recentPurchasesByCard(workspaceId, cardId)
            : ['creditCardRecentPurchasesByCard', 'disabled'],
        queryFn: () => {
            if (!isWorkspaceReady(workspaceId) || !cardId) {
                return Promise.resolve([]);
            }

            return listCreditCardPurchasesByCard(workspaceId, cardId, {
                limit: 8,
                statuses: ['active'],
            });
        },
        enabled: isWorkspaceReady(workspaceId) && Boolean(cardId),
        staleTime: 1000 * 60 * 2,
    });
};

export const useCreditCardPurchasesByIds = (
    purchaseIds: string[]
) => {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id;
    const uniquePurchaseIds = Array.from(new Set(purchaseIds.filter(Boolean))).sort();

    return useQuery({
        queryKey: isWorkspaceReady(workspaceId) && uniquePurchaseIds.length > 0
            ? KEYS.purchasesByIds(workspaceId, uniquePurchaseIds)
            : ['creditCardPurchasesByIds', 'disabled'],
        queryFn: () => {
            if (!isWorkspaceReady(workspaceId) || uniquePurchaseIds.length === 0) {
                return Promise.resolve([]);
            }

            return listCreditCardPurchasesByIds(workspaceId, uniquePurchaseIds);
        },
        enabled: isWorkspaceReady(workspaceId) && uniquePurchaseIds.length > 0,
        staleTime: 1000 * 60 * 2,
    });
};

export const useReverseCreditCardInvoicePaymentDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (
            input: Omit<ReverseCreditCardInvoicePaymentFrontendInput, 'workspaceId'>
        ) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return reverseCreditCardInvoicePayment({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async (_result, variables) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: KEYS.all(activeWorkspace.id),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: KEYS.invoicesByCard(activeWorkspace.id, variables.cardId),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: KEYS.invoicePayments(activeWorkspace.id, variables.invoiceId),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: KEYS.invoiceInstallments(activeWorkspace.id, variables.invoiceId),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: CREDIT_CARD_COMPATIBILITY_KEYS.invoiceTransactionProjections(
                        activeWorkspace.id,
                    ),
                    refetchType: 'active',
                }),
                queryClient.invalidateQueries({
                    queryKey: ['transactions', activeWorkspace.id],
                    refetchType: 'active',
                }),
            ]);
        },
    });
};

export const useCloseCreditCardInvoiceDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: Omit<CloseCreditCardInvoiceFrontendInput, 'workspaceId'>) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return closeCreditCardInvoice({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async (_result, variables) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await invalidateCreditCardDomainQueries(
                queryClient,
                activeWorkspace.id,
                variables.cardId,
                variables.invoiceId
            );
        },
    });
};

export const useReopenCreditCardInvoiceDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: Omit<ReopenCreditCardInvoiceFrontendInput, 'workspaceId'>) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return reopenCreditCardInvoice({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async (_result, variables) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await invalidateCreditCardDomainQueries(
                queryClient,
                activeWorkspace.id,
                variables.cardId,
                variables.invoiceId
            );
        },
    });
};

export const useCancelCreditCardPurchaseDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: Omit<CancelCreditCardPurchaseFrontendInput, 'workspaceId'>) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return cancelCreditCardPurchase({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async (_result, variables) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await invalidateCreditCardDomainQueries(
                queryClient,
                activeWorkspace.id,
                variables.cardId
            );
        },
    });
};

export const useRecalculateCardLimitDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: Omit<RecalculateCardLimitFrontendInput, 'workspaceId'>) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return recalculateCardLimit({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async (_result, variables) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await invalidateCreditCardDomainQueries(
                queryClient,
                activeWorkspace.id,
                variables.cardId
            );
        },
    });
};

export const useRebuildCardInvoicesForCardDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: Omit<RebuildCardInvoicesForCardFrontendInput, 'workspaceId'>) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return rebuildCardInvoicesForCard({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async (_result, variables) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await invalidateCreditCardDomainQueries(
                queryClient,
                activeWorkspace.id,
                variables.cardId
            );
        },
    });
};

export const useCreditCardAuditLogsByCard = (
    cardId?: string | null,
    enabled = true
) => {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id;

    return useQuery({
        queryKey: isWorkspaceReady(workspaceId) && cardId
            ? KEYS.auditLogsByCard(workspaceId, cardId)
            : ['creditCardAuditLogsByCard', 'disabled'],
        queryFn: () => {
            if (!isWorkspaceReady(workspaceId) || !cardId) {
                return Promise.resolve([]);
            }

            return listCreditCardAuditLogsByCard(workspaceId, cardId, {
                limit: 20,
            });
        },
        enabled: enabled && isWorkspaceReady(workspaceId) && Boolean(cardId),
        staleTime: 1000 * 60,
    });
};

export const useCreditCardOperationalMetrics = (
    enabled = true
) => {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id;

    return useQuery({
        queryKey: isWorkspaceReady(workspaceId)
            ? KEYS.operationalMetrics(workspaceId)
            : ['creditCardOperationalMetrics', 'disabled'],
        queryFn: () => {
            if (!isWorkspaceReady(workspaceId)) {
                return Promise.resolve([]);
            }

            return listCreditCardOperationalMetrics(workspaceId, {
                limit: 20,
            });
        },
        enabled: enabled && isWorkspaceReady(workspaceId),
        staleTime: 1000 * 60,
    });
};