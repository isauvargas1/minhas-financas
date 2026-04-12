import { useEffect, useMemo, useState } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  useCreateSettingsCatalogItem,
  useDeleteSettingsCatalogItem,
  useSettingsCatalog,
  useUpdateSettingsCatalogItem
} from './hooks';
import {
  buildSettingsCatalogStats,
  filterSectionsByWorkspaceType,
  getSettingsCatalogSectionByKey,
  matchesSettingsCatalogSearch,
  sortSettingsCatalogForDisplay,
  type SettingsCatalogSectionKey
} from './presentation';
import type {
  SettingsCatalogCreateInput,
  SettingsCatalogItem,
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

  const sections = useMemo(
    () => filterSectionsByWorkspaceType(activeWorkspace.type),
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

  useEffect(() => {
    const activeSectionExists = sections.some(
      (section) => section.key === activeSectionKey
    );

    if (!activeSectionExists && sections.length > 0) {
      setActiveSectionKey(sections[0].key);
    }
  }, [activeSectionKey, sections]);

  const activeSection =
    getSettingsCatalogSectionByKey(activeSectionKey) ?? sections[0];

  const query = useSettingsCatalog({
    group: activeSection?.group,
    includeInactive,
    transactionSubtype: activeSection?.supportsTransactionSubtype
      ? transactionSubtype
      : undefined
  });

  const items = useMemo(() => {
    const baseItems = query.data ?? [];
    const visibleItems = baseItems.filter((item) =>
      matchesSettingsCatalogSearch(item, search)
    );

    return sortSettingsCatalogForDisplay(visibleItems);
  }, [query.data, search]);

  const stats = useMemo(() => buildSettingsCatalogStats(query.data ?? []), [query.data]);

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
          workspaceScope: activeSection.group === 'cost_center' ? 'PJ' : 'both',
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
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o cadastro.';

      setFeedback({
        type: 'error',
        message
      });
    }
  };

  const removeItem = async (item: SettingsCatalogItem) => {
    clearFeedback();

    try {
      await deleteMutation.mutateAsync(item.id);

      setFeedback({
        type: 'success',
        message: `“${item.name}” foi removido com sucesso.`
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível remover o cadastro.';

      setFeedback({
        type: 'error',
        message
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
    rawItems: query.data ?? [],
    stats,
    feedback,
    clearFeedback,
    error: query.error,
    isLoading,
    isFetching: query.isFetching,
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