import { useState, useEffect, useCallback } from 'react';
import { useElectronScreenshots } from '../hooks/useElectronScreenshots';
import { Camera, Search, Folder, Star, Trash2, Plus } from 'lucide-react';
import { Gallery } from './Gallery';

export function Dashboard() {
  useElectronScreenshots();
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'all' | 'favorites' | 'recent' | 'archived' | string>('all');
  const [captureStatus, setCaptureStatus] = useState<'capturing' | 'processing-ocr' | 'saving' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const api = window.electronAPI as any;
    if (!api) return;
    const cleanupCapturing = api.onScreenshotCapturing?.(() => setCaptureStatus('capturing'));
    const cleanupFailed = api.onScreenshotCaptureFailed?.(() => setCaptureStatus(null));
    const cleanupCancelled = api.onScreenshotCaptureCancelled?.(() => setCaptureStatus(null));
    const cleanupSaved = api.onScreenshotSaved?.(() => { setCaptureStatus(null); setRefreshKey(k => k + 1); });
    return () => { cleanupCapturing?.(); cleanupFailed?.(); cleanupCancelled?.(); cleanupSaved?.(); };
  }, []);

  useEffect(() => {
    const handleOcrStart = () => setCaptureStatus('processing-ocr');
    const handleSavingStart = () => setCaptureStatus('saving');
    const handleScreenshotSaved = () => { setCaptureStatus(null); setRefreshKey(k => k + 1); };
    window.addEventListener('ocr-processing', handleOcrStart);
    window.addEventListener('screenshot-saving', handleSavingStart);
    window.addEventListener('screenshot-saved', handleScreenshotSaved);
    return () => {
      window.removeEventListener('ocr-processing', handleOcrStart);
      window.removeEventListener('screenshot-saving', handleSavingStart);
      window.removeEventListener('screenshot-saved', handleScreenshotSaved);
    };
  }, []);

  const shortcuts = [
    { keys: ['⌘', 'Shift', 'S'], label: 'Take Screenshot' },
    { keys: ['⌘', 'Shift', 'A'], label: 'Show App' },
    { keys: ['⌘', 'V'], label: 'Paste Screenshot' },
    { keys: ['⌘', 'C'], label: 'Copy Screenshot' },
  ];

  const [folders, setFolders] = useState<any[]>([]);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');

  const loadFolders = useCallback(async () => {
    if (!window.electronAPI?.folder) return;
    const { data } = await window.electronAPI.folder.list();
    if (data) setFolders(data);
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await window.electronAPI!.folder.create(newFolderName);
    setNewFolderName('');
    setIsCreatingFolder(false);
    loadFolders();
  };

  const handleRenameFolder = async (id: string, newName: string) => {
    if (!newName.trim()) { setEditingFolderId(null); return; }
    await window.electronAPI!.folder.rename(id, newName);
    setEditingFolderId(null);
    loadFolders();
  };

  const handleDeleteFolder = async (id: string) => {
    const folder = folders.find(f => f.id === id);
    if (!folder) return;
    if (window.confirm(`Delete "${folder.name}"?`)) {
      await window.electronAPI!.folder.delete(id);
      if (activeView === id) setActiveView('all');
      loadFolders();
    }
  };

  const handleDrop = async (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    const screenshotId = e.dataTransfer.getData('text/plain');
    if (screenshotId) {
      await window.electronAPI!.folder.moveScreenshot(screenshotId, folderId);
      loadFolders();
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.add('bg-gray-200'); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.remove('bg-gray-200'); };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap");
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .blog-container { background-color: #e9e6e4; width: 100%; display: grid; height: 100vh; overflow: hidden; grid-template-columns: 20% 80%; padding: 40px 20px; }
        .blog-part { padding: 0 20px; }
        .blog-part:not(:last-child) { border-right: 1px solid #94918f; }
        .blog-menu { font-size: 14px; color: #161419; display: flex; align-items: center; cursor: pointer; padding: 6px 0; }
        .blog-menu:hover { opacity: 0.7; }
        .blog-menu + .blog-menu { margin-top: 12px; }
        .blog-menu.active { font-weight: 600; }
        .blog-header-container { overflow-y: auto; height: 100%; display: flex; flex-direction: column; border-right: 1px solid #94918f; padding-top: 20px; }
      ` }} />

      <div className="blog-container">
        <div className="blog-part blog-header-container">
          <div style={{ marginBottom: '40px' }}>
            <div className="blog-menu" onClick={() => setActiveView('all')}>
              <Camera size={20} style={{ marginRight: 10 }} />Capture
            </div>
          </div>

          <div style={{ marginBottom: '40px' }}>
            <div className={`blog-menu ${activeView === 'all' ? 'active' : ''}`} onClick={() => setActiveView('all')}>
              <Camera size={20} style={{ marginRight: 10 }} />All Screenshots
            </div>
            <div className={`blog-menu ${activeView === 'favorites' ? 'active' : ''}`} onClick={() => setActiveView('favorites')}>
              <Star size={20} style={{ marginRight: 10 }} />Favorites
            </div>
          </div>

          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #94918f', flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', opacity: 0.6 }}>Folders</div>
              <Plus size={18} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setIsCreatingFolder(true)} />
            </div>

            {isCreatingFolder && (
              <form onSubmit={handleCreateFolder} className="mb-4">
                <input autoFocus type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                  onBlur={() => { if (!newFolderName.trim()) setIsCreatingFolder(false); }}
                  className="w-full bg-transparent border-b border-black outline-none mb-2" placeholder="New folder name" />
              </form>
            )}

            <div style={{ flex: '1 1 auto', overflowY: 'auto', marginBottom: '20px' }}>
              {folders.map((f) => (
                <div key={f.id} className={`blog-menu ${activeView === f.id ? 'active' : ''}`}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => { if (editingFolderId !== f.id) setActiveView(f.id); }}
                  onDoubleClick={() => { setEditingFolderId(f.id); setEditFolderName(f.name); }}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, folderId: f.id }); }}
                  onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                  onDrop={(e) => { e.currentTarget.classList.remove('bg-gray-200'); handleDrop(e, f.id); }}>
                  <div className="flex items-center">
                    <Folder size={16} style={{ marginRight: 10 }} />
                    {editingFolderId === f.id ? (
                      <input autoFocus className="bg-transparent border-b border-black outline-none w-24" value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onBlur={() => handleRenameFolder(f.id, editFolderName)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder(f.id, editFolderName)}
                        onClick={(e) => e.stopPropagation()} />
                    ) : f.name}
                  </div>
                  <span style={{ fontSize: '12px', opacity: 0.5 }}>{f.screenshot_count || 0}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flexShrink: 0, paddingTop: '20px', borderTop: '1px solid #94918f' }}>
            <div style={{ fontSize: '12px', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase', opacity: 0.6 }}>Shortcuts</div>
            {shortcuts.map((shortcut, idx) => (
              <div key={idx} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '3px' }}>{shortcut.label}</div>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {shortcut.keys.map((key, keyIdx) => (
                    <kbd key={keyIdx} style={{ backgroundColor: '#161419', color: '#e9e6e4', padding: '3px 6px', borderRadius: '3px', fontSize: '10px', fontFamily: 'monospace' }}>{key}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="blog-header-container" style={{ borderRight: 'none', padding: '40px' }}>
          <div style={{ marginBottom: '30px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 700, fontFamily: 'Space Grotesk', letterSpacing: '-1px', marginBottom: '12px' }}>
              {activeView === 'all' ? 'All Screenshots' : activeView === 'favorites' ? 'Favorites' : folders.find(f => f.id === activeView)?.name || 'Screenshots'}
            </h1>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
                style={{ padding: '6px 12px', border: '1px solid #161419', background: '#e9e6e4', cursor: 'pointer', fontSize: '13px', fontFamily: 'Space Grotesk', color: '#161419' }}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
              <button onClick={() => setRefreshKey(k => k + 1)}
                style={{ padding: '6px 12px', border: '1px solid #161419', background: 'transparent', cursor: 'pointer', fontSize: '13px', fontFamily: 'Space Grotesk', color: '#161419' }}>
                ↻ Reload
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #94918f', paddingBottom: 10 }}>
              <Search size={20} style={{ marginRight: 10, opacity: 0.5 }} />
              <input type="text" placeholder="Search screenshots..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '18px', width: '100%', fontFamily: 'Space Grotesk' }} />
            </div>
          </div>

          <Gallery key={refreshKey} searchQuery={searchQuery} activeView={activeView} onDropSuccess={loadFolders} sortOrder={sortOrder} />
        </div>
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-48" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button onClick={() => { const folder = folders.find(f => f.id === contextMenu.folderId); if (folder) { setEditingFolderId(folder.id); setEditFolderName(folder.name); } setContextMenu(null); }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Rename</button>
            <button onClick={() => { handleDeleteFolder(contextMenu.folderId); setContextMenu(null); }}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
              <Trash2 className="w-4 h-4" />Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}
