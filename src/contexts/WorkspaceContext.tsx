import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Workspace } from '../modules/workspaces/types';
import { listWorkspaces, createWorkspace } from '../modules/workspaces/api';
import { useTheme } from './ThemeContext';
import { useAuth } from './AuthContext';

interface WorkspaceContextValue {
    workspaces: Workspace[];
    activeWorkspace: Workspace;
    isLoading: boolean;
    switchWorkspace: (workspaceId: string) => void;
    reloadWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

// Fallback visual com ownerId para satisfazer o TypeScript
const LOADING_WORKSPACE: Workspace = { 
    id: 'loading', 
    name: 'Carregando...',
    type: 'PF', 
    themeColor: '#4f46e5',
    createdAt: '',
    updatedAt: ''
};


export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { updateTheme, theme } = useTheme();
    
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadData = async () => {
        if (!user) return;

        setIsLoading(true);
        try {
            let list = await listWorkspaces(user.uid);

            if (list.length === 0) {
                console.log("Novo usuário detectado. Criando workspace padrão...");
                // [CORREÇÃO 2] Passamos o email do usuário como segundo argumento
                const defaultWorkspace = await createWorkspace({
                    name: 'Meu Espaço Pessoal',
                    type: 'PF',
                    ownerId: user.uid, 
                    themeColor: '#4f46e5'
                }, user.email || 'usuario-sem-email@sistema'); 

                list = [defaultWorkspace];
            }

            setWorkspaces(list);

            // Recupera a última seleção ou define o padrão
            const savedId = localStorage.getItem(`lastWorkspaceId_${user.uid}`);
            let selected = list.find(w => w.id === savedId);

            if (!selected) {
                selected = list[0];
            }

            handleWorkspaceSelection(selected);

        } catch (error) {
            console.error("Falha crítica ao carregar workspaces", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            loadData();
        } else {
            setWorkspaces([]);
            setActiveWorkspace(null);
        }
    }, [user]);

    const handleWorkspaceSelection = (workspace: Workspace) => {
        setActiveWorkspace(workspace);
        if (user) {
            localStorage.setItem(`lastWorkspaceId_${user.uid}`, workspace.id);
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

    const switchWorkspace = (workspaceId: string) => {
        const workspace = workspaces.find(w => w.id === workspaceId);
        if (workspace) {
            handleWorkspaceSelection(workspace);
        }
    };

    return (
        <WorkspaceContext.Provider value={{ 
            activeWorkspace: activeWorkspace || LOADING_WORKSPACE, 
            workspaces, 
            switchWorkspace, 
            isLoading,
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