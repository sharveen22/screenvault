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
    { id: 'recent', icon: Clock, label: 'Recent' },
    { id: 'archived', icon: Archive, label: 'Archived' },
  ];

  const bottomItems = [
    { icon: BarChart3, label: 'Analytics' },
    { icon: Settings, label: 'Settings' },
    { icon: HelpCircle, label: 'Help' },
  ];

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

            <button
              onClick={() => setShowUploadZone(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium group relative"
              title="Upload screenshot (Ctrl/Cmd + U)"
            >
              <Upload className="w-4 h-4" />
              <span>Upload</span>
              <kbd className="hidden group-hover:inline-block ml-2 px-1.5 py-0.5 bg-blue-700 rounded text-xs font-mono">
                ⌘U
              </kbd>
            </button>

            <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Bell className="w-5 h-5 text-gray-600" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>

            <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">{user?.email}</div>
                <div className="text-xs text-gray-500 capitalize">{userProfile?.plan || 'Free'} Plan</div>
              </div>
              <button className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-blue-600" />
              </button>
            </div>
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
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                  activeView === item.id
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
                <button className="text-gray-400 hover:text-gray-600">
                  <span className="text-lg">+</span>
                </button>
              </div>
              <button className="w-full flex items-center gap-3 px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <Folder className="w-5 h-5 text-blue-500" />
                <span>Work</span>
              </button>
              <button className="w-full flex items-center gap-3 px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <Folder className="w-5 h-5 text-green-500" />
                <span>Personal</span>
              </button>
            </div>

            <div className="pt-4 mt-4 border-t border-gray-200">
              <div className="px-3 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Tags
                </span>
              </div>
              <div className="flex flex-wrap gap-2 px-3">
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                  <Tag className="w-3 h-3" />
                  code
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                  <Tag className="w-3 h-3" />
                  design
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                  <Tag className="w-3 h-3" />
                  bug
                </span>
              </div>
            </div>
          </nav>

          <div className="border-t border-gray-200 pt-4 space-y-1">
            {bottomItems.map((item) => (
              <button
                key={item.label}
                className="w-full flex items-center gap-3 px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            ))}
            <button
              onClick={() => signOut()}
              className="w-full flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span>Sign Out</span>
            </button>
          </div>

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
                  <span>Upload</span>
                  <kbd className="px-1.5 py-0.5 bg-gray-200 rounded font-mono">⌘U</kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span>Search</span>
                  <kbd className="px-1.5 py-0.5 bg-gray-200 rounded font-mono">⌘K</kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span>Paste</span>
                  <kbd className="px-1.5 py-0.5 bg-gray-200 rounded font-mono">⌘V</kbd>
                </div>
                {isElectron && (
                  <div className="flex items-center justify-between">
                    <span>Show App</span>
                    <kbd className="px-1.5 py-0.5 bg-gray-200 rounded font-mono">⇧⌘A</kbd>
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg">
              <div className="text-xs font-semibold text-blue-900 mb-1">Storage</div>
              <div className="flex items-center justify-between text-xs text-blue-700 mb-2">
                <span>{((userProfile?.storage_used || 0) / 1024 / 1024).toFixed(1)} MB</span>
                <span>{((userProfile?.storage_limit || 0) / 1024 / 1024 / 1024).toFixed(0)} GB</span>
              </div>
              <div className="w-full h-2 bg-blue-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      ((userProfile?.storage_used || 0) / (userProfile?.storage_limit || 1)) * 100,
                      100
                    )}%`,
                  }}
                ></div>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 p-6">
          <Gallery searchQuery={searchQuery} activeView={activeView} />
        </main>
      </div>

      {showUploadZone && <UploadZone onClose={() => setShowUploadZone(false)} />}
    </div>
  );
}
