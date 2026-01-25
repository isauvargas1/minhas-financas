import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  getDoc,
  setDoc,
  deleteDoc,
  collectionGroup // Importante!
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Workspace, WorkspaceMember, WorkspaceRole } from './types';

const COLLECTION_NAME = 'workspaces';

// 1. Listagem baseada em Membership (A grande mudança)
export const listWorkspaces = async (userId: string): Promise<Workspace[]> => {
    try {
        const q = query(
            collectionGroup(db, 'members'), 
            where('uid', '==', userId)
        );
        
        const querySnapshot = await getDocs(q);
        
        // [CORREÇÃO] Explicitamos que a Promise retorna Workspace | null
        const promises = querySnapshot.docs.map(async (memberDoc): Promise<Workspace | null> => {
            const workspaceRef = memberDoc.ref.parent.parent; 
            if (workspaceRef) {
                const wsSnap = await getDoc(workspaceRef);
                if (wsSnap.exists()) {
                    const wsData = wsSnap.data();
                    
                    // Retornamos como Workspace para alinhar os tipos
                    return { 
                        id: wsSnap.id,
                        ...wsData,
                        myRole: memberDoc.data().role
                    } as Workspace; 
                }
            }
            return null;
        });

        const results = await Promise.all(promises);
        
        // Agora o filtro funciona porque 'results' é (Workspace | null)[]
        return results.filter((w): w is Workspace => w !== null);

    } catch (error) {
        console.error("Erro ao listar workspaces:", error);
        throw error;
    }
};

// 2. Criação Ajustada (Cria workspace + First Member)
export const createWorkspace = async (
    workspaceData: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>, 
    userEmail: string // Precisamos do email agora para o perfil do membro
): Promise<Workspace> => {
    try {
        // Cria o documento do Workspace
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...workspaceData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        const ownerUid = (workspaceData as any).ownerId; // Garantido pelo hook/context

        if (ownerUid) {
            // Cria o membership do Owner com dados ricos
            await setDoc(doc(db, COLLECTION_NAME, docRef.id, "members", ownerUid), {
                uid: ownerUid,
                email: userEmail,
                role: "owner",
                joinedAt: serverTimestamp(),
                displayName: "Owner" // Pode vir do Auth Profile depois
            });
        }

        return {
            id: docRef.id,
            ...workspaceData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            myRole: 'owner'
        };
    } catch (error) {
        console.error("Erro ao criar workspace:", error);
        throw error;
    }
};

// 3. Gerenciamento de Membros (Novas Funções)

export const listWorkspaceMembers = async (workspaceId: string): Promise<WorkspaceMember[]> => {
    const q = query(collection(db, COLLECTION_NAME, workspaceId, "members"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as WorkspaceMember);
};

export const addMember = async (workspaceId: string, member: WorkspaceMember) => {
    // Atenção: Num app real, usaríamos Cloud Functions para buscar UID pelo Email.
    // Aqui, assumiremos que temos o UID ou usaremos o email como chave temporária se necessário.
    await setDoc(doc(db, COLLECTION_NAME, workspaceId, "members", member.uid), {
        ...member,
        joinedAt: serverTimestamp()
    });
};

export const removeMember = async (workspaceId: string, memberId: string) => {
    await deleteDoc(doc(db, COLLECTION_NAME, workspaceId, "members", memberId));
};

export const updateMemberRole = async (workspaceId: string, memberId: string, newRole: WorkspaceRole) => {
    await updateDoc(doc(db, COLLECTION_NAME, workspaceId, "members", memberId), {
        role: newRole
    });
};

export const updateWorkspace = async (id: string, data: Partial<Workspace>): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    });
};