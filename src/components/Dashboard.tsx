import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useElectronScreenshots } from '../hooks/useElectronScreenshots';
import {
  Camera,
  Upload,
  Search,
  Bell,
  Settings,
  LogOut,
  Folder,
  Tag,
  Star,
  Clock,
  Archive,
  BarChart3,
  HelpCircle,
  User,
  Zap,
  Trash2,
} from 'lucide-react';
import { Gallery } from './Gallery';
import { UploadZone } from './UploadZone';

export function Dashboard() {
  const { user, userProfile, signOut } = useAuth();
  const { isElectron, takeScreenshot } = useElectronScreenshots();
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [activeView, setActiveView] = useState<'all' | 'favorites' | 'recent' | 'archived'>('all');

  const handleGlobalPaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const hasImage = Array.from(items).some((item) =>
        item.type.startsWith('image/')
      );

      if (hasImage) {
        setShowUploadZone(true);
      }
    },
    []
  );

  const handleKeyboardShortcut = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'u') {
        e.preventDefault();
        setShowUploadZone(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      }
    },
    []
  );

  useEffect(() => {
    window.addEventListener('paste', handleGlobalPaste);
    window.addEventListener('keydown', handleKeyboardShortcut);
    return () => {
      window.removeEventListener('paste', handleGlobalPaste);
      window.removeEventListener('keydown', handleKeyboardShortcut);
    };
  }, [handleGlobalPaste, handleKeyboardShortcut]);

  const sidebarItems = [
    { id: 'all', icon: Camera, label: 'All Screenshots', count: userProfile?.screenshot_count || 0 },
    { id: 'favorites', icon: Star, label: 'Favorites' },
    // { id: 'recent', icon: Clock, label: 'Recent' },
    // { id: 'archived', icon: Archive, label: 'Archived' },
  ];

  const bottomItems = [
    { icon: BarChart3, label: 'Analytics' },
    { icon: Settings, label: 'Settings' },
    { icon: HelpCircle, label: 'Help' },
  ];

  const [folders, setFolders] = useState<any[]>([]);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Context Menu & Editing State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');

  const loadFolders = useCallback(async () => {
    if (!window.electronAPI?.folder) return;
    const { data } = await window.electronAPI.folder.list();
    if (data) setFolders(data);
  }, []);

  useEffect(() => {
    loadFolders();
    // Listen for updates if needed, or just reload on actions
  }, [loadFolders]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    await window.electronAPI!.folder.create(newFolderName);
    setNewFolderName('');
    setIsCreatingFolder(false);
    loadFolders();
  };

  const handleRenameFolder = async (id: string, newName: string) => {
    if (!newName.trim()) {
      setEditingFolderId(null);
      return;
    }
    await window.electronAPI!.folder.rename(id, newName);
    setEditingFolderId(null);
    loadFolders();
  };

  const handleDeleteFolder = async (id: string) => {
    const folder = folders.find(f => f.id === id);
    if (!folder) return;

    const count = folder.screenshot_count;
    let message = `Are you sure you want to delete "${folder.name}"?`;
    if (count > 0) {
      message += `\n\nWARNING: ${count} screenshot(s) in this folder will be moved to "All Screenshots" (uncategorized). They will NOT be deleted from your library.`;
    }

    if (window.confirm(message)) {
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
      loadFolders(); // Update counts
      // Also refresh gallery if needed (Gallery component might need a refresh trigger)
      // For now, let's just update folders
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('bg-blue-100');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('bg-blue-100');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6 flex-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">ScreenVault</h1>
            </div>

            <div className="flex-1 max-w-2xl">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search screenshots by text, tags, or filename..."
                  className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-transparent rounded-lg focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isElectron && takeScreenshot && (
              <button
                onClick={takeScreenshot}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all font-medium group relative shadow-lg"
                title="Capture Screenshot (Ctrl+Shift+S)"
              >
                <Zap className="w-4 h-4" />
                <span>Capture</span>
                <kbd className="hidden group-hover:inline-block ml-2 px-1.5 py-0.5 bg-indigo-700 rounded text-xs font-mono">
                  ⇧⌘S
                </kbd>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="w-64 bg-white border-r border-gray-200 min-h-[calc(100vh-73px)] p-4 flex flex-col">
          <nav className="flex-1 space-y-1">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id as any)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${activeView === item.id
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-700 hover:bg-gray-100'
                  }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span className="text-xs px-2 py-0.5 bg-gray-200 rounded-full">
                    {item.count}
                  </span>
                )}
              </button>
            ))}

            <div className="pt-4 mt-4 border-t border-gray-200">
              <div className="px-3 mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Folders
                </span>
                <button
                  onClick={() => setIsCreatingFolder(true)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <span className="text-lg">+</span>
                </button>
              </div>

              {isCreatingFolder && (
                <form onSubmit={handleCreateFolder} className="px-3 mb-2">
                  <input
                    autoFocus
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onBlur={() => !newFolderName && setIsCreatingFolder(false)}
                    placeholder="Folder name..."
                    className="w-full px-2 py-1 text-sm border rounded focus:border-blue-500 outline-none"
                  />
                </form>
              )}

              {folders.map(folder => (
                <div key={folder.id} className="relative group">
                  {editingFolderId === folder.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRenameFolder(folder.id, editFolderName);
                      }}
                      className="px-3 py-1"
                    >
                      <input
                        autoFocus
                        type="text"
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onBlur={() => handleRenameFolder(folder.id, editFolderName)}
                        className="w-full px-2 py-1 text-sm border rounded focus:border-blue-500 outline-none"
                      />
                    </form>
                  ) : (
                    <button
                      onClick={() => setActiveView(folder.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, folderId: folder.id });
                      }}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => {
                        e.currentTarget.classList.remove('bg-blue-100');
                        handleDrop(e, folder.id);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${activeView === folder.id
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-700 hover:bg-gray-100'
                        }`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <Folder className="w-5 h-5 text-gray-400 flex-shrink-0" style={{ color: folder.color }} />
                        <span className="truncate">{folder.name}</span>
                      </div>
                      {folder.screenshot_count > 0 && (
                        <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-500 flex-shrink-0">
                          {folder.screenshot_count}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </nav>

          {/* Context Menu */}
          {contextMenu && (
            <>
              <div
                className="fixed inset-0 z-50"
                onClick={() => setContextMenu(null)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
              />
              <div
                className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-48"
                style={{ top: contextMenu.y, left: contextMenu.x }}
              >
                <button
                  onClick={() => {
                    const folder = folders.find(f => f.id === contextMenu.folderId);
                    if (folder) {
                      setEditingFolderId(folder.id);
                      setEditFolderName(folder.name);
                    }
                    setContextMenu(null);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <span>Rename</span>
                </button>
                <button
                  onClick={() => {
                    handleDeleteFolder(contextMenu.folderId);
                    setContextMenu(null);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete</span>
                </button>
              </div>
            </>
          )}

          <div className="mt-4 space-y-3">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="text-xs font-semibold text-gray-700 mb-2">
                Keyboard Shortcuts
                {isElectron && (
                  <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-normal">
                    Desktop
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs text-gray-600">
                {isElectron && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-indigo-600">Capture</span>
                    <kbd className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-mono">⇧⌘S</kbd>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Search</span>
                  <kbd className="px-1.5 py-0.5 bg-gray-200 rounded font-mono">⌘K</kbd>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 p-6">
          <Gallery
            searchQuery={searchQuery}
            activeView={activeView}
            onDropSuccess={loadFolders} // Callback to refresh folders when item moved
          />
        </main>
      </div>

      {showUploadZone && <UploadZone onClose={() => setShowUploadZone(false)} />}
    </div>
  );
}
