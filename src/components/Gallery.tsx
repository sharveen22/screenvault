import { useState, useEffect, useRef } from 'react';
import { db, Screenshot } from '../lib/database';
import { Star, FolderOpen, Share2, Trash2, Image as ImageIcon, RefreshCcw } from 'lucide-react';
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

  // Sync selectedScreenshot with updated list
  useEffect(() => {
    if (selectedScreenshot) {
      const updated = screenshots.find((s) => s.id === selectedScreenshot.id);
      if (updated && updated !== selectedScreenshot) {
        setSelectedScreenshot(updated);
      }
    }
  }, [screenshots]);

  const loadScreenshots = async () => {
    setLoading(true);
    try {
      const qRaw = (searchQuery || '').trim().toLowerCase();

      console.log('[Gallery] loadScreenshots start', { activeView, q: qRaw });

      // Build WHERE clause based on activeView for better performance
      let where: Record<string, any> | undefined;
      
      if (activeView === 'favorites') {
        where = { is_favorite: 1 }; // SQLite uses 1 for true
      } else if (activeView === 'archived') {
        where = { is_archived: 1 };
      } else if (activeView !== 'all' && activeView !== 'recent') {
        // Assume activeView is a folder ID
        where = { folder_id: activeView };
      }

      // Query with WHERE clause - much faster than loading all then filtering
      const primaryRes = await db.from('screenshots').select({
        where,
        orderBy: { column: 'created_at', direction: 'desc' },
        limit: 1000,
      }) as any;

      let rows: any[] = Array.isArray(primaryRes.data) ? primaryRes.data : [];
      if (primaryRes.error) {
        console.warn('[Gallery] primary error:', primaryRes.error);
      }
      console.log('[Gallery] primary count:', rows.length);

      // Filter for 'recent' view (last 7 days) - can't easily do in WHERE clause
      let filtered = rows;
      if (activeView === 'recent') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        filtered = filtered.filter(
          (s: any) => new Date(s.created_at).getTime() >= sevenDaysAgo.getTime()
        );
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
            s.note_history?.map((n: any) => n.text).join(' ') || '',
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
          <h2 className="text-2xl font-bold text-[#161419] mb-1 title-font">
            {activeView.charAt(0).toUpperCase() + activeView.slice(1)} Screenshots
          </h2>
          <p className="text-[#161419] opacity-60 subtitle-font">{screenshots.length} screenshots</p>
        </div>

        <div>
          <button
            onClick={loadScreenshots}
            className="px-3 py-1.5 bg-transparent border border-[#161419] text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] text-sm rounded-none flex items-center gap-2 transition-all subtitle-font"
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
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // Start loading 100px before entering viewport
      }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Only load image when visible
  useEffect(() => {
    if (isVisible && !imageUrl) {
      getImageUrl(screenshot.storage_path).then(setImageUrl);
    }
  }, [isVisible, screenshot.storage_path, imageUrl]);

  return (
    <div
      ref={cardRef}
      onClick={() => onSelect(screenshot)}
      draggable
      onDragStart={(e) => onDragStart(e, screenshot)}
      className="group relative bg-transparent border border-[#94918f] overflow-hidden hover:border-[#161419] transition-all cursor-move"
      style={{ borderRadius: 0 }}
    >
      <div
        className="aspect-video bg-[#dcd9d7] overflow-hidden relative"
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

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-[#161419]/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {/* Actions can go here if needed, but keeping it clean for now */}
        </div>
      </div>

      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => onToggleFavorite(screenshot, e)}
          className="p-1.5 bg-[#e9e6e4] border border-[#161419] text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] transition-colors"
        >
          <Star className={`w-4 h-4 ${screenshot.is_favorite ? 'fill-[#161419]' : ''}`} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.electronAPI?.file.reveal(screenshot.storage_path);
          }}
          className="p-1.5 bg-[#e9e6e4] border border-[#161419] text-[#161419] hover:bg-[#161419] hover:text-[#e9e6e4] transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => onDelete(screenshot, e)}
          className="p-1.5 bg-[#e9e6e4] border border-[#161419] text-[#161419] hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {screenshot.is_favorite && (
        <div className="absolute top-2 left-2">
          <Star className="w-4 h-4 fill-[#161419] text-[#161419]" />
        </div>
      )}

      <div className="p-3 border-t border-[#94918f] bg-[#e9e6e4]">
        <h3 className="font-medium text-[#161419] truncate mb-1 subtitle-font text-sm">
          {screenshot.file_name}
        </h3>
        <div className="flex items-center justify-between text-xs text-[#161419] opacity-60 subtitle-font">
          <span>{formatDate(screenshot.created_at)}</span>
          <span>{(screenshot.file_size / 1024).toFixed(1)} KB</span>
        </div>
        {screenshot.custom_tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {screenshot.custom_tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 border border-[#161419] text-[#161419] rounded-none uppercase tracking-wider"
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
