import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
    GoogleAuthProvider, 
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore'; // IMPORT ADICIONADO
import { auth, db } from '../lib/firebase'; // IMPORT ATUALIZADO (adicionado o db)

// 1. Criamos um tipo customizado que inclui o isAdmin
export interface AppUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    isAdmin?: boolean;
}

// 2. Atualizamos o Contexto para usar o AppUser no lugar do User padrão do Firebase
interface AuthContextType {
    user: AppUser | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    signInForE2E?: (email?: string, password?: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const isE2EMode = import.meta.env.VITE_E2E_MODE === 'true';

const getFirebaseAuthErrorCode = (error: unknown): string => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        return String((error as { code?: unknown }).code);
    }

    return '';
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // 3. O estado agora armazena o AppUser
    const [user, setUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Escuta mudanças na autenticação em tempo real
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                let isAdmin = false;
                
                try {
                    // Busca no Firestore para ver se o usuário é o Super Admin
                    const userDocRef = doc(db, 'users', currentUser.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    
                    if (userDocSnap.exists() && userDocSnap.data().isAdmin === true) {
                        isAdmin = true;
                    }
                } catch (error) {
                    console.error("Erro ao verificar status de admin:", error);
                }

                // Monta o usuário completo e salva no estado global
                setUser({
                    uid: currentUser.uid,
                    email: currentUser.email,
                    displayName: currentUser.displayName,
                    photoURL: currentUser.photoURL,
                    isAdmin: isAdmin
                });
            } else {
                setUser(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Erro no login:", error);
            throw error;
        }
    };


        const signInForE2E = async (
        email = 'e2e-owner@minhas-financas.local',
        password = 'e2e-password-123456',
    ) => {
        if (!isE2EMode) {
            throw new Error('Login E2E indisponível fora do modo de teste.');
        }

        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            const code = getFirebaseAuthErrorCode(error);

            if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
                await createUserWithEmailAndPassword(auth, email, password);
                return;
            }

            throw error;
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Erro no logout:", error);
        }
    };

    return (
                <AuthContext.Provider value={{
            user,
            loading,
            signInWithGoogle,
            signInForE2E: isE2EMode ? signInForE2E : undefined,
            logout,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
    return context;
};