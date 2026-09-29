import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Workspace } from '../modules/workspaces/types';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { bootstrapAccount, listWorkspacesPage, loadWorkspace } from '../modules/workspaces/api';
import { callableErrorReason, workspaceErrorMessage } from '../modules/workspaces/errors';
import { useTheme } from './ThemeContext';
import { useAuth } from './AuthContext';

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
    /** Há mais workspaces no índice além das páginas já carregadas. */
    hasMoreWorkspaces: boolean;
    /** Carrega a próxima página do índice (cursor). */
    loadMoreWorkspaces: () => Promise<void>;
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

/** Acrescenta sem duplicar: a entrada já conhecida (com papel) prevalece. */
const mergeWorkspaces = (current: Workspace[], incoming: Workspace[]): Workspace[] => {
    const known = new Set(current.map((entry) => entry.id));
    return [...current, ...incoming.filter((entry) => !known.has(entry.id))];
};

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
 * mais pelo cliente; o workspace já sai do backend com os cadastros padrão, e
 * nada é provisionado ao selecioná-lo. A lista é lida por página (cursor): a
 * primeira ao entrar, as seguintes sob demanda. A lista vem do índice mantido pelo backend; o papel do
 * workspace ativo vem do membership ativo, relido a cada seleção. Nenhuma
 * escrita de workspace, membership ou índice parte daqui.
 */
export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { updateTheme, theme } = useTheme();

    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [workspaceCursor, setWorkspaceCursor] = useState<QueryDocumentSnapshot | null>(null);
    // Carga iniciada para outro usuário não pode aplicar estado ao atual.
    const loadingUid = useRef<string | null>(null);

    const applySelection = (workspace: Workspace) => {
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
    };

    const loadData = async () => {
        if (!user) return;
        const uid = user.uid;
        loadingUid.current = uid;

        setIsLoading(true);
        setLoadError(null);
        try {
            await bootstrapAccount();
            const page = await listWorkspacesPage(uid);
            if (loadingUid.current !== uid) return;
            const list = page.items;
            if (list.length === 0) {
                setWorkspaces([]);
                setWorkspaceCursor(null);
                setActiveWorkspace(null);
                setLoadError(LOAD_FAILURE_MESSAGE);
                return;
            }

            // O último workspace usado pode estar além da primeira página:
            // é aberto direto, e o membership ativo decide o acesso.
            const savedId = readLastWorkspace(uid);
            let selected: Workspace;
            try {
                selected = await loadWorkspace(savedId ?? list[0].id, uid);
            } catch {
                selected = await loadWorkspace(list[0].id, uid);
            }
            if (loadingUid.current !== uid) return;

            setWorkspaces(mergeWorkspaces(
                list.map((entry) => (entry.id === selected.id ? selected : entry)),
                [selected],
            ));
            setWorkspaceCursor(page.nextCursor);
            applySelection(selected);
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
            setWorkspaceCursor(null);
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

    const loadMoreWorkspaces = async () => {
        if (!user || !workspaceCursor) return;
        const uid = user.uid;
        try {
            const page = await listWorkspacesPage(uid, workspaceCursor);
            if (loadingUid.current !== uid) return;
            setWorkspaces((current) => mergeWorkspaces(current, page.items));
            setWorkspaceCursor(page.nextCursor);
        } catch (error) {
            console.error('Não foi possível carregar mais espaços:', error);
        }
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
            reloadWorkspaces: loadData,
            hasMoreWorkspaces: workspaceCursor !== null,
            loadMoreWorkspaces,
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
