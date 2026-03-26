import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Workspace, WorkspaceMember, WorkspaceRole } from "./types";

const COLLECTION_NAME = "workspaces";

const syncUserWorkspaceMembership = async (
  userId: string,
  workspaceId: string,
  role: WorkspaceRole
) => {
  await setDoc(
    doc(db, "users", userId, "workspaces", workspaceId),
    {
      workspaceId,
      role,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
};

const ensureOwnerMembership = async (userId: string, workspaceId: string) => {
  await Promise.all([
    setDoc(
      doc(db, COLLECTION_NAME, workspaceId, "members", userId),
      {
        uid: userId,
        email: "",
        role: "owner",
        joinedAt: serverTimestamp(),
        displayName: "Owner"
      },
      { merge: true }
    ),
    setDoc(
      doc(db, "users", userId, "workspaces", workspaceId),
      {
        workspaceId,
        role: "owner",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )
  ]);
};

export const listWorkspaces = async (userId: string): Promise<Workspace[]> => {
  try {
    const roleByWorkspaceId = new Map<string, WorkspaceRole>();
    const workspaceIds = new Set<string>();

    const membershipsRef = collection(db, "users", userId, "workspaces");

    try {
      const membershipsSnap = await getDocs(membershipsRef);

      membershipsSnap.docs.forEach((membershipDoc) => {
        const data = membershipDoc.data() as {
          workspaceId?: string;
          role?: WorkspaceRole;
        };

        const workspaceId = data.workspaceId || membershipDoc.id;
        const role = data.role ?? "member";

        workspaceIds.add(workspaceId);
        roleByWorkspaceId.set(workspaceId, role);
      });
    } catch (error) {
      console.warn("Falha ao ler users/{uid}/workspaces:", error);
    }

    try {
      const ownedWorkspacesQuery = query(
        collection(db, COLLECTION_NAME),
        where("ownerId", "==", userId)
      );

      const ownedWorkspacesSnap = await getDocs(ownedWorkspacesQuery);

      await Promise.all(
        ownedWorkspacesSnap.docs.map(async (workspaceDoc) => {
          workspaceIds.add(workspaceDoc.id);
          roleByWorkspaceId.set(workspaceDoc.id, "owner");

          await ensureOwnerMembership(userId, workspaceDoc.id);
        })
      );
    } catch (error) {
      console.warn("Falha ao buscar workspaces por ownerId:", error);
    }

    try {
      const fallbackMembersQuery = query(
        collectionGroup(db, "members"),
        where("uid", "==", userId)
      );

      const fallbackMembersSnap = await getDocs(fallbackMembersQuery);

      await Promise.all(
        fallbackMembersSnap.docs.map(async (memberDoc) => {
          const workspaceId = memberDoc.ref.parent.parent?.id;
          const memberData = memberDoc.data() as WorkspaceMember;

          if (!workspaceId) return;

          workspaceIds.add(workspaceId);
          roleByWorkspaceId.set(workspaceId, memberData.role ?? "member");

          await setDoc(
            doc(db, "users", userId, "workspaces", workspaceId),
            {
              workspaceId,
              role: memberData.role ?? "member",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        })
      );
    } catch (error) {
      console.warn("Falha ao buscar memberships legados:", error);
    }

    const resolvedWorkspaces = await Promise.all(
      Array.from(workspaceIds).map(async (workspaceId): Promise<Workspace | null> => {
        try {
          const workspaceRef = doc(db, COLLECTION_NAME, workspaceId);
          const workspaceSnap = await getDoc(workspaceRef);

          if (!workspaceSnap.exists()) {
            return null;
          }

          const workspaceData = workspaceSnap.data() as Omit<Workspace, "id">;
          const resolvedRole =
            workspaceData.ownerId === userId
              ? "owner"
              : roleByWorkspaceId.get(workspaceId) ?? "member";

          if (workspaceData.ownerId === userId) {
            await ensureOwnerMembership(userId, workspaceId);
          }

          return {
            id: workspaceSnap.id,
            ...workspaceData,
            myRole: resolvedRole
          } as Workspace;
        } catch (error) {
          console.warn(`Workspace ignorado por falta de permissão ou inconsciência: ${workspaceId}`, error);
          return null;
        }
      })
    );

    return resolvedWorkspaces.filter(
      (workspace): workspace is Workspace => workspace !== null
    );
  } catch (error) {
    console.error("Erro ao listar workspaces:", error);
    throw error;
  }
};

export const createWorkspace = async (
  workspaceData: Omit<Workspace, "id" | "createdAt" | "updatedAt">,
  userEmail: string
): Promise<Workspace> => {
  try {
    const ownerUid = workspaceData.ownerId;
    const workspaceRef = doc(collection(db, COLLECTION_NAME));

    const workspacePayload = {
      ...workspaceData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(workspaceRef, workspacePayload);

    if (ownerUid) {
      await Promise.all([
        setDoc(doc(db, COLLECTION_NAME, workspaceRef.id, "members", ownerUid), {
          uid: ownerUid,
          email: userEmail,
          role: "owner",
          joinedAt: serverTimestamp(),
          displayName: "Owner"
        }),
        setDoc(doc(db, "users", ownerUid, "workspaces", workspaceRef.id), {
          workspaceId: workspaceRef.id,
          role: "owner",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      ]);
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

export const listWorkspaceMembers = async (
  workspaceId: string
): Promise<WorkspaceMember[]> => {
  const snapshot = await getDocs(collection(db, COLLECTION_NAME, workspaceId, "members"));
  return snapshot.docs.map((d) => d.data() as WorkspaceMember);
};

export const addMember = async (workspaceId: string, member: WorkspaceMember) => {
  await setDoc(
    doc(db, COLLECTION_NAME, workspaceId, "members", member.uid),
    {
      ...member,
      joinedAt: serverTimestamp()
    },
    { merge: true }
  );

  await syncUserWorkspaceMembership(member.uid, workspaceId, member.role);
};

export const removeMember = async (workspaceId: string, memberId: string) => {
  await deleteDoc(doc(db, COLLECTION_NAME, workspaceId, "members", memberId));
  await deleteDoc(doc(db, "users", memberId, "workspaces", workspaceId));
};

export const updateMemberRole = async (
  workspaceId: string,
  memberId: string,
  newRole: WorkspaceRole
) => {
  await updateDoc(doc(db, COLLECTION_NAME, workspaceId, "members", memberId), {
    role: newRole
  });

  await syncUserWorkspaceMembership(memberId, workspaceId, newRole);
};

export const updateWorkspace = async (
  id: string,
  data: Partial<Workspace>
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp()
  });
};