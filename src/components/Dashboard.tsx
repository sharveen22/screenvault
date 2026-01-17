import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../lib/database';
import { Search, Folder, Star, Plus, Upload, FolderOpen, ChevronDown, Trash2, Image } from 'lucide-react';
import { Gallery } from './Gallery';

interface FolderData {
  id: string;
  name: string;
  parent_id: string | null;
  screenshot_count: number;
}

export function Dashboard() {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'all' | 'favorites' | string>('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [processingOCR, setProcessingOCR] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<FolderData[]>([]);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [allCount, setAllCount] = useState(0);
  const [favCount, setFavCount] = useState(0);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadFolders = useCallback(async () => {
    const api = window.electronAPI as any;
    if (!api?.folder?.list) return;
    const { data } = await api.folder.list();
    if (data) setFolders(data);
  }, []);

  const loadingRef = useRef(false); // Prevent overlapping calls
  const loadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCounts = useCallback(async () => {
    // Debounce: cancel any pending load
    if (loadDebounceRef.current) {
      clearTimeout(loadDebounceRef.current);
    }

    // Schedule load after 150ms of inactivity
    loadDebounceRef.current = setTimeout(async () => {
      // Prevent overlapping calls
      if (loadingRef.current) {
        return;
      }

      loadingRef.current = true;
      try {
        // Use db.from like Gallery does
        const result = await db.from('screenshots').select({
          orderBy: { column: 'created_at', direction: 'desc' },
          limit: 1000,
        }) as any;

        if (!result?.data) {
          return;
        }

        const screenshots = result.data;
        setAllCount(screenshots.length);
        setFavCount(screenshots.filter((s: any) => s.is_favorite).length);
      } catch (e) {
        console.error('[Dashboard] loadCounts error:', e);
      } finally {
        loadingRef.current = false;
      }
    }, 150); // 150ms debounce
  }, []);

  useEffect(() => {
    loadFolders();
    loadCounts();
  }, [loadFolders, loadCounts]);

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefresh = useCallback(() => {
    // Batch multiple refresh events with 300ms debounce
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      console.log('[Dashboard] Batched refresh triggered');
      setRefreshKey(k => k + 1);
      loadCounts();
      loadFolders();
    }, 300); // Increased from 200ms to 300ms for better batching
  }, [loadCounts, loadFolders]);

  const updateFavCount = useCallback((delta: number) => {
    setFavCount(prev => Math.max(0, prev + delta));
  }, []);

  useEffect(() => {
    const api = window.electronAPI as any;
    if (!api) return;
    const off1 = api.onScreenshotSaved?.(() => triggerRefresh());
    const off2 = api.onScreenshotDeleted?.(() => triggerRefresh());
    const off3 = api.onScreenshotImported?.(() => triggerRefresh());
    const off4 = api.onFolderCreated?.(() => loadFolders());
    const off5 = api.onOCRComplete?.((data: any) => {
      if (data?.screenshotId) setProcessingOCR(prev => { const n = new Set(prev); n.delete(data.screenshotId); return n; });
      triggerRefresh();
    });
    const onLocalSaved = () => triggerRefresh();
    const onOcrComplete = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.screenshotId) setProcessingOCR(prev => { const n = new Set(prev); n.delete(d.screenshotId); return n; }); triggerRefresh(); };
    const onOcrStart = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.screenshotId) setProcessingOCR(prev => new Set(prev).add(d.screenshotId)); };
    window.addEventListener('screenshot-saved-local', onLocalSaved);
    window.addEventListener('ocr-complete', onOcrComplete);
    window.addEventListener('ocr-start', onOcrStart);
    return () => {
      off1?.();
      off2?.();
      off3?.();
      off4?.();
      off5?.();
      window.removeEventListener('screenshot-saved-local', onLocalSaved);
      window.removeEventListener('ocr-complete', onOcrComplete);
      window.removeEventListener('ocr-start', onOcrStart);
      // Clean up all timeouts
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      if (loadDebounceRef.current) clearTimeout(loadDebounceRef.current);
    };
  }, [triggerRefresh, loadFolders]);

  const handleImportFiles = async () => {
    try {
      setShowImportMenu(false);
      console.log('[Dashboard] Import Files clicked');
      const result = await (window.electronAPI as any)?.import?.files?.();
      console.log('[Dashboard] Import Files result:', result);
      if (result?.data?.length > 0) {
        triggerRefresh();
      }
    } catch (error) {
      console.error('[Dashboard] Import Files error:', error);
    }
  };

  const handleImportFolder = async () => {
    try {
      setShowImportMenu(false);
      console.log('[Dashboard] Import Folder clicked');
      const result = await (window.electronAPI as any)?.import?.folder?.();
      console.log('[Dashboard] Import Folder result:', result);
      if (result?.data) {
        loadFolders();
        triggerRefresh();
      }
    } catch (error) {
      console.error('[Dashboard] Import Folder error:', error);
    }
  };
  const handleCreateFolder = async (e: React.FormEvent) => { e.preventDefault(); if (!newFolderName.trim()) return; await (window.electronAPI as any)?.folder?.create?.(newFolderName, null); setNewFolderName(''); setIsCreatingFolder(false); loadFolders(); };
  const handleRenameFolder = async (id: string, newName: string) => { if (!newName.trim()) { setEditingFolderId(null); return; } await (window.electronAPI as any)?.folder?.rename?.(id, newName); setEditingFolderId(null); loadFolders(); };
  const handleDeleteFolder = async (id: string) => { const folder = folders.find(f => f.id === id); if (folder && window.confirm(`Delete "${folder.name}"?`)) { await (window.electronAPI as any)?.folder?.delete?.(id); if (activeView === id) setActiveView('all'); loadFolders(); triggerRefresh(); } };
  
  const handleScreenshotDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('folder-drag-over');
    const dataType = e.dataTransfer.getData('application/x-drag-type');
    const data = e.dataTransfer.getData('text/plain');
    if (dataType === 'folder') {
      if (data && data !== folderId) { const result = await (window.electronAPI as any)?.folder?.move?.(data, folderId); if (result?.error) alert(result.error); else { loadFolders(); triggerRefresh(); } }
    } else { if (data) { await (window.electronAPI as any)?.folder?.moveScreenshot?.(data, folderId); loadFolders(); triggerRefresh(); } }
    setDraggingFolderId(null);
  };
  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => { e.dataTransfer.setData('text/plain', folderId); e.dataTransfer.setData('application/x-drag-type', 'folder'); e.dataTransfer.effectAllowed = 'move'; setDraggingFolderId(folderId); };
  const handleFolderDragEnd = () => { setDraggingFolderId(null); };
  const isDescendant = (folderId: string, potentialAncestorId: string): boolean => { const folder = folders.find(f => f.id === folderId); if (!folder || !folder.parent_id) return false; if (folder.parent_id === potentialAncestorId) return true; return isDescendant(folder.parent_id, potentialAncestorId); };

  const getBreadcrumb = () => {
    if (activeView === 'all') return 'All Screenshots';
    if (activeView === 'favorites') return 'Favorites';
    const folder = folders.find(f => f.id === activeView);
    if (!folder) return 'Screenshots';
    const path: string[] = [folder.name];
    let currentParentId = folder.parent_id;
    while (currentParentId) { const parent = folders.find(f => f.id === currentParentId); if (!parent) break; path.unshift(parent.name); currentParentId = parent.parent_id; }
    return path.join(' > ');
  };

  // Memoize folder computations to prevent unnecessary recalculations
  const getChildFolders = useCallback((parentId: string) => folders.filter(f => f.parent_id === parentId), [folders]);

  // Folder list item for sidebar
  const FolderListItem = ({ viewId, name, count, icon, subCount, parentName }: { viewId: string, name: string, count: number, icon: React.ReactNode, subCount?: number, parentName?: string }) => {
    const isActive = activeView === viewId;
    const isUserFolder = viewId !== 'all' && viewId !== 'favorites';
    const isDragging = draggingFolderId === viewId;
    const canDrop = isUserFolder && draggingFolderId && draggingFolderId !== viewId && !isDescendant(draggingFolderId, viewId);

    return (
      <div
        draggable={isUserFolder}
        onDragStart={(e) => isUserFolder && handleFolderDragStart(e, viewId)}
        onDragEnd={handleFolderDragEnd}
        onClick={() => setActiveView(viewId)}
        onDoubleClick={() => isUserFolder && (setEditingFolderId(viewId), setEditFolderName(name))}
        onContextMenu={e => { if (isUserFolder) { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, folderId: viewId }); }}}
        onDragOver={e => { if (isUserFolder && (canDrop || !draggingFolderId)) { e.preventDefault(); e.currentTarget.classList.add('folder-drag-over'); }}}
        onDragLeave={e => e.currentTarget.classList.remove('folder-drag-over')}
        onDrop={e => isUserFolder && handleScreenshotDrop(e, viewId)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all cursor-pointer
          ${isActive ? 'bg-[#161419]/10' : 'hover:bg-[#161419]/10'}
          ${isDragging ? 'opacity-50' : ''}
          [&.folder-drag-over]:bg-blue-500/10 [&.folder-drag-over]:ring-2 [&.folder-drag-over]:ring-blue-500`}
      >
        <div className="text-[#161419] flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          {editingFolderId === viewId ? (
            <input autoFocus value={editFolderName} onChange={e => setEditFolderName(e.target.value)}
              onBlur={() => handleRenameFolder(viewId, editFolderName)}
              onKeyDown={e => e.key === 'Enter' && handleRenameFolder(viewId, editFolderName)}
              onClick={e => e.stopPropagation()}
              className="bg-transparent border-b border-[#161419] outline-none text-sm font-medium w-full" />
          ) : (
            <>
              {parentName ? (
                <h3 className="text-sm text-[#161419] truncate flex items-center gap-1">
                  <span className="text-[10px] opacity-50">↳</span> {name}
                </h3>
              ) : (
                <h3 className="text-sm text-[#161419] truncate">{name}</h3>
              )}
            </>
          )}
        </div>
        <span className="text-[10px] text-[#161419] opacity-50 flex-shrink-0">{count}</span>
      </div>
    );
  };

  return (
    <div className="bg-[#e9e6e4] w-full h-screen overflow-hidden flex">
      {/* Left Sidebar - Expanded */}
      <div className="w-[220px] bg-[#dcd9d7] border-r border-[#94918f] flex flex-col py-4 px-3 gap-4 flex-shrink-0 overflow-y-auto">

        {/* ScreenVault Branding */}
        <div className="flex items-center gap-3 px-2 py-3">
          <img src="./icon.png" alt="ScreenVault" className="w-8 h-8" />
          <h1 className="text-lg font-bold text-[#161419]">ScreenVault</h1>
        </div>

        {/* Divider */}
        <div className="border-t border-[#94918f]"></div>

        {/* Tools Section */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#161419] opacity-50 mb-2 px-1">
            TOOLS
          </h3>
          <div className="space-y-1">
            <div className="relative">
              <button
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[#161419] hover:bg-[#161419]/10 transition-all"
              >
                <Upload size={16} />
                <span className="text-sm">Import</span>
                <ChevronDown size={12} className="ml-auto" />
              </button>
              {showImportMenu && (
                <div className="mt-1 bg-[#e9e6e4] border border-[#161419] rounded-lg shadow-lg overflow-hidden relative z-50">
                  <button onClick={handleImportFiles} className="w-full px-3 py-2 text-left text-xs text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] flex items-center gap-2 transition-colors">
                    <Upload size={12} />Files
                  </button>
                  <button onClick={handleImportFolder} className="w-full px-3 py-2 text-left text-xs text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] flex items-center gap-2 border-t border-[#94918f] transition-colors">
                    <FolderOpen size={12} />Folder
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => window.electronAPI?.file.openScreenshotsFolder()}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[#161419] hover:bg-[#161419]/10 transition-all"
            >
              <FolderOpen size={16} />
              <span className="text-sm">Open Folder</span>
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[#94918f]"></div>

        {/* Folders Section */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#161419] opacity-50 px-1">
              FOLDERS
            </h3>
            <button onClick={() => setIsCreatingFolder(true)} className="p-1 text-[#161419] hover:bg-[#161419]/10 rounded transition-all">
              <Plus size={14} />
            </button>
          </div>
          <div className="space-y-1">
            <FolderListItem viewId="all" name="All Screenshots" count={allCount} icon={<Image size={18} />} />
            <FolderListItem viewId="favorites" name="Favorites" count={favCount} icon={<Star size={18} />} />
            {folders.map(f => {
              const parentFolder = f.parent_id ? folders.find(pf => pf.id === f.parent_id) : null;
              return (
                <FolderListItem
                  key={f.id}
                  viewId={f.id}
                  name={f.name}
                  count={f.screenshot_count}
                  icon={<Folder size={18} />}
                  subCount={getChildFolders(f.id).length || undefined}
                  parentName={parentFolder?.name}
                />
              );
            })}
            {isCreatingFolder && (
              <div className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-[#161419]/10">
                <Folder size={18} className="text-[#161419]" />
                <form onSubmit={handleCreateFolder} className="flex-1">
                  <input autoFocus type="text" placeholder="Folder name..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onBlur={() => { if (!newFolderName.trim()) setIsCreatingFolder(false); }} className="bg-transparent border-b border-[#161419] outline-none text-sm font-medium w-full" />
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Shortcuts Toolbar - Spanning Horizontally */}
        <div className="px-6 py-2.5 border-b border-[#94918f] bg-[#dcd9d7]">
          <div className="flex items-center justify-between text-[11px] text-[#161419] opacity-70">
            <div className="flex items-center gap-2">
              <span className="font-medium">Capture Screenshot:</span>
              <kbd className="px-2 py-1 bg-[#161419] text-[#e9e6e4] rounded text-[10px] font-mono">Cmd+Shift+S</kbd>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Fullscreen Capture:</span>
              <kbd className="px-2 py-1 bg-[#161419] text-[#e9e6e4] rounded text-[10px] font-mono">Cmd+Shift+D</kbd>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Open App:</span>
              <kbd className="px-2 py-1 bg-[#161419] text-[#e9e6e4] rounded text-[10px] font-mono">Cmd+Shift+A</kbd>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Refresh Gallery:</span>
              <kbd className="px-2 py-1 bg-[#161419] text-[#e9e6e4] rounded text-[10px] font-mono">Cmd+R</kbd>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Drag to Move:</span>
              <kbd className="px-2 py-1 bg-[#161419] text-[#e9e6e4] rounded text-[10px] font-mono">Click+Drag</kbd>
            </div>
          </div>
        </div>

        {/* Content Toolbar - Breadcrumb, Search, Sort */}
        <div className="px-4 py-3 border-b border-[#94918f] bg-[#e9e6e4]">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-base font-bold text-[#161419] flex-shrink-0">{getBreadcrumb()}</h1>
            <div className="flex items-center gap-3 flex-1 max-w-2xl">
              <div className="flex items-center border border-[#94918f] bg-[#e9e6e4] px-3 py-2 rounded-lg focus-within:border-[#161419] focus-within:shadow-md transition-all flex-1">
                <Search size={16} className="text-[#161419] opacity-50 mr-2" />
                <input type="text" placeholder="Search screenshots..." value={searchInput} onChange={e => setSearchInput(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-[#161419] text-sm placeholder:text-[#161419] placeholder:opacity-40" />
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <select value={sortOrder} onChange={e => setSortOrder(e.target.value as any)} className="px-2 py-1 border border-[#94918f] bg-[#e9e6e4] text-[#161419] text-[10px] cursor-pointer hover:border-[#161419] rounded-md transition-colors">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
              <button onClick={() => setRefreshKey(k => k + 1)} className="px-2 py-1 border border-[#94918f] text-[#161419] text-[10px] hover:border-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] rounded-md hover:shadow-md transition-all">↻</button>
            </div>
          </div>
        </div>

        {/* Gallery Section - Full Height */}
        <div className="flex-1 min-h-0" style={{ display: 'flex', flexDirection: 'column' }}>
          <Gallery searchQuery={searchQuery} activeView={activeView} sortOrder={sortOrder} processingOCR={processingOCR} refreshTrigger={refreshKey} onDropSuccess={triggerRefresh} onFavoriteToggle={updateFavCount} />
        </div>
      </div>

      {showImportMenu && <div className="fixed inset-0 z-40" onClick={() => setShowImportMenu(false)} />}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 bg-[#e9e6e4] border border-[#161419] rounded-lg shadow-lg overflow-hidden" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button onClick={() => { const f = folders.find(x => x.id === contextMenu.folderId); if (f) { setEditingFolderId(f.id); setEditFolderName(f.name); } setContextMenu(null); }} className="w-full px-3 py-2 text-left text-xs text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] transition-colors">
              Rename
            </button>
            <button onClick={() => { handleDeleteFolder(contextMenu.folderId); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-600 hover:text-white flex items-center gap-2 border-t border-[#94918f] transition-colors">
              <Trash2 size={12} />Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
