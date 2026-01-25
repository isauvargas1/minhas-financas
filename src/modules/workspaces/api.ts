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
    const membershipsRef = collection(db, "users", userId, "workspaces");
    const membershipsSnap = await getDocs(membershipsRef);

    const promises = membershipsSnap.docs.map(async (m): Promise<Workspace | null> => {
      const data = m.data() as { workspaceId?: string; role?: WorkspaceRole };
      const workspaceId = data.workspaceId || m.id;
      const role = data.role;

      const wsRef = doc(db, COLLECTION_NAME, workspaceId);
      const wsSnap = await getDoc(wsRef);

      if (!wsSnap.exists()) return null;

      return {
        id: wsSnap.id,
        ...(wsSnap.data() as Omit<Workspace, "id">),
        myRole: role
      } as Workspace;
    });

    const results = await Promise.all(promises);
    return results.filter((w): w is Workspace => w !== null);
  } catch (error) {
    console.error("Erro ao listar workspaces:", error);
    throw error;
  }
};


// 2. Criação Ajustada (Cria workspace + First Member)
export const createWorkspace = async (
    workspaceData: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>, 
    userEmail: string 
): Promise<Workspace> => {
    try {
        console.log("Iniciando criação do workspace...");

        // 1. Cria o documento PAI (Workspace) com o ownerId
        // Isso satisfaz a regra 'isWorkspaceOwner' que criamos
                const ownerUid = (workspaceData as any).ownerId;

        const workspaceRef = doc(collection(db, COLLECTION_NAME));

        const workspacePayload = {
          ...workspaceData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        await setDoc(workspaceRef, workspacePayload);

        if (ownerUid) {
          await setDoc(doc(db, COLLECTION_NAME, workspaceRef.id, "members", ownerUid), {
            uid: ownerUid,
            email: userEmail,
            role: "owner",
            joinedAt: serverTimestamp(),
            displayName: "Owner"
          });

          await setDoc(doc(db, "users", ownerUid, "workspaces", workspaceRef.id), {
            workspaceId: workspaceRef.id,
            role: "owner",
            createdAt: serverTimestamp()
          });
        }

        return {
          id: workspaceRef.id,
          ...workspaceData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          myRole: "owner"
        };

    } catch (error) {
        console.error("ERRO CRÍTICO ao criar workspace:", error);
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