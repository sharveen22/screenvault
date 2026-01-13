import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useElectronScreenshots } from '../hooks/useElectronScreenshots';
import { db } from '../lib/database';
import { Camera, Search, Folder, Star, Plus, Upload, FolderOpen, ChevronDown, Trash2, Keyboard } from 'lucide-react';
import { Gallery } from './Gallery';

interface FolderData {
  id: string;
  name: string;
  parent_id: string | null;
  screenshot_count: number;
}

export function Dashboard() {
  const { takeScreenshot } = useElectronScreenshots();
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
  const [showShortcutsMenu, setShowShortcutsMenu] = useState(false);
  const [allCount, setAllCount] = useState(0);
  const [favCount, setFavCount] = useState(0);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [folderImages, setFolderImages] = useState<Record<string, string[]>>({});

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

  const loadScreenshotsAndImages = useCallback(async () => {
    // Debounce: cancel any pending load
    if (loadDebounceRef.current) {
      clearTimeout(loadDebounceRef.current);
    }

    // Schedule load after 150ms of inactivity
    loadDebounceRef.current = setTimeout(async () => {
      // Prevent overlapping calls
      if (loadingRef.current) {
        console.log('[Dashboard] Already loading, skipping...');
        return;
      }

      loadingRef.current = true;
      console.log('[Dashboard] loadScreenshotsAndImages starting...');
      try {
        // Use db.from like Gallery does
        const result = await db.from('screenshots').select({
          orderBy: { column: 'created_at', direction: 'desc' },
          limit: 1000,
        }) as any;

        if (!result?.data) {
          console.log('[Dashboard] No screenshots data');
          return;
        }

        const screenshots = result.data;
        console.log('[Dashboard] Got', screenshots.length, 'screenshots');

        setAllCount(screenshots.length);
        setFavCount(screenshots.filter((s: any) => s.is_favorite).length);

        // Load images for folder previews
        const api = window.electronAPI as any;
        if (!api?.file?.read) {
          console.log('[Dashboard] No file.read API');
          return;
        }

        const loadImage = async (path: string): Promise<string> => {
          try {
            const res = await api.file.read(path);
            if (res?.data) return `data:image/png;base64,${res.data}`;
          } catch (e) {
            console.error('[Dashboard] Image load error:', e);
          }
          return '';
        };

        const imageMap: Record<string, string[]> = {};

        // All - first 4
        console.log('[Dashboard] Loading All images...');
        const allPaths = screenshots.slice(0, 4).map((s: any) => s.storage_path);
        const allImgs = await Promise.all(allPaths.map(loadImage));
        imageMap['all'] = allImgs.filter(Boolean);
        console.log('[Dashboard] All images:', imageMap['all'].length);

        // Favorites - first 4
        const favScreenshots = screenshots.filter((s: any) => s.is_favorite).slice(0, 4);
        const favImgs = await Promise.all(favScreenshots.map((s: any) => loadImage(s.storage_path)));
        imageMap['favorites'] = favImgs.filter(Boolean);

        // By folder
        const folderIds = [...new Set(screenshots.map((s: any) => s.folder_id).filter(Boolean))] as string[];
        for (const fid of folderIds) {
          const folderScreenshots = screenshots.filter((s: any) => s.folder_id === fid).slice(0, 4);
          const fImgs = await Promise.all(folderScreenshots.map((s: any) => loadImage(s.storage_path)));
          imageMap[fid] = fImgs.filter(Boolean);
        }

        console.log('[Dashboard] Loaded images for folders:', Object.keys(imageMap));
        setFolderImages(imageMap);
      } catch (e) {
        console.error('[Dashboard] loadScreenshotsAndImages error:', e);
      } finally {
        loadingRef.current = false;
      }
    }, 150); // 150ms debounce
  }, []);

  useEffect(() => { 
    loadFolders(); 
    loadScreenshotsAndImages(); 
  }, [loadFolders, loadScreenshotsAndImages]);

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefresh = useCallback(() => {
    // Batch multiple refresh events with 300ms debounce
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      console.log('[Dashboard] Batched refresh triggered');
      setRefreshKey(k => k + 1);
      loadScreenshotsAndImages();
      loadFolders();
    }, 300); // Increased from 200ms to 300ms for better batching
  }, [loadScreenshotsAndImages, loadFolders]);

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

  const handleImportFiles = async () => { setShowImportMenu(false); const result = await (window.electronAPI as any)?.import?.files?.(); if (result?.data?.length > 0) triggerRefresh(); };
  const handleImportFolder = async () => { setShowImportMenu(false); const result = await (window.electronAPI as any)?.import?.folder?.(); if (result?.data) { loadFolders(); triggerRefresh(); } };
  const handleCapture = async () => { try { await takeScreenshot(); } catch (err) { console.error('[Dashboard] takeScreenshot error:', err); } };
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
  const rootFolders = useMemo(() => folders.filter(f => !f.parent_id), [folders]);
  const getChildFolders = useCallback((parentId: string) => folders.filter(f => f.parent_id === parentId), [folders]);

  // Mosaic renderer
  const renderMosaic = (images: string[], fallbackIcon: React.ReactNode) => {
    if (!images || images.length === 0) {
      return <div className="w-full h-full flex items-center justify-center bg-[#161419]">{fallbackIcon}</div>;
    }
    if (images.length === 1) {
      return <img src={images[0]} alt="" className="w-full h-full object-cover" />;
    }
    return (
      <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-px bg-[#161419]">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="overflow-hidden bg-[#2a2730]">
            {images[i] && <img src={images[i]} alt="" className="w-full h-full object-cover" />}
          </div>
        ))}
      </div>
    );
  };

  // Folder card
  const FolderCard = ({ viewId, name, count, icon, subCount, parentName }: { viewId: string, name: string, count: number, icon: React.ReactNode, subCount?: number, parentName?: string }) => {
    const images = folderImages[viewId] || [];
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
        className={`flex-shrink-0 w-[130px] cursor-pointer transition-all duration-200
          ${isActive ? 'ring-2 ring-[#161419] ring-offset-2 ring-offset-[#e9e6e4]' : 'hover:shadow-md hover:-translate-y-0.5'}
          ${isDragging ? 'opacity-50' : ''}
          [&.folder-drag-over]:ring-2 [&.folder-drag-over]:ring-blue-500`}
      >
        <div className="border border-[#94918f] overflow-hidden bg-[#e9e6e4] hover:border-[#161419] transition-all">
          <div className="aspect-square overflow-hidden">
            {renderMosaic(images, icon)}
          </div>
          <div className="p-2 border-t border-[#94918f]">
            {editingFolderId === viewId ? (
              <input autoFocus value={editFolderName} onChange={e => setEditFolderName(e.target.value)}
                onBlur={() => handleRenameFolder(viewId, editFolderName)}
                onKeyDown={e => e.key === 'Enter' && handleRenameFolder(viewId, editFolderName)}
                onClick={e => e.stopPropagation()}
                className="bg-transparent border-b border-[#161419] outline-none text-[12px] font-medium w-full" />
            ) : (
              <>
                {parentName ? (
                  <div className="flex flex-col">
                    <span className="text-[9px] text-[#161419] opacity-40 truncate">{parentName}</span>
                    <h3 className="text-[12px] font-medium text-[#3b82f6] truncate flex items-center gap-1">
                      <span className="text-[10px]">↳</span> {name}
                    </h3>
                  </div>
                ) : (
                  <h3 className="text-[12px] font-medium text-[#161419] truncate">{name}</h3>
                )}
              </>
            )}
            <p className="text-[10px] text-[#161419] opacity-50 mt-0.5">{count}{subCount ? ` • ${subCount} sub` : ''}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-[#e9e6e4] w-full h-screen overflow-hidden flex flex-col">
      {/* Top Bar */}
      <div className="p-3 border-b border-[#94918f]">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center border border-[#94918f] bg-[#e9e6e4] px-3 py-2 focus-within:border-[#161419]">
            <Search size={16} className="text-[#161419] opacity-50 mr-2" />
            <input type="text" placeholder="Search..." value={searchInput} onChange={e => setSearchInput(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-[#161419] text-sm placeholder:text-[#161419] placeholder:opacity-40" />
          </div>
          <div className="relative">
            <button onClick={() => setShowShortcutsMenu(!showShortcutsMenu)} className="flex items-center gap-1.5 px-3 py-2 border border-[#94918f] text-[#161419] text-xs font-medium hover:border-[#161419] transition-colors" title="Keyboard Shortcuts">
              <Keyboard size={14} />
            </button>
            {showShortcutsMenu && (
              <div className="absolute top-full right-0 mt-1 bg-[#e9e6e4] border border-[#161419] z-50 min-w-[280px] max-w-[320px]">
                <div className="px-3 py-2 border-b border-[#94918f] bg-[#161419] text-[#e9e6e4]">
                  <h3 className="text-xs font-semibold">Keyboard Shortcuts</h3>
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#161419]">Take Screenshot</span>
                    <kbd className="px-2 py-0.5 bg-[#161419] text-[#e9e6e4] rounded text-[9px] font-mono">Cmd+Shift+S</kbd>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#161419]">Open App</span>
                    <kbd className="px-2 py-0.5 bg-[#161419] text-[#e9e6e4] rounded text-[9px] font-mono">Cmd+Shift+A</kbd>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#161419]">Refresh Gallery</span>
                    <kbd className="px-2 py-0.5 bg-[#161419] text-[#e9e6e4] rounded text-[9px] font-mono">Cmd+R</kbd>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#161419]">Drag to Move</span>
                    <kbd className="px-2 py-0.5 bg-[#161419] text-[#e9e6e4] rounded text-[9px] font-mono">Click+Drag</kbd>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => window.electronAPI?.file.openScreenshotsFolder()} className="flex items-center gap-1.5 px-3 py-2 border border-[#94918f] text-[#161419] text-xs font-medium hover:border-[#161419] transition-colors" title="Open Screenshots Folder">
            <FolderOpen size={14} />
          </button>
          <button onClick={handleCapture} className="flex items-center gap-1.5 px-3 py-2 bg-[#161419] text-[#e9e6e4] text-xs font-medium hover:bg-[#2a2730] transition-colors"><Camera size={14} />CAPTURE</button>
          <div className="relative">
            <button onClick={() => setShowImportMenu(!showImportMenu)} className="flex items-center gap-1.5 px-3 py-2 border border-[#161419] text-[#161419] text-xs font-medium hover:bg-[#161419] hover:text-[#e9e6e4] transition-colors"><Upload size={14} />IMPORT<ChevronDown size={12} /></button>
            {showImportMenu && <div className="absolute top-full right-0 mt-1 bg-[#e9e6e4] border border-[#161419] z-50 min-w-[140px]"><button onClick={handleImportFiles} className="w-full px-3 py-2 text-left text-xs text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] flex items-center gap-2"><Upload size={12} />Files</button><button onClick={handleImportFolder} className="w-full px-3 py-2 text-left text-xs text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] flex items-center gap-2 border-t border-[#94918f]"><FolderOpen size={12} />Folder</button></div>}
          </div>
        </div>
      </div>

      {/* Folders Section */}
      <div className="px-6 py-4 border-b border-[#94918f]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#161419] opacity-70">FOLDERS</h2>
          <button onClick={() => setIsCreatingFolder(true)} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-[#161419] border border-[#94918f] hover:border-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] transition-colors"><Plus size={11} />NEW</button>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin scrollbar-thumb-[#94918f] scrollbar-track-transparent">
          <FolderCard viewId="all" name="All" count={allCount} icon={<Camera size={20} className="text-[#94918f]" />} />
          <FolderCard viewId="favorites" name="Favorites" count={favCount} icon={<Star size={20} className="text-[#94918f]" />} />
          {folders.map(f => {
            const parentFolder = f.parent_id ? folders.find(pf => pf.id === f.parent_id) : null;
            return (
              <FolderCard
                key={f.id}
                viewId={f.id}
                name={f.name}
                count={f.screenshot_count}
                icon={<Folder size={20} className={f.parent_id ? "text-[#3b82f6]" : "text-[#94918f]"} />}
                subCount={getChildFolders(f.id).length || undefined}
                parentName={parentFolder?.name}
              />
            );
          })}
          {isCreatingFolder && (
            <div className="flex-shrink-0 w-[130px]">
              <div className="border border-[#161419] overflow-hidden bg-[#e9e6e4] shadow-sm">
                <div className="aspect-square bg-[#161419] flex items-center justify-center"><Folder size={20} className="text-[#94918f]" /></div>
                <form onSubmit={handleCreateFolder} className="p-2 border-t border-[#94918f]">
                  <input autoFocus type="text" placeholder="Name..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onBlur={() => { if (!newFolderName.trim()) setIsCreatingFolder(false); }} className="bg-transparent border-b border-[#161419] outline-none text-[12px] font-medium w-full" />
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-base font-bold text-[#161419]">{getBreadcrumb()}</h1>
          <div className="flex gap-1.5">
            <select value={sortOrder} onChange={e => setSortOrder(e.target.value as any)} className="px-2 py-1 border border-[#94918f] bg-[#e9e6e4] text-[#161419] text-[10px] cursor-pointer hover:border-[#161419]"><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
            <button onClick={() => setRefreshKey(k => k + 1)} className="px-2 py-1 border border-[#94918f] text-[#161419] text-[10px] hover:border-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] transition-colors">↻</button>
          </div>
        </div>
        <Gallery searchQuery={searchQuery} activeView={activeView} sortOrder={sortOrder} processingOCR={processingOCR} refreshTrigger={refreshKey} onDropSuccess={triggerRefresh} />
      </div>

      {showShortcutsMenu && <div className="fixed inset-0 z-40" onClick={() => setShowShortcutsMenu(false)} />}
      {showImportMenu && <div className="fixed inset-0 z-40" onClick={() => setShowImportMenu(false)} />}
      {contextMenu && <><div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} /><div className="fixed z-50 bg-[#e9e6e4] border border-[#161419]" style={{ top: contextMenu.y, left: contextMenu.x }}><button onClick={() => { const f = folders.find(x => x.id === contextMenu.folderId); if (f) { setEditingFolderId(f.id); setEditFolderName(f.name); } setContextMenu(null); }} className="w-full px-3 py-2 text-left text-xs text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4]">Rename</button><button onClick={() => { handleDeleteFolder(contextMenu.folderId); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-600 hover:text-white flex items-center gap-2 border-t border-[#94918f]"><Trash2 size={12} />Delete</button></div></>}
    </div>
  );
}
