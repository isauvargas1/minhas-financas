import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import {useQueryClient} from '@tanstack/react-query';
import { Workspace } from '../modules/workspaces/types';
import { bootstrapAccount, listWorkspaces, loadWorkspace } from '../modules/workspaces/api';
import { callableErrorReason, workspaceErrorMessage } from '../modules/workspaces/errors';
import { useTheme } from './ThemeContext';
import { useAuth } from './AuthContext';
import {seedLegacySettingsCatalog} from '../modules/settings-catalog/api';
import {onboardInvestmentWorkspace} from '../modules/investments/persistence/callableApi';

interface WorkspaceContextValue {
    workspaces: Workspace[];
    activeWorkspace: Workspace;
    activeWorkspaceRole: Workspace['myRole'];
    canManageActiveWorkspace: boolean;
    isLoading: boolean;
    /** Mensagem pt-BR quando a conta ou os workspaces não puderam ser carregados. */
    loadError: string | null;
    switchWorkspace: (workspaceId: string) => void;
    reloadWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const LOADING_WORKSPACE: Workspace = {
    id: 'loading',
    name: 'Carregando...',
    type: 'PF',
    themeColor: '#4f46e5',
    createdAt: '',
    updatedAt: ''
};

const LOAD_FAILURE_MESSAGE =
    'Não foi possível carregar seus espaços agora. Verifique sua conexão e recarregue a página.';

const lastWorkspaceKey = (uid: string) => `lastWorkspaceId_${uid}`;

const readLastWorkspace = (uid: string): string | null => {
    try {
        return localStorage.getItem(lastWorkspaceKey(uid));
    } catch {
        return null;
    }
};

/**
 * Workspaces do usuário (P1).
 *
 * A conta é preparada por `bootstrapAccount` (idempotente, no backend) e não
 * mais pelo cliente. A lista vem do índice mantido pelo backend; o papel do
 * workspace ativo vem do membership ativo, relido a cada seleção. Nenhuma
 * escrita de workspace, membership ou índice parte daqui.
 */
export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { updateTheme, theme } = useTheme();
    const queryClient = useQueryClient();

    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    // Carga iniciada para outro usuário não pode aplicar estado ao atual.
    const loadingUid = useRef<string | null>(null);

    const applySelection = (workspace: Workspace, onboardNewWorkspace = false) => {
        setActiveWorkspace(workspace);
        if (user) {
            try {
                localStorage.setItem(lastWorkspaceKey(user.uid), workspace.id);
            } catch {
                // Armazenamento indisponível: a preferência não é essencial.
            }
        }

        const color = workspace.themeColor || (workspace.type === 'PJ' ? '#0f766e' : '#4f46e5');
        updateTheme({
            colors: {
                ...theme.colors,
                primary: color,
                chartIncome: workspace.type === 'PJ' ? '#0f766e' : '#22c55e'
            }
        });

        if (workspace.myRole === 'owner' || workspace.myRole === 'admin') {
            void seedLegacySettingsCatalog(workspace.id)
                .then(() => queryClient.invalidateQueries({
                    queryKey: ['settingsCatalog', workspace.id],
                    refetchType: 'active',
                }))
                .catch((error) => {
                    console.error('Não foi possível preparar o catálogo inicial do workspace:', error);
                });
        }
        if (onboardNewWorkspace && workspace.myRole === 'owner') {
            void onboardInvestmentWorkspace(workspace.id).catch((error) => {
                console.error('Não foi possível preparar os cadastros de investimentos:', error);
            });
        }
    };

    const loadData = async () => {
        if (!user) return;
        const uid = user.uid;
        loadingUid.current = uid;

        setIsLoading(true);
        setLoadError(null);
        try {
            const account = await bootstrapAccount();
            const list = await listWorkspaces(uid);
            if (loadingUid.current !== uid) return;
            if (list.length === 0) {
                setWorkspaces([]);
                setActiveWorkspace(null);
                setLoadError(LOAD_FAILURE_MESSAGE);
                return;
            }

            const savedId = readLastWorkspace(uid);
            const selectedId = list.find((w) => w.id === savedId)?.id ?? list[0].id;
            let selected: Workspace;
            try {
                selected = await loadWorkspace(selectedId, uid);
            } catch {
                selected = await loadWorkspace(list[0].id, uid);
            }
            if (loadingUid.current !== uid) return;

            setWorkspaces(list.map((entry) => (entry.id === selected.id ? selected : entry)));
            applySelection(
                selected,
                account.created && account.workspaceId === selected.id,
            );
        } catch (error) {
            console.error("Falha ao carregar a conta e os workspaces", error);
            if (loadingUid.current !== uid) return;
            setActiveWorkspace(null);
            setLoadError(
                callableErrorReason(error) === 'account_suspended'
                    ? workspaceErrorMessage(error, LOAD_FAILURE_MESSAGE)
                    : LOAD_FAILURE_MESSAGE,
            );
        } finally {
            if (loadingUid.current === uid) setIsLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            loadData();
        } else {
            loadingUid.current = null;
            setWorkspaces([]);
            setActiveWorkspace(null);
            setLoadError(null);
        }
    }, [user]);

    const switchWorkspace = (workspaceId: string) => {
        if (!user) return;
        const uid = user.uid;
        void loadWorkspace(workspaceId, uid)
            .then((workspace) => {
                if (loadingUid.current !== uid) return;
                setWorkspaces((current) => current.map((entry) => (
                    entry.id === workspace.id ? workspace : entry
                )));
                applySelection(workspace);
            })
            .catch((error) => {
                // Acesso removido entre a listagem e a seleção: recarrega a lista.
                console.error('Não foi possível abrir o workspace selecionado:', error);
                void loadData();
            });
    };

    const resolvedActiveWorkspace = activeWorkspace || LOADING_WORKSPACE;
    const activeWorkspaceRole = activeWorkspace?.myRole;
    const canManageActiveWorkspace =
        activeWorkspaceRole === 'owner' || activeWorkspaceRole === 'admin';

    return (
        <WorkspaceContext.Provider value={{
            activeWorkspace: resolvedActiveWorkspace,
            activeWorkspaceRole,
            canManageActiveWorkspace,
            workspaces,
            switchWorkspace,
            isLoading,
            loadError,
            reloadWorkspaces: loadData
        }}>
            {children}
        </WorkspaceContext.Provider>
    );
};

export const useWorkspace = () => {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider');
    }
    return context;
};
