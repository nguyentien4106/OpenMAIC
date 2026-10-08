'use client';

import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  FolderPlus,
  ImagePlus,
  Pencil,
  Trash2,
  Search,
  Settings,
  Sun,
  Moon,
  Monitor,
  ChevronUp,
  Upload,
  Sparkles,
  Atom,
  X,
  Presentation,
  Loader2,
  FileText,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupInput, InputGroupButton } from '@/components/ui/input-group';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { useTheme } from '@/lib/hooks/use-theme';
import {
  courseGenerationUsable,
  requireModelCapabilities,
} from '@/lib/model-settings/capabilities';
import {
  RunApiError,
  discardGenerationRun,
  runApiErrorText,
} from '@/lib/generation-run-client/api';
import {
  RunStartRefusedError,
  startClassicRun,
  startDefinitelyRefused,
} from '@/lib/generation-run-client/start';
import {
  useCourseMaterials,
  type CourseMaterialMessage,
} from '@/lib/generation-run-client/use-course-materials';
import { useOwnerRuns } from '@/lib/generation-run-client/use-owner-runs';
import {
  courseRunHref,
  courseRunStatus,
  pendingCourseName,
  pendingCourseRuns,
  runsByCourse,
  type CourseRunStatus,
} from '@/lib/generation-run-client/course-card';
import type { RunSnapshot } from '@/lib/generation-run-client/types';
import { CourseRunStatusLabel } from '@/components/generation/course-run-status-label';
import { useModelCapabilities } from '@/lib/model-settings/use-model-settings';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  StageListItem,
  listStages,
  deleteStageData,
  renameStage,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  setStageFolder,
  FolderNameError,
  LIBRARY_CHANGED_EVENT,
  type DeleteFolderMode,
} from '@/lib/utils/stage-storage';
import type { FolderRecord } from '@/lib/types/folder';
import { displayNameWidth, FOLDER_NAME_MAX_WIDTH } from '@/lib/utils/folder-name-validation';
import { FolderCard } from '@/components/discovery/folder-card';
import { NewFolderDialog } from '@/components/discovery/folder-dialogs';
import { MoveToFolderMenu } from '@/components/discovery/move-to-folder-menu';
import { LibrarySkeleton } from '@/components/discovery/library-skeleton';
import { SlideThumbnail } from '@/components/slide-renderer/SlideThumbnail';
import type { Slide } from '@openmaic/dsl';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCourseThumbnails } from '@/lib/hooks/use-course-thumbnails';
import { ThumbnailSkeleton } from '@/components/discovery/thumbnail-skeleton';
import { useNearViewport } from '@/lib/hooks/use-near-viewport';
import { SpeechButton } from '@/components/audio/speech-button';
import { useImportClassroom } from '@/lib/import/use-import-classroom';
import {
  isProWorkbenchEnabled,
  isPptxImportEnabled,
  shouldShowVocationalTestUi,
} from '@/lib/config/feature-flags';
import { useImportPptx } from '@/lib/import/use-import-pptx';
import { InteractiveModeButton } from '@/components/generation/interactive-mode-button';
import { ProBadge } from '@/components/workbench/ProBadge';
import { arrivedByProSwap, startProSwap } from '@/lib/workbench/pro-swap';
import {
  readLastWorkspaceSessionId,
  workspaceResumeHref,
} from '@/lib/workbench/workspace-session-memory';

const log = createLogger('Home');

const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';
const INTERACTIVE_MODE_STORAGE_KEY = 'interactiveModeEnabled';

// PPTX import is still scaffolding: `useImportPptx` has no `onImported` consumer
// yet, so the flow only logs the parsed slides. Hide the entry point behind a
// flag until it's wired end-to-end, so the UI doesn't expose a no-op button.
const PPTX_IMPORT_ENABLED = isPptxImportEnabled();

/** The configured runtime probe result, retained across client navigations. */
let workbenchRuntimeCache: boolean | null = null;

interface FormState {
  requirement: string;
  interactiveMode: boolean;
  vocationalTestMode: boolean;
}

const initialFormState: FormState = {
  requirement: '',
  interactiveMode: false,
  vocationalTestMode: false,
};

