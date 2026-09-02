import { useEffect, useMemo, useState } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  useCreateSettingsCatalogItem,
  useDeleteSettingsCatalogItem,
  useSettingsCatalogPage,
  useUpdateSettingsCatalogItem
} from './hooks';
import {
  buildSettingsCatalogStats,
  listCommonSettingsCatalogSections,
  matchesSettingsCatalogSearch,
  sortSettingsCatalogForDisplay,
  type SettingsCatalogSectionKey
} from './presentation';
import type {
  SettingsCatalogCreateInput,
  SettingsCatalogItem,
  SettingsCatalogPageCursor,
  SettingsCatalogStatus,
  SettingsCatalogTransactionSubtype,
  SettingsCatalogUpdateInput
} from './types';

type FeedbackState =
  | {
      type: 'success' | 'error';
      message: string;
    }
  | null;

type ModalMode = 'create' | 'edit';

export interface SettingsCatalogFormValues {
  name: string;
  icon?: string | null;
  color?: string | null;
  stroke?: number | null;
  sortOrder?: number;
  status?: SettingsCatalogStatus;
}

const DEFAULT_CATEGORY_SUBTYPE: SettingsCatalogTransactionSubtype = 'despesa';

export const useSettingsCatalogScreen = () => {
  const { activeWorkspace } = useWorkspace();

  /*
   * Configurações › Cadastros lista o catálogo da experiência comum: o que o
   * perfil do workspace permite **e** o que a própria seção declara como
   * `audience: 'common'`. Risco, liquidez, indexadores e estratégias seguem
   * definidos no domínio e fora daqui.
   */
  const sections = useMemo(
    () => listCommonSettingsCatalogSections(activeWorkspace.type),
    [activeWorkspace.type]
  );

  const [activeSectionKey, setActiveSectionKey] =
    useState<SettingsCatalogSectionKey>('productsServices');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [transactionSubtype, setTransactionSubtype] =
    useState<SettingsCatalogTransactionSubtype>(DEFAULT_CATEGORY_SUBTYPE);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [selectedItem, setSelectedItem] = useState<SettingsCatalogItem | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [pageCursor, setPageCursor] = useState<SettingsCatalogPageCursor | null>(null);

  useEffect(() => {
    const activeSectionExists = sections.some(
      (section) => section.key === activeSectionKey
    );

    if (!activeSectionExists && sections.length > 0) {
      setActiveSectionKey(sections[0].key);
    }
  }, [activeSectionKey, sections]);

  // A seção ativa sai da lista visível: nada fora dela pode virar a tela
  // aberta, nem por um render enquanto o efeito acima ainda não corrigiu a
  // chave.
  const activeSection =
    sections.find((section) => section.key === activeSectionKey) ?? sections[0];

  const query = useSettingsCatalogPage({
    group: activeSection?.group,
    includeInactive,
    transactionSubtype: activeSection?.supportsTransactionSubtype
      ? transactionSubtype
      : undefined
  }, pageCursor);

  useEffect(() => {
    setPageCursor(null);
  }, [activeSectionKey, includeInactive, transactionSubtype, activeWorkspace.id]);

  const items = useMemo(() => {
    const baseItems = query.data?.items ?? [];
    const visibleItems = baseItems.filter((item) =>
      matchesSettingsCatalogSearch(item, search)
    );

    return sortSettingsCatalogForDisplay(visibleItems);
  }, [query.data?.items, search]);

  const stats = useMemo(
    () => buildSettingsCatalogStats(query.data?.items ?? []),
    [query.data?.items],
  );

  const createMutation = useCreateSettingsCatalogItem();
  const updateMutation = useUpdateSettingsCatalogItem();
  const deleteMutation = useDeleteSettingsCatalogItem();

  const clearFeedback = () => setFeedback(null);

  const openCreateModal = () => {
    setModalMode('create');
    setSelectedItem(null);
    setIsModalOpen(true);
    clearFeedback();
  };

  const openEditModal = (item: SettingsCatalogItem) => {
    setModalMode('edit');
    setSelectedItem(item);

    if (item.transactionSubtype) {
      setTransactionSubtype(item.transactionSubtype);
    }

    setIsModalOpen(true);
    clearFeedback();
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedItem(null);
  };

  const submitItem = async (values: SettingsCatalogFormValues) => {
    if (!activeSection) return;

    clearFeedback();

    try {
      if (modalMode === 'edit' && selectedItem) {
        const payload: SettingsCatalogUpdateInput = {
          name: values.name,
          icon: values.icon,
          color: values.color,
          stroke: values.stroke,
          sortOrder: values.sortOrder,
          status: values.status
        };

        await updateMutation.mutateAsync({
          id: selectedItem.id,
          data: payload
        });

        setFeedback({
          type: 'success',
          message: 'Cadastro atualizado com sucesso.'
        });
      } else {
        const payload: SettingsCatalogCreateInput = {
          group: activeSection.group,
          name: values.name,
          workspaceScope: activeSection.group === 'cost_center'
            ? 'PJ'
            : activeSection.group === 'investment_class' || activeSection.group === 'investment_strategy'
              ? activeWorkspace.type
              : 'both',
          transactionSubtype: activeSection.supportsTransactionSubtype
            ? transactionSubtype
            : undefined,
          icon: values.icon,
          color: values.color,
          stroke: values.stroke,
          sortOrder: values.sortOrder,
          status: values.status ?? 'active'
        };

        await createMutation.mutateAsync(payload);

        setFeedback({
          type: 'success',
          message: 'Cadastro criado com sucesso.'
        });
      }

      closeModal();
    } catch {
      setFeedback({
        type: 'error',
        message: 'Não foi possível salvar o cadastro. Revise os dados e tente novamente.'
      });
    }
  };

  const removeItem = async (item: SettingsCatalogItem) => {
    clearFeedback();

    try {
      await deleteMutation.mutateAsync(item.id);

      setFeedback({
        type: 'success',
          message: `“${item.name}” foi inativado com sucesso.`
      });
    } catch {
      setFeedback({
        type: 'error',
        message: 'Não foi possível inativar o cadastro. Tente novamente.'
      });
    }
  };

  const isLoading =
    query.isLoading ||
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  return {
    sections,
    activeSection,
    activeSectionKey,
    setActiveSectionKey,
    search,
    setSearch,
    includeInactive,
    setIncludeInactive,
    transactionSubtype,
    setTransactionSubtype,
    items,
    rawItems: query.data?.items ?? [],
    stats,
    feedback,
    clearFeedback,
    error: query.error,
    isLoading,
    isFetching: query.isFetching,
    hasPreviousPage: pageCursor !== null,
    hasNextPage: query.data?.nextCursor !== null,
    firstPage: () => setPageCursor(null),
    nextPage: () => {
      if (query.data?.nextCursor) setPageCursor(query.data.nextCursor);
    },
    isModalOpen,
    modalMode,
    selectedItem,
    openCreateModal,
    openEditModal,
    closeModal,
    submitItem,
    removeItem
  };
};
