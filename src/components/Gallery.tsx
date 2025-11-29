import { useState, useEffect } from 'react';
import { db, Screenshot } from '../lib/database';
import { Star, Download, Share2, Trash2, Image as ImageIcon, RefreshCcw } from 'lucide-react';
import { ScreenshotModal } from './ScreenshotModal';

interface GalleryProps {
  searchQuery: string;
  activeView: 'all' | 'favorites' | 'recent' | 'archived' | string; // string for folder IDs
  onDropSuccess?: () => void;
}

export function Gallery({ searchQuery, activeView, onDropSuccess }: GalleryProps) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  useEffect(() => {
    console.log('activeView', activeView);
    console.log('searchQuery', searchQuery);
    loadScreenshots();
  }, [activeView, searchQuery]);

  const loadScreenshots = async () => {
    setLoading(true);
    try {
      const qRaw = (searchQuery || '').trim().toLowerCase();

      console.log('[Gallery] loadScreenshots start', { activeView, q: qRaw });

      // --- 1) Ambil data utama ---
      const primaryRes = await db.from('screenshots').select({
        orderBy: { column: 'created_at', direction: 'desc' },
        limit: 1000,
      }) as any;

      let rows: any[] = Array.isArray(primaryRes.data) ? primaryRes.data : [];
      if (primaryRes.error) {
        console.warn('[Gallery] primary error:', primaryRes.error);
      }
      console.log('[Gallery] primary count:', rows.length);

      // --- 1b) Sort aman DESC by created_at (fallback kalau backend abaikan orderBy) ---
      const safeTime = (v: any) => {
        const t = new Date(v?.created_at ?? 0).getTime();
        return Number.isFinite(t) ? t : 0;
      };
      rows.sort((a, b) => safeTime(b) - safeTime(a));

      // --- 2) Fallback lama kalau benar2 kosong (jarang) ---
      if (!rows.length) {
        console.warn('[Gallery] fallback: select all then filter in memory');
        const allRes = await db.from('screenshots').select() as any; // tanpa where
        if (allRes.error) throw allRes.error;

        const all = Array.isArray(allRes.data) ? allRes.data : [];
        rows = all
          .sort((a: any, b: any) => safeTime(b) - safeTime(a))
          .slice(0, 1000);

        console.log('[Gallery] fallback count:', rows.length);
      }

      // --- 3) Filter berdasarkan activeView ---
      let filtered = rows;
      if (activeView === 'favorites') {
        filtered = filtered.filter((s: any) => !!s.is_favorite);
      } else if (activeView === 'archived') {
        filtered = filtered.filter((s: any) => !!s.is_archived);
      } else if (activeView === 'recent') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        filtered = filtered.filter(
          (s: any) => new Date(s.created_at).getTime() >= sevenDaysAgo.getTime()
        );
      } else if (activeView !== 'all') {
        // Assume activeView is a folder ID
        filtered = filtered.filter((s: any) => s.folder_id === activeView);
      }

      // =========================
      // 4) TEXT SEARCH + TAGS
      // =========================

      // helper: normalisasi string -> lower + trim
      const norm = (v: any) => (typeof v === 'string' ? v.toLowerCase() : '');

      // helper: flatten tags (custom_tags & ai_tags) -> string[]
      const pickTags = (s: any) => {
        const ct = Array.isArray(s?.custom_tags) ? s.custom_tags : [];
        const at = Array.isArray(s?.ai_tags) ? s.ai_tags : [];
        return [...ct, ...at]
          .filter((x) => x != null)
          .map((t) => (typeof t === 'string' ? t : String(t)))
          .map((t) => t.toLowerCase());
      };

      if (qRaw) {
        // tokenisasi: pisah spasi/koma, buang '#'
        const tokens = qRaw
          .split(/[\s,]+/)
          .map((t) => t.replace(/^#/, '').trim())
          .filter(Boolean);

        // dukung filter khusus "tag:foo" juga:
        filtered = filtered.filter((s) => {
          const textFields = [
            s.file_name,
            s.ocr_text,
            s.ai_description,
            s.user_notes,
          ].map(norm).join(' ');

          const tags = pickTags(s);

          return tokens.every((token) => {
            // A) tag:xxx
            if (token.startsWith('tag:')) {
              const tagQuery = token.replace('tag:', '');
              return tags.some((t) => t.includes(tagQuery));
            }
            // B) general search (text OR tags)
            return textFields.includes(token) || tags.some((t) => t.includes(token));
          });
        });
      }

      // --- 5) Set hasil ---
      console.log('[Gallery] final set', { total: filtered.length });
      setScreenshots(filtered as any);
    } catch (err) {
      console.error('Error loading screenshots:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (screenshot: Screenshot, e: React.MouseEvent) => {
    e.stopPropagation();

    // pastikan boolean
    const next = !Boolean(screenshot.is_favorite);

    // Optimistic UI
    setScreenshots((prev) =>
      prev.map((s) => (s.id === screenshot.id ? { ...s, is_favorite: next } : s))
    );

    const { error } = await db
      .from('screenshots')
      .update({ is_favorite: next })
      .eq('id', screenshot.id)
      .select();

    if (error) {
      // rollback kalau gagal
      setScreenshots((prev) =>
        prev.map((s) => (s.id === screenshot.id ? { ...s, is_favorite: !next } : s))
      );
      console.error('Failed to toggle favorite:', error);
      return;
    }

    // Jika sedang view "favorites" dan di-unfavorite → hilangkan dari list
    if (activeView === 'favorites' && !next) {
      setScreenshots((prev) => prev.filter((s) => s.id !== screenshot.id));
    }
  };

  const deleteScreenshot = async (screenshot: Screenshot, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this screenshot?')) return;

    // --- 1. Optimistic update: hapus dulu dari UI ---
    const prevState = screenshots;
    setScreenshots((prev) => prev.filter((s) => s.id !== screenshot.id));

    try {
      // --- 2. Hapus record dari SQLite / DB ---
      const { error: dbError } = await db
        .from('screenshots')
        .delete()
        .eq('id', screenshot.id);

      if (dbError) throw dbError;

      if (screenshot.storage_path) {
        try {
          await window.electronAPI?.file.delete(screenshot.storage_path);
          console.log('File deleted:', screenshot.storage_path);
        } catch (fileErr) {
          console.warn('DB deleted but file remove failed:', fileErr);
        }
      }
    } catch (err) {
      console.error('Delete failed, rolling back:', err);
      setScreenshots(prevState);
    }
  };


  const getImageUrl = async (storagePath: string) => {
    try {
      console.log('[Gallery] Loading image:', storagePath);
      const result = await window.electronAPI!.file.read(storagePath);
      console.log('[Gallery] Read result:', { hasData: !!result.data, error: result.error, dataLength: result.data?.length });

      if (result.error) {
        console.error('[Gallery] Error reading file:', result.error);
        return '';
      }

      if (!result.data) {
        console.error('[Gallery] No data returned for:', storagePath);
        return '';
      }

      const dataUrl = `data:image/png;base64,${result.data}`;
      console.log('[Gallery] Generated data URL, length:', dataUrl.length);
      return dataUrl;
    } catch (e) {
      console.error('[Gallery] Exception in getImageUrl:', e, 'for path:', storagePath);
      return '';
    }
  };

  const handleDragStart = (e: React.DragEvent, screenshot: Screenshot) => {
    console.log('[Gallery] Drag start for screenshot:', screenshot.id);
    e.dataTransfer.setData('text/plain', screenshot.id);
    e.dataTransfer.effectAllowed = 'move';

    // Create a custom drag preview - blue box with text
    const dragPreview = document.createElement('div');
    dragPreview.style.width = '120px';
    dragPreview.style.height = '80px';
    dragPreview.style.backgroundColor = '#3b82f6'; // Blue
    dragPreview.style.color = 'white';
    dragPreview.style.display = 'flex';
    dragPreview.style.flexDirection = 'column';
    dragPreview.style.alignItems = 'center';
    dragPreview.style.justifyContent = 'center';
    dragPreview.style.borderRadius = '8px';
    dragPreview.style.fontSize = '14px';
    dragPreview.style.fontWeight = '600';
    dragPreview.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    dragPreview.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    dragPreview.style.position = 'fixed'; // Changed to fixed
    dragPreview.style.top = '0px'; // Visible on screen
    dragPreview.style.left = '0px';
    dragPreview.style.zIndex = '99999';
    dragPreview.style.pointerEvents = 'none';
    dragPreview.innerHTML = '<div style="font-size: 24px; margin-bottom: 4px;">📸</div><div>Moving...</div>';

    document.body.appendChild(dragPreview);
    console.log('[Gallery] Drag preview element created and appended');

    // Set as drag image - center it on cursor
    try {
      e.dataTransfer.setDragImage(dragPreview, 60, 40);
      console.log('[Gallery] setDragImage called successfully');
    } catch (err) {
      console.error('[Gallery] setDragImage failed:', err);
    }

    // Clean up after drag starts
    setTimeout(() => {
      if (document.body.contains(dragPreview)) {
        document.body.removeChild(dragPreview);
        console.log('[Gallery] Drag preview element removed');
      }
    }, 50);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (screenshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <ImageIcon className="w-10 h-10 text-gray-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No screenshots found</h3>
        <p className="text-gray-500 max-w-sm">
          {searchQuery
            ? 'Try adjusting your search or filters'
            : 'Upload your first screenshot to get started'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="">

          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            {activeView.charAt(0).toUpperCase() + activeView.slice(1)} Screenshots
          </h2>
          <p className="text-gray-500">{screenshots.length} screenshots</p>
        </div>

        <div>
          <button
            onClick={loadScreenshots}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-sm rounded-lg flex items-center gap-2 transition"
          >
            <RefreshCcw size={16} />
            Reload
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {screenshots.map((screenshot) => (
          <ScreenshotCard
            key={screenshot.id}
            screenshot={screenshot}
            onSelect={setSelectedScreenshot}
            onToggleFavorite={toggleFavorite}
            onDelete={deleteScreenshot}
            getImageUrl={getImageUrl}
            formatDate={formatDate}
            onDragStart={handleDragStart}
          />
        ))}
      </div>

      {selectedScreenshot && (
        <ScreenshotModal
          screenshot={selectedScreenshot}
          onClose={() => setSelectedScreenshot(null)}
          onUpdate={loadScreenshots}
        />
      )}
    </>
  );
}

function ScreenshotCard({
  screenshot,
  onSelect,
  onToggleFavorite,
  onDelete,
  getImageUrl,
  formatDate,
  onDragStart,
}: {
  screenshot: Screenshot;
  onSelect: (screenshot: Screenshot) => void;
  onToggleFavorite: (screenshot: Screenshot, e: React.MouseEvent) => void;
  onDelete: (screenshot: Screenshot, e: React.MouseEvent) => void;
  getImageUrl: (path: string) => Promise<string>;
  formatDate: (date: string) => string;
  onDragStart: (e: React.DragEvent, screenshot: Screenshot) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string>('');

  useEffect(() => {
    getImageUrl(screenshot.storage_path).then(setImageUrl);
  }, [screenshot.storage_path]);

  return (
    <div
      onClick={() => onSelect(screenshot)}
      draggable
      onDragStart={(e) => onDragStart(e, screenshot)}
      className="group relative bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:scale-[1.02] transition-all cursor-move"
    >
      <div
        className="aspect-video bg-gray-100 overflow-hidden"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={screenshot.file_name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-10 h-10 text-gray-400" />
          </div>
        )}
      </div>

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
        <button
          onClick={(e) => onToggleFavorite(screenshot, e)}
          className="p-2 bg-white rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Star
            className={`w-5 h-5 ${screenshot.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-gray-700'
              }`}
          />
        </button>
        <button className="p-2 bg-white rounded-lg hover:bg-gray-100 transition-colors">
          <Download className="w-5 h-5 text-gray-700" />
        </button>
        <button className="p-2 bg-white rounded-lg hover:bg-gray-100 transition-colors">
          <Share2 className="w-5 h-5 text-gray-700" />
        </button>
        <button
          onClick={(e) => onDelete(screenshot, e)}
          className="p-2 bg-white rounded-lg hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-5 h-5 text-red-600" />
        </button>
      </div>

      {screenshot.is_favorite && (
        <div className="absolute top-3 right-3">
          <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
        </div>
      )}

      <div className="p-4">
        <h3 className="font-medium text-gray-900 truncate mb-1">
          {screenshot.file_name}
        </h3>
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{formatDate(screenshot.created_at)}</span>
          <span>{(screenshot.file_size / 1024).toFixed(1)} KB</span>
        </div>
        {screenshot.custom_tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {screenshot.custom_tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