function HomePage() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  // Do not replay the classic hero's entrance after the route handoff already
  // carried the lockup and composer into place. The entrance is CSS, not a
  // JS-driven animation, so the server-rendered hero is painted (and fades in)
  // before the page's scripts have loaded instead of staying invisible.
  const [swapped] = useState(arrivedByProSwap);
  const heroEnter = (classes: string) =>
    swapped
      ? undefined
      : `animate-in fill-mode-both ease-out motion-reduce:animate-none ${classes}`;
  const showVocationalTestUi = shouldShowVocationalTestUi();
  const workbenchBuildEnabled = isProWorkbenchEnabled();
  const [workbenchRuntimeEnabled, setWorkbenchRuntimeEnabled] = useState(
    workbenchRuntimeCache === true,
  );
  useEffect(() => {
    if (!workbenchBuildEnabled || workbenchRuntimeCache !== null) return;
    let cancelled = false;
    fetch('/api/agent/runtime')
      .then((response) => {
        // Not cached: a 401 before the access code is accepted is not an answer.
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((body) => {
        workbenchRuntimeCache = body?.enabled === true;
        if (!cancelled) setWorkbenchRuntimeEnabled(workbenchRuntimeCache);
      })
      .catch(() => {
        // A failed probe keeps the entry hidden and allows a later visit to retry.
      });
    return () => {
      cancelled = true;
    };
  }, [workbenchBuildEnabled]);
  const workbenchEntryEnabled = workbenchBuildEnabled && workbenchRuntimeEnabled;
  const enterWorkbench = () => {
    const href = workspaceResumeHref(readLastWorkspaceSessionId());
    startProSwap(href, (next) => router.push(next));
  };
  useEffect(() => {
    if (workbenchEntryEnabled) router.prefetch('/workspace');
  }, [router, workbenchEntryEnabled]);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  // Generation needs the course slots it resolves (outline, content, actions)
  // to name a model, whether or not the llm root does (the server's view;
  // while it cannot be read the server has the last word).
  const hasUsableProvider = courseGenerationUsable(useModelCapabilities());
  const [recentOpen, setRecentOpen] = useState(true);
  const persistRecentOpen = (next: boolean) => {
    setRecentOpen(next);
    try {
      localStorage.setItem(RECENT_OPEN_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  // Hydrate client-only state after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setRecentOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
    try {
      const savedInteractiveMode = localStorage.getItem(INTERACTIVE_MODE_STORAGE_KEY);
      if (savedInteractiveMode === 'true') {
        setForm((prev) => ({ ...prev, interactiveMode: true }));
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while the Generate click starts the run. Doubles as the guard flag
  // that freezes the course material set for the duration of the start and as
  // the switch that disables the toolbar's add/remove/Retry affordances, so
  // the run is always started from a set that cannot change under it.
  const [preparingGenerate, setPreparingGenerate] = useState(false);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  // First-slide thumbnails load lazily, per card near the viewport: the list
  // renders as soon as /api/stages answers, never behind every course's
  // document and media.
  const { thumbnails, requestThumbnail, retainThumbnails } = useCourseThumbnails();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Course folders — device-local grouping. `currentFolderId === undefined`
  // is the root view (folders + unfiled courses); a folder id navigates into
  // that folder's course list. Searching flattens every course regardless of
  // folder and annotates each with its folder name.
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  // True once the initial classroom + folder loads resolve. Guards layout
  // selection so the hero does not flip between full-screen and compact as the
  // two async reads land (avoids a visible layout shift on first paint).
  const [hydrated, setHydrated] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  // When set, the new-folder dialog is creating a folder AND moving this course
  // into it (entered via the move-menu's "new folder" entry).
  const [createAndMoveTarget, setCreateAndMoveTarget] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!themeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen]);

  const loadClassrooms = async () => {
    try {
      const list = await listStages();
      setClassrooms(list);
      retainThumbnails(new Set(list.map((c) => c.id)));
    } catch (err) {
      log.error('Failed to load classrooms:', err);
      toast.error('Persistence is unavailable. Saved classrooms could not be loaded.');
    }
  };

  // Courses being generated on the server: a card from the moment the run
  // starts, live through the owner's run stream.
  const { runs, forget: forgetRun } = useOwnerRuns({
    onCourseChanged: () => void loadClassrooms(),
  });

  const loadFolders = async () => {
    try {
      setFolders(await listFolders());
    } catch (err) {
      log.error('Failed to load folders:', err);
    }
  };

  // Capture the active folder when an import starts so the imported course
  // lands in that folder, not whichever folder is active when the async import
  // resolves (the user may have navigated away in the meantime).
  const importFolderRef = useRef<string | undefined>(undefined);
  const handleImportSuccess = async (importedStageId: string) => {
    const folderId = importFolderRef.current;
    importFolderRef.current = undefined;
    // File the imported course into the folder that was active when the
    // import began, before refreshing the list so the card appears in place.
    if (folderId) {
      try {
        await setStageFolder(importedStageId, folderId);
      } catch (err) {
        log.error('Failed to assign imported course to folder:', err);
        toast.error(t('classroom.moveFailed'));
      }
    }
    await loadClassrooms();
  };
  const { importing, fileInputRef, triggerFileSelect, handleFileChange } =
    useImportClassroom(handleImportSuccess);
  const triggerImport = () => {
    importFolderRef.current = currentFolderId;
    triggerFileSelect();
  };

  const {
    importing: pptxImporting,
    fileInputRef: pptxFileInputRef,
    triggerFileSelect: triggerPptxFileSelect,
    handleFileChange: handlePptxFileChange,
  } = useImportPptx();

  useEffect(() => {
    // Clear stale media store to prevent cross-course thumbnail contamination.
    // The store may hold tasks from a previously visited classroom whose elementIds
    // (gen_img_1, etc.) collide with other courses' placeholders.
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // Read sessionStorage on the client only (avoids SSR hydration mismatch).
    // Both reads resolve before flipping `hydrated`, so the hero layout does
    // not thrash as each lands independently.
    void Promise.all([loadClassrooms(), loadFolders()]).finally(() => setHydrated(true));

    // Courses can arrive in the background (the one-way import of what this
    // browser stored before persistence moved to the server).
    const onLibraryChanged = () => {
      void Promise.all([loadClassrooms(), loadFolders()]);
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);

    return () => {
      window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    };
  }, []);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmDelete = async (id: string) => {
    setPendingDeleteId(null);
    try {
      // A card whose course does not exist yet is its run: discarding the run
      // deletes it. Deleting a course ends its run.
      const pendingRun = runs.find((run) => run.id === id);
      if (pendingRun) {
        await discardGenerationRun(id);
        forgetRun(id);
        return;
      }
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await renameStage(id, newName);
      setClassrooms((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    } catch (err) {
      log.error('Failed to rename classroom:', err);
      toast.error(t('classroom.renameFailed'));
    }
  };

  // ─── Folder handlers ────────────────────────────────────────────────
  const handleCreateFolder = async (name: string) => {
    const folder = await createFolder(name);
    setFolders((prev) => [...prev, folder]);
    // If this create came from the move-menu's "new folder" entry, move the
    // requesting course into the freshly created folder.
    if (createAndMoveTarget) {
      await handleMoveCourse(createAndMoveTarget, folder.id);
      setCreateAndMoveTarget(null);
    }
  };

  const handleRenameFolder =
    (folder: FolderRecord) =>
    async (newName: string): Promise<string | null> => {
      // Empty or unchanged input just exits editing without an error.
      const trimmed = newName.trim();
      if (!trimmed || trimmed === folder.name) return null;
      try {
        await renameFolder(folder.id, newName);
        setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, name: trimmed } : f)));
        return null;
      } catch (err) {
        if (err instanceof FolderNameError) {
          if (err.kind === 'duplicate') return t('classroom.folderNameExists');
          if (err.kind === 'tooLong')
            return t('classroom.folderWidth', {
              width: displayNameWidth(trimmed),
              max: FOLDER_NAME_MAX_WIDTH,
            });
          return t('classroom.folderNameHint');
        }
        log.error('Failed to rename folder:', err);
        return t('classroom.folderRenameFailed');
      }
    };

  const confirmDeleteFolder = async (folder: FolderRecord, mode: DeleteFolderMode) => {
    try {
      await deleteFolder(folder.id, mode);
      if (currentFolderId === folder.id) setCurrentFolderId(undefined);
    } catch (err) {
      log.error('Failed to delete folder:', err);
      toast.error(t('classroom.folderDeleteFailed'));
    } finally {
      // Always refresh authoritative state: in 'remove' mode a partial failure
      // may have durably deleted some courses before throwing, and the UI must
      // reflect that rather than leaving stale cards/counts behind.
      await Promise.all([loadFolders(), loadClassrooms()]);
    }
  };

  const handleMoveCourse = async (stageId: string, folderId: string | undefined) => {
    // Optimistic update for snappy UI; the persistence call follows.
    setClassrooms((prev) => prev.map((c) => (c.id === stageId ? { ...c, folderId } : c)));
    try {
      await setStageFolder(stageId, folderId);
    } catch (err) {
      log.error('Failed to move course:', err);
      toast.error(t('classroom.moveFailed'));
      // Revert on failure.
      await loadClassrooms();
    }
  };

  // From the move-menu's "new folder" entry: remember the course, then open the
  // folder dialog. The actual create+move happens in handleCreateFolder once the
  // name is confirmed. (A Radix DropdownMenu is modal, so the name input cannot
  // live inside it; the dialog is the focus surface.)
  const handleCreateAndMove = (stageId: string) => () => {
    setCreateAndMoveTarget(stageId);
    setNewFolderOpen(true);
  };

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const filteredClassrooms = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    if (!q) return classrooms;
    return classrooms.filter((c) => {
      const name = c.name?.toLowerCase() ?? '';
      const desc = c.description?.toLowerCase() ?? '';
      return name.includes(q) || desc.includes(q);
    });
  }, [classrooms, deferredSearchQuery]);

  // Folder-aware view model. Searching collapses the hierarchy: every matching
  // course is shown flat, annotated with its folder name. Otherwise the root
  // view shows folder tiles + unfiled courses, and a folder view shows only
  // that folder's members.
  const folderNameById = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const isSearching = deferredSearchQuery.trim().length > 0;
  // The course tiles rendered in the active view: search flattens everything;
  // a folder shows only its members; the root shows unfiled courses (folder
  // tiles are rendered separately above them).
  const visibleClassrooms = useMemo(() => {
    if (isSearching) return filteredClassrooms;
    if (currentFolderId) return filteredClassrooms.filter((c) => c.folderId === currentFolderId);
    return filteredClassrooms.filter(
      (c) => c.folderId === undefined || !folderNameById.has(c.folderId),
    );
  }, [filteredClassrooms, isSearching, currentFolderId, folderNameById]);
  const currentFolderClassrooms = useMemo(
    () => (currentFolderId ? classrooms.filter((c) => c.folderId === currentFolderId) : []),
    [classrooms, currentFolderId],
  );
  const courseCountByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of classrooms) {
      if (c.folderId) counts.set(c.folderId, (counts.get(c.folderId) ?? 0) + 1);
    }
    return counts;
  }, [classrooms]);
  // Up to 3 member course covers (first-slide thumbnails) per folder, for the
  // folder tile's cover stack. Members are ordered by updatedAt desc so the
  // frontmost cover is the most recently touched course. The members that
  // fill (or, not loaded yet, may fill) those 3 slots are the tile's cover
  // candidates: it loads their thumbnails while it is near the viewport, and a
  // member without a slide gives its slot to the next one.
  const folderCovers = useMemo(() => {
    const byFolder = new Map<string, { slides: Slide[]; candidates: StageListItem[] }>();
    for (const c of [...classrooms].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (!c.folderId) continue;
      const covers = byFolder.get(c.folderId) ?? { slides: [], candidates: [] };
      byFolder.set(c.folderId, covers);
      if (covers.candidates.length >= 3) continue;
      const slide = thumbnails[c.id];
      if (slide === null) continue;
      covers.candidates.push(c);
      if (slide) covers.slides.push(slide);
    }
    return byFolder;
  }, [classrooms, thumbnails]);
  const currentFolder = folders.find((f) => f.id === currentFolderId);

  const listedStageIds = useMemo(() => new Set(classrooms.map((c) => c.id)), [classrooms]);
  const runByStageId = useMemo(() => runsByCourse(runs), [runs]);
  // Runs whose course is not in the library yet are cards of their own.
  const pendingRuns = useMemo(
    () => pendingCourseRuns(runs, listedStageIds),
    [runs, listedStageIds],
  );
  const showPendingRuns = !isSearching && currentFolderId === undefined;

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'interactiveMode')
        localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, String(value));
    } catch {
      /* ignore */
    }
  };

  // Attached materials upload and extract at once; Generate waits for them.
  const courseMaterials = useCourseMaterials();
  const materialMessage = (message: CourseMaterialMessage) =>
    message.text ?? (message.key ? t(message.key, message.values) : '');

  const addCourseMaterials = async (files: File[]) => {
    // The set is frozen while a run is being started.
    if (preparingGenerate) return;
    const refusal = await courseMaterials.add(files);
    setError(refusal ? materialMessage(refusal) : null);
  };

  const removeCourseMaterial = (id: string) => {
    if (preparingGenerate) return;
    courseMaterials.remove(id);
  };

  const handleGenerate = async () => {
    // No model/provider guard here: generation is gated by `canGenerate`
    // (requires a usable provider), and under the #580 invariant a usable
    // provider always has a concrete model. State A (no usable provider)
    // surfaces through the toolbar's single Configure-Provider affordance.
    if (preparingGenerate) return;
    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    setError(null);

    // The set is frozen while the run starts (`preparingGenerate` makes add,
    // remove and Retry inert), from the ready materials in their order.
    setPreparingGenerate(true);
    // The run releases the materials it is started from once it is over.
    // Handed off before anything is awaited: a navigation in between must not
    // delete them under the run.
    const materialIds = courseMaterials.handOff();
    try {
      // Nothing is started from settings that could not be read.
      const capabilities = await requireModelCapabilities();
      if (!capabilities) throw new Error(t('generation.modelSettingsUnavailable'));
      // Nor from a material that went meanwhile: its chip shows it removed.
      if (materialIds.length > 0 && !(await courseMaterials.verify())) {
        throw new Error(t('toolbar.materialUnavailable'));
      }
      const run = await startClassicRun({
        requirement: form.requirement,
        materialIds,
        interactive: form.vocationalTestMode ? true : form.interactiveMode,
        taskEngine: form.vocationalTestMode,
        capabilities,
      });
      router.push(`/generation-preview?run=${encodeURIComponent(run.id)}`);
    } catch (err) {
      log.error('Error starting generation:', err);
      // Only a definitive refusal says no run holds them: they stay attached.
      // A lost answer may hide a run that releases them when it is over.
      if (!(err instanceof RunApiError) || startDefinitelyRefused(err)) {
        courseMaterials.takeBack(materialIds);
      }
      if (err instanceof RunStartRefusedError) {
        setError(t(err.reason, err.values));
      } else if (err instanceof RunApiError) {
        setError(runApiErrorText(err, t));
      } else {
        setError(err instanceof Error ? err.message : t('upload.generateFailed'));
      }
    } finally {
      // Unfreeze the set once prep settles (navigation unmounts this page, so
      // this is normally a no-op on the way out).
      setPreparingGenerate(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('classroom.today');
    if (diffDays === 1) return t('classroom.yesterday');
    if (diffDays < 7) return `${diffDays} ${t('classroom.daysAgo')}`;
    return date.toLocaleDateString();
  };

  // Generate waits for every attached material to be uploaded and extracted.
  const canGenerate = !!form.requirement.trim() && hasUsableProvider && courseMaterials.allReady;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate && !preparingGenerate) handleGenerate();
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16 overflow-x-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        onChange={handleFileChange}
        className="hidden"
      />
      {PPTX_IMPORT_ENABLED && (
        <input
          ref={pptxFileInputRef}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={handlePptxFileChange}
          className="hidden"
        />
      )}
      {/* ═══ Top Header Bar — Quiet Paper on Slate, 1px Hairline ═══ */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/95 backdrop-blur-sm transition-colors">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* Left: Brand & School Board Identity */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-display text-base font-bold tracking-tight text-foreground flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-full bg-primary" />
                OpenMAIC
              </span>
              <span className="rounded-[4px] border border-border bg-muted/70 px-1.5 py-0.5 font-display text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                EduCore Studio
              </span>
            </div>
            <div className="hidden h-4 w-px bg-border sm:block" />
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline-block">
              {t('home.slogan')}
            </span>
          </div>

          {/* Right: Controls & Actions */}
          <div ref={toolbarRef} className="flex items-center gap-1.5">
            {workbenchEntryEnabled && (
              <div data-pro-morph="badge" className="mr-1">
                <ProBadge active={false} onToggle={enterWorkbench} />
              </div>
            )}

            {/* Language Selector */}
            <LanguageSwitcher onOpen={() => setThemeOpen(false)} />

            <div className="h-4 w-px bg-border mx-0.5" />

            {/* Theme Selector */}
            <div className="relative">
              <button
                type="button"
                aria-label={t('settings.theme')}
                onClick={() => setThemeOpen(!themeOpen)}
                className="flex size-8 items-center justify-center rounded-[6px] border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
              >
                {theme === 'light' && <Sun className="size-4" />}
                {theme === 'dark' && <Moon className="size-4" />}
                {theme === 'system' && <Monitor className="size-4" />}
              </button>
              {themeOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[130px] overflow-hidden rounded-[6px] border border-border bg-card p-1 shadow-none">
                  <button
                    type="button"
                    onClick={() => {
                      setTheme('light');
                      setThemeOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-xs transition-colors',
                      theme === 'light'
                        ? 'bg-primary/10 text-primary font-semibold dark:bg-primary/20'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <Sun className="size-3.5" />
                    {t('settings.themeOptions.light')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTheme('dark');
                      setThemeOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-xs transition-colors',
                      theme === 'dark'
                        ? 'bg-primary/10 text-primary font-semibold dark:bg-primary/20'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <Moon className="size-3.5" />
                    {t('settings.themeOptions.dark')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTheme('system');
                      setThemeOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-xs transition-colors',
                      theme === 'system'
                        ? 'bg-primary/10 text-primary font-semibold dark:bg-primary/20'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <Monitor className="size-3.5" />
                    {t('settings.themeOptions.system')}
                  </button>
                </div>
              )}
            </div>

            <div className="h-4 w-px bg-border mx-0.5" />

            {/* Settings Button */}
            <button
              type="button"
              aria-label={t('settings.title')}
              onClick={() => setSettingsOpen(true)}
              className="flex size-8 items-center justify-center rounded-[6px] border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
            >
              <Settings className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      {/* ═══ Hero section: The School Board & Generation Composer ═══ */}
      <div
        className={cn(
          'relative z-20 w-full max-w-[840px] flex flex-col items-center mt-6 sm:mt-10 px-4',
          heroEnter('fade-in slide-in-from-bottom-5 duration-600'),
        )}
      >
        {/* ── Category Pill & Title ── */}
        <div className="flex flex-col items-center text-center mb-6" data-pro-morph="lockup">
          <span className="font-display text-[11px] font-bold tracking-[0.06em] uppercase text-primary mb-2">
            The School Board · Bảng Điều Hành Bài Giảng
          </span>
          <div className="relative flex items-center justify-center">
            <img
              src="/logo-horizontal.png"
              alt="OpenMAIC"
              className={cn(
                'h-10 sm:h-12 md:h-14 mb-2',
                heroEnter('fade-in zoom-in-90 duration-500 delay-100'),
              )}
            />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-lg mt-1 font-body">
            {t('home.slogan')}
          </p>
        </div>

        {/* ── Segmented StatStrip (The Number-First Rule §1.1 & §5.2) ── */}
        <div className="w-full mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 rounded-[6px] border border-border bg-card overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-border shadow-none">
            <div className="p-3 sm:p-3.5 relative">
              <div className="font-display text-2xl font-bold text-foreground tabular-nums">
                {classrooms.length}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-0.5">
                {t('classroom.recentClassrooms')}
              </div>
            </div>

            <div className={cn(
              "p-3 sm:p-3.5 relative",
              pendingRuns.length > 0 && "before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-[3px] before:bg-primary"
            )}>
              <div className="font-display text-2xl font-bold text-foreground tabular-nums flex items-center gap-1.5">
                {pendingRuns.length}
                {pendingRuns.length > 0 && (
                  <span className="size-2 rounded-full bg-primary animate-pulse" />
                )}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-0.5">
                {pendingRuns.length > 0 ? "Hàng đợi xử lý" : "Đang thực thi"}
              </div>
            </div>

            <div className="p-3 sm:p-3.5 relative">
              <div className="font-display text-2xl font-bold text-foreground tabular-nums">
                {folders.length}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-0.5">
                {t('classroom.folderBadge')}
              </div>
            </div>

            <div className="p-3 sm:p-3.5 relative">
              <div className="font-display text-2xl font-bold text-foreground tabular-nums">
                {showVocationalTestUi ? "Đa vai trò" : "3+"}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-0.5">
                Tác tử sư phạm
              </div>
            </div>
          </div>
        </div>

        {/* ── Unified input area (Zero operational shadows, 6px radius) ── */}
        <div className={cn('w-full', heroEnter('fade-in zoom-in-97 duration-300 delay-350'))}>
          <div
            data-pro-morph="composer"
            className="w-full rounded-[6px] border border-border bg-card shadow-none transition-colors focus-within:border-primary/50"
          >
            {/* ── Greeting + Profile + Agents ── */}
            <div className="relative z-20 flex items-start justify-between border-b border-border/60">
              <GreetingBar />
              <div className="pr-3 pt-3 shrink-0">
                <AgentBar />
              </div>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              placeholder={t('upload.requirementPlaceholder')}
              className="w-full resize-none border-0 bg-transparent px-4 pt-3 pb-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none min-h-[130px] max-h-[300px] font-body"
              value={form.requirement}
              onChange={(e) => updateForm('requirement', e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
            />

            {/* Toolbar row */}
            <div className="px-3 pb-3 flex items-end gap-2 border-t border-border/40 pt-2.5">
              <div className="flex-1 min-w-0">
                <GenerationToolbar
                  courseMaterials={courseMaterials.materials}
                  onCourseMaterialsAdd={(files) => void addCourseMaterials(files)}
                  onCourseMaterialRemove={removeCourseMaterial}
                  onCourseMaterialRetry={(id) => {
                    if (!preparingGenerate) courseMaterials.retry(id);
                  }}
                  onPdfError={setError}
                  materialsLocked={preparingGenerate}
                  onSettingsOpen={(section) => {
                    setSettingsSection(section);
                    setSettingsOpen(true);
                  }}
                />
              </div>

              {/* Interactive mode toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <InteractiveModeButton
                    pressed={form.interactiveMode}
                    label={t('toolbar.interactiveModeLabel')}
                    onPressedChange={(pressed) => updateForm('interactiveMode', pressed)}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t('toolbar.interactiveModeHint')}
                </TooltipContent>
              </Tooltip>

              {/* Voice input */}
              <SpeechButton
                size="md"
                onTranscription={(text) => {
                  setForm((prev) => {
                    const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                    return { ...prev, requirement: next };
                  });
                }}
              />

              {/* Send button — Red reserved for action §1.1 */}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || preparingGenerate}
                className={cn(
                  'shrink-0 h-8 rounded-[6px] flex items-center justify-center gap-1.5 transition-colors px-3.5 font-semibold text-xs cursor-pointer',
                  canGenerate && !preparingGenerate
                    ? 'bg-primary text-primary-foreground hover:bg-primary-dark active:bg-[#991b1b] shadow-none'
                    : 'bg-muted text-muted-foreground/50 cursor-not-allowed',
                )}
              >
                <span>
                  {preparingGenerate ? t('stage.generating') : t('toolbar.enterClassroom')}
                </span>
                {preparingGenerate ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {showVocationalTestUi && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-2 flex w-full justify-start px-1"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.vocationalTestMode}
                  onClick={() => updateForm('vocationalTestMode', !form.vocationalTestMode)}
                  className={cn(
                    'inline-flex h-7 items-center gap-2 rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors',
                    form.vocationalTestMode
                      ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
                      : 'border-border bg-background text-muted-foreground hover:border-slate-300 dark:hover:border-slate-700 hover:text-foreground',
                  )}
                >
                  <span className="rounded-[4px] bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-sky-800 dark:bg-sky-900/60 dark:text-sky-300">
                    测试功能
                  </span>
                  <Sparkles className="size-3.5" />
                  <span>职教任务</span>
                  <span
                    className={cn(
                      'relative h-3.5 w-6 rounded-full transition-colors',
                      form.vocationalTestMode ? 'bg-primary' : 'bg-muted-foreground/30',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 size-2.5 rounded-full bg-white transition-transform',
                        form.vocationalTestMode ? 'translate-x-2.5' : 'translate-x-0',
                      )}
                    />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                从当前输入框提交职教实操训练测试
              </TooltipContent>
            </Tooltip>
          </motion.div>
        )}

        {/* ── Error ── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
            >
              <p className="text-sm text-destructive">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ Recent classrooms — collapsible ═══ */}
      {/* The library action bar is always present: it carries the New-folder /
          import / search actions, so a brand-new user with zero courses and
          zero folders can still create the first folder or import. One stable
          action surface across root, folder, and empty. Until the library and
          folder reads resolve, the section shows a skeleton of its own layout
          (server-rendered, so it is on screen before the page's scripts run). */}
      <div className="relative z-10 mt-10 w-full max-w-6xl flex flex-col items-center">
        {/* Unified FilterToolbar container matching EduCore §5.3 */}
        <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-2 sm:px-3 sm:py-2 rounded-[6px] border border-border bg-card shadow-none">
          {/* Left: Title, Folder Path, Count badge, Accordion toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (currentFolderId) setCurrentFolderId(undefined);
                else persistRecentOpen(!recentOpen);
              }}
              className="flex items-center gap-2 text-[13px] font-semibold text-foreground hover:text-foreground/80 transition-colors cursor-pointer select-none"
            >
              <Clock className="size-4 text-primary" />
              <span>{t('classroom.recentClassrooms')}</span>
              {currentFolder && (
                <>
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                  <span className="text-foreground/80 truncate max-w-[160px] font-normal">
                    {currentFolder.name}
                  </span>
                </>
              )}
              {hydrated ? (
                <span className="inline-flex items-center rounded-[4px] border border-border bg-muted/60 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">
                  {currentFolder ? currentFolderClassrooms.length : classrooms.length}
                </span>
              ) : (
                <span
                  aria-hidden
                  className="h-4 w-6 rounded-[4px] bg-muted animate-pulse"
                />
              )}
              <motion.div
                animate={{ rotate: recentOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="text-muted-foreground ml-1"
              >
                <ChevronDown className="size-3.5" />
              </motion.div>
            </button>
          </div>

          {/* Right: Operational Toolbar (Search, Import, New Folder) */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative flex items-center">
              <Search className="size-3.5 absolute left-2.5 text-muted-foreground pointer-events-none" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!recentOpen) persistRecentOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && searchQuery) {
                    e.preventDefault();
                    setSearchQuery('');
                  }
                }}
                placeholder={t('classroom.searchPlaceholder')}
                aria-label={t('classroom.searchAriaLabel')}
                className="h-8 w-44 sm:w-56 pl-8 pr-7 text-xs rounded-[6px] border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label={t('classroom.clearSearch')}
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Import Classroom Button */}
            <button
              type="button"
              onClick={triggerImport}
              disabled={importing}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors cursor-pointer disabled:opacity-50"
              title={t('import.classroom')}
            >
              <Upload className="size-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">{t('import.classroom')}</span>
            </button>

            {/* PPTX Import Button */}
            {PPTX_IMPORT_ENABLED && (
              <button
                type="button"
                onClick={triggerPptxFileSelect}
                disabled={pptxImporting}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors cursor-pointer disabled:opacity-50"
                title={t('import.pptx')}
              >
                <Presentation className="size-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">{t('import.pptx')}</span>
              </button>
            )}

            {/* New folder button */}
            {!currentFolderId && !isSearching && (
              <button
                type="button"
                onClick={() => {
                  if (!recentOpen) persistRecentOpen(true);
                  setNewFolderOpen(true);
                }}
                aria-label={t('classroom.newFolderTitle')}
                title={t('classroom.newFolderTitle')}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors cursor-pointer"
              >
                <FolderPlus className="size-3.5 text-primary" />
                <span className="hidden sm:inline">{t('classroom.newFolderTitle')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Expandable content. Present from the first render, so it does not
              play its expand animation then: the server-rendered skeleton must
              be visible without the page's scripts. */}
        <AnimatePresence initial={false}>
          {recentOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
              className="w-full overflow-hidden"
            >
              {!hydrated ? (
                <LibrarySkeleton />
              ) : folders.length === 0 && classrooms.length === 0 && pendingRuns.length === 0 ? (
                <div className="pt-8 pb-2 text-center text-[13px] text-muted-foreground/60">
                  {t('classroom.emptyLibraryHint')}
                </div>
              ) : !isSearching && currentFolderId && currentFolderClassrooms.length === 0 ? (
                // Empty folder: hint directly below the centered path bar.
                <div className="pt-8 text-center">
                  <p className="text-[14px] text-muted-foreground">
                    {t('classroom.emptyFolderHint')}
                  </p>
                </div>
              ) : isSearching && filteredClassrooms.length === 0 ? (
                <div className="pt-8 pb-2 text-center text-[13px] text-muted-foreground/60">
                  {t('classroom.searchEmpty')}
                </div>
              ) : (
                <div className="pt-8">
                  {/* Breadcrumb — shown only while searching (the folder path
                        already lives in the centered header above). */}
                  {isSearching && (
                    <div className="mb-4 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentFolderId(undefined);
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                        className="hover:text-foreground transition-colors"
                      >
                        {t('classroom.recentClassrooms')}
                      </button>
                      <ChevronRight className="size-3.5" />
                      <span className="text-foreground font-medium">
                        {t('classroom.searchResults')}
                      </span>
                      <span className="ml-1.5 text-[12px] text-muted-foreground tabular-nums">
                        ({filteredClassrooms.length})
                      </span>
                    </div>
                  )}

                  {/* No entrance when the grid first appears: it takes the
                      skeleton's place, and fading or staggering it in would
                      flash an empty section in between. Switching views (and
                      cards added later) still animate. */}
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={
                        isSearching
                          ? 'search'
                          : currentFolderId
                            ? `folder-${currentFolderId}`
                            : 'root'
                      }
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8"
                    >
                      {/* Root + non-search: render folder tiles first. */}
                      {!isSearching &&
                        currentFolderId === undefined &&
                        folders.map((folder, i) => (
                          <motion.div
                            key={folder.id}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04, duration: 0.35, ease: 'easeOut' }}
                          >
                            <FolderCard
                              folder={folder}
                              courseCount={courseCountByFolder.get(folder.id) ?? 0}
                              coverSlides={folderCovers.get(folder.id)?.slides ?? []}
                              coverCandidates={folderCovers.get(folder.id)?.candidates ?? []}
                              requestThumbnail={requestThumbnail}
                              onOpen={() => setCurrentFolderId(folder.id)}
                              onRename={handleRenameFolder(folder)}
                              onDelete={(mode) => confirmDeleteFolder(folder, mode)}
                              onDropCourse={(stageId) => handleMoveCourse(stageId, folder.id)}
                            />
                          </motion.div>
                        ))}

                      {/* Courses still being generated, before their course exists. */}
                      {showPendingRuns &&
                        pendingRuns.map((run) => (
                          <motion.div
                            key={run.id}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.35, ease: 'easeOut' }}
                          >
                            <ClassroomCard
                              classroom={pendingRunListItem(run)}
                              formatDate={formatDate}
                              runStatus={courseRunStatus(run)}
                              pendingCourse
                              onDelete={handleDelete}
                              onRename={handleRename}
                              confirmingDelete={pendingDeleteId === run.id}
                              onConfirmDelete={() => confirmDelete(run.id)}
                              onCancelDelete={() => setPendingDeleteId(null)}
                              onClick={() => router.push(courseRunHref(run))}
                            />
                          </motion.div>
                        ))}

                      {/* Course tiles for the active view. */}
                      {visibleClassrooms.map((classroom, i) => (
                        <motion.div
                          key={classroom.id}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04, duration: 0.35, ease: 'easeOut' }}
                        >
                          <ClassroomCard
                            classroom={classroom}
                            slide={thumbnails[classroom.id]}
                            requestThumbnail={requestThumbnail}
                            formatDate={formatDate}
                            runStatus={(() => {
                              const run = runByStageId.get(classroom.id);
                              return run ? courseRunStatus(run) : null;
                            })()}
                            onDelete={handleDelete}
                            onRename={handleRename}
                            confirmingDelete={pendingDeleteId === classroom.id}
                            onConfirmDelete={() => confirmDelete(classroom.id)}
                            onCancelDelete={() => setPendingDeleteId(null)}
                            onClick={() => {
                              const run = runByStageId.get(classroom.id);
                              router.push(run ? courseRunHref(run) : `/classroom/${classroom.id}`);
                            }}
                            overlay={
                              <>
                                <MoveToFolderMenu
                                  folders={folders}
                                  currentFolderId={classroom.folderId}
                                  onMove={(folderId) => handleMoveCourse(classroom.id, folderId)}
                                  onCreateAndMove={handleCreateAndMove(classroom.id)}
                                />
                                {/* Search view: show the owning folder as a badge. */}
                                {isSearching && classroom.folderId && (
                                  <span className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-[4px] border border-border bg-card/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground tabular-nums backdrop-blur-sm pointer-events-none">
                                    <Folder className="size-2.5 text-muted-foreground" />
                                    {folderNameById.get(classroom.folderId) ?? ''}
                                  </span>
                                )}
                              </>
                            }
                          />
                        </motion.div>
                      ))}
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Folder dialogs — mounted at the top level so they are reachable even
          while the Recent section is collapsed or the course list is empty. */}
      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={(open) => {
          setNewFolderOpen(open);
          if (!open) setCreateAndMoveTarget(null);
        }}
        folders={folders}
        onCreate={handleCreateFolder}
      />

      {/* Footer — flows with content, at the very end */}
      <div className="mt-auto pt-12 pb-4 text-center text-xs text-muted-foreground/40">
        OpenMAIC Open Source Project
      </div>
    </div>
  );
}

// ─── Greeting Bar — avatar + "Hi, Name", click to edit in-place ────
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

function GreetingBar() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = nickname || t('profile.defaultNickname');

  // Click-outside to collapse
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingName(false);
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div ref={containerRef} className="relative pl-4 pr-2 pt-3.5 pb-1 w-auto">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />

      {/* ── Collapsed pill (always in flow) ── */}
      {!open && (
        <div
          className="flex items-center gap-2 cursor-pointer transition-all duration-150 group rounded-[6px] px-2.5 py-1.5 border border-border bg-card hover:border-slate-400 dark:hover:border-slate-600 text-foreground"
          onClick={() => setOpen(true)}
        >
          <div className="shrink-0 relative">
            <div className="size-7 rounded-[4px] border border-border overflow-hidden group-hover:border-primary/60 transition-colors">
              <img src={avatar} alt="" className="size-full object-cover" />
            </div>
            <div className="absolute -bottom-1 -right-1 size-3.5 rounded-[3px] bg-background border border-border flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity">
              <Pencil className="size-[7px] text-muted-foreground" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="leading-none select-none flex items-center gap-1">
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {t('home.greetingWithName', { name: displayName })}
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t('profile.editTooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* ── Expanded panel (absolute, floating) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-4 top-3.5 z-50 w-64"
          >
            <div className="rounded-[6px] bg-card border border-border shadow-md px-3 py-2.5">
              {/* ── Row: avatar + name ── */}
              <div
                className="flex items-center gap-2.5 cursor-pointer transition-all duration-200"
                onClick={() => {
                  setOpen(false);
                  setEditingName(false);
                  setAvatarPickerOpen(false);
                }}
              >
                {/* Avatar */}
                <div
                  className="shrink-0 relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarPickerOpen(!avatarPickerOpen);
                  }}
                >
                  <div className="size-8 rounded-[4px] border border-border overflow-hidden transition-colors hover:border-primary/60">
                    <img src={avatar} alt="" className="size-full object-cover" />
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-1 -right-1 size-3.5 rounded-[3px] bg-background border border-border flex items-center justify-center"
                  >
                    <ChevronDown
                      className={cn(
                        'size-2 text-muted-foreground/70 transition-transform duration-200',
                        avatarPickerOpen && 'rotate-180',
                      )}
                    />
                  </motion.div>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName();
                          if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={commitName}
                        maxLength={20}
                        placeholder={t('profile.defaultNickname')}
                        className="flex-1 min-w-0 h-6 bg-transparent border-b border-primary text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
                      />
                      <button
                        onClick={commitName}
                        className="shrink-0 size-5 rounded-[4px] flex items-center justify-center text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditName();
                      }}
                      className="group/name inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-[13px] font-medium text-foreground transition-colors">
                        {displayName}
                      </span>
                      <Pencil className="size-2.5 text-muted-foreground/40 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    </span>
                  )}
                </div>

                {/* Collapse arrow */}
                <motion.div
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 size-6 rounded-[4px] flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors"
                >
                  <ChevronUp className="size-3.5" />
                </motion.div>
              </div>

              {/* ── Expandable content ── */}
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                {/* Avatar picker */}
                <AnimatePresence>
                  {avatarPickerOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-1 pb-2 flex items-center gap-1.5 flex-wrap">
                        {AVATAR_OPTIONS.map((url) => (
                          <button
                            key={url}
                            onClick={() => setAvatar(url)}
                            className={cn(
                              'size-7 rounded-[4px] overflow-hidden bg-muted border cursor-pointer transition-all duration-150',
                              'hover:scale-105 active:scale-95',
                              avatar === url
                                ? 'border-primary ring-1 ring-primary'
                                : 'border-border hover:border-slate-400 dark:hover:border-slate-600',
                            )}
                          >
                            <img src={url} alt="" className="size-full" />
                          </button>
                        ))}
                        <label
                          className={cn(
                            'size-7 rounded-[4px] flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                            'hover:scale-105 active:scale-95',
                            isCustomAvatar(avatar)
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground/60 hover:border-foreground/40',
                          )}
                          onClick={() => avatarInputRef.current?.click()}
                          title={t('profile.uploadAvatar')}
                        >
                          <ImagePlus className="size-3" />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bio */}
                <UITextarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                  className="resize-none border border-border bg-background/50 rounded-[6px] min-h-[72px] !text-[13px] !leading-relaxed placeholder:!text-[11px] placeholder:!leading-relaxed focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Classroom Card — clean, minimal style ──────────────────────
/** A card for a run whose course does not exist yet. */
function pendingRunListItem(run: RunSnapshot): StageListItem {
  return {
    id: run.id,
    name: pendingCourseName(run),
    sceneCount: run.progress.scenesCompleted,
    createdAt: Date.parse(run.createdAt),
    updatedAt: Date.parse(run.updatedAt),
    interactiveMode: run.input.interactive,
    taskEngineMode: run.input.taskEngine,
  };
}

function ClassroomCard({
  classroom,
  slide,
  requestThumbnail,
  formatDate,
  runStatus = null,
  pendingCourse = false,
  overlay,
  onDelete,
  onRename,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onClick,
}: {
  classroom: StageListItem;
  /** The first slide; null when the course has none, undefined until loaded. */
  slide?: Slide | null;
  /** Loads the thumbnail while the card is near the viewport (absent: nothing to load). */
  requestThumbnail?: (stageId: string, version: number) => () => void;
  formatDate: (ts: number) => string;
  /** The state of the run generating this course, while it runs. */
  runStatus?: CourseRunStatus | null;
  /** The card is a run whose course does not exist yet: it can only be opened or deleted. */
  pendingCourse?: boolean;
  /** Extra absolutely-positioned layers over the thumbnail (move menu, badges). */
  overlay?: React.ReactNode;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nearViewport = useNearViewport(thumbRef);

  useEffect(() => {
    if (!nearViewport || !requestThumbnail) return;
    return requestThumbnail(classroom.id, classroom.updatedAt);
  }, [nearViewport, requestThumbnail, classroom.id, classroom.updatedAt]);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const isTaskEngineMode = classroom.taskEngineMode === true;
  const showModeBadge = classroom.interactiveMode || isTaskEngineMode;
  const ModeBadgeIcon = isTaskEngineMode ? Sparkles : Atom;
  const modeBadgeLabel = isTaskEngineMode ? 'Vocational Mode' : t('toolbar.interactiveModeLabel');

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(classroom.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== classroom.name) {
      onRename(classroom.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      className="group cursor-pointer"
      onClick={confirmingDelete ? undefined : onClick}
      draggable={!confirmingDelete && !editing && !pendingCourse}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/stage-id', classroom.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        // Notify folder cards to clear any lingering drop highlight (Escape-
        // cancelled drags may not fire dragleave on every target).
        window.dispatchEvent(new CustomEvent('course-drag-end'));
      }}
    >
      {/* Thumbnail — 6px radius, 1px border, slate surface */}
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] rounded-[6px] border border-border bg-slate-50 dark:bg-slate-900 overflow-hidden transition-all duration-200 group-hover:border-slate-300 dark:group-hover:border-slate-700"
      >
        {slide && thumbWidth > 0 ? (
          <SlideThumbnail
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
          />
        ) : slide || (slide === undefined && requestThumbnail) ? (
          // Still loading, or loaded and waiting for the card's width.
          <ThumbnailSkeleton />
        ) : !slide ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-[6px] bg-muted border border-border flex items-center justify-center">
              <FileText className="size-6 text-muted-foreground" />
            </div>
          </div>
        ) : null}

        {showModeBadge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={modeBadgeLabel}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'absolute bottom-2 left-2 inline-flex items-center justify-center size-5 rounded-[4px] bg-background/90 border border-border backdrop-blur-sm z-10',
                  isTaskEngineMode
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-sky-600 dark:text-sky-400',
                )}
              >
                <ModeBadgeIcon className="size-3" />
              </span>
            </TooltipTrigger>
            {/* Negative sideOffset compensates for the global Tooltip Arrow's
                rotate-45 bounding box, which Radix reserves as spacing. */}
            <TooltipContent
              side="top"
              align="start"
              sideOffset={-4}
              collisionPadding={0}
              className="text-xs"
            >
              {modeBadgeLabel}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Delete — top-right, only on hover */}
        <AnimatePresence>
          {!confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/80 hover:bg-destructive text-white hover:text-white backdrop-blur-sm rounded-[6px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(classroom.id, e);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
              {!pendingCourse && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-11 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/80 hover:bg-slate-900 text-white hover:text-white backdrop-blur-sm rounded-[6px]"
                  onClick={startRename}
                >
                  <Pencil className="size-3.5" />
                </Button>
              )}
              {overlay}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline delete confirmation overlay */}
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[6px]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[13px] font-medium text-white/90">
                {t('classroom.deleteConfirmTitle')}?
              </span>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1 rounded-[6px] text-[12px] font-medium bg-white/15 text-white/80 hover:bg-white/25 backdrop-blur-sm transition-colors"
                  onClick={onCancelDelete}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="px-3 py-1 rounded-[6px] text-[12px] font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors"
                  onClick={onConfirmDelete}
                >
                  {t('classroom.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info — outside the thumbnail */}
      <div className="mt-2.5 px-1 flex items-center gap-2">
        {runStatus ? (
          <CourseRunStatusLabel status={runStatus} />
        ) : (
          <span className="shrink-0 inline-flex items-center rounded-[4px] border border-border bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            {classroom.sceneCount} {t('classroom.slides')} · {formatDate(classroom.updatedAt)}
          </span>
        )}
        {editing ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              maxLength={100}
              placeholder={t('classroom.renamePlaceholder')}
              className="w-full bg-transparent border-b border-primary text-[15px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="font-medium text-[15px] truncate text-foreground/90 min-w-0 cursor-text"
                onDoubleClick={pendingCourse ? undefined : startRename}
              >
                {classroom.name}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={4}
              className="!max-w-[min(90vw,32rem)] break-words whitespace-normal"
            >
              <div className="flex items-center gap-1.5">
                <span className="break-all">{classroom.name}</span>
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-foreground/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(classroom.name);
                    toast.success(t('classroom.nameCopied'));
                  }}
                >
                  <Copy className="size-3 opacity-60" />
                </button>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <HomePage />;
}
