import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, Screenshot } from '../lib/database';
import { Star, Download, Share2, Trash2, Image as ImageIcon } from 'lucide-react';
import { ScreenshotModal } from './ScreenshotModal';

interface GalleryProps {
  searchQuery: string;
  activeView: 'all' | 'favorites' | 'recent' | 'archived';
}

export function Gallery({ searchQuery, activeView }: GalleryProps) {
  const { user } = useAuth();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  useEffect(() => {
    loadScreenshots();
  }, [user, activeView, searchQuery]);

  const loadScreenshots = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await db.from('screenshots').select().eq('user_id', user.id).order('created_at', { ascending: false }).limit(1000);

      if (error) throw error;

      let filtered = data || [];

      if (activeView === 'favorites') {
        filtered = filtered.filter(s => s.is_favorite);
      } else if (activeView === 'archived') {
        filtered = filtered.filter(s => s.is_archived);
      } else if (activeView === 'recent') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        filtered = filtered.filter(s => new Date(s.created_at) >= sevenDaysAgo);
      }

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(s =>
          s.file_name.toLowerCase().includes(query) ||
          s.ocr_text?.toLowerCase().includes(query) ||
          s.user_notes?.toLowerCase().includes(query)
        );
      }

      setScreenshots(filtered);
    } catch (error) {
      console.error('Error loading screenshots:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (screenshot: Screenshot, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await db
      .from('screenshots')
      .update({ is_favorite: !screenshot.is_favorite })
      .eq('id', screenshot.id)
      .select();

    if (!error) {
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === screenshot.id ? { ...s, is_favorite: !s.is_favorite } : s
        )
      );
    }
  };

  const deleteScreenshot = async (screenshot: Screenshot, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this screenshot?')) return;

    const { error } = await db
      .from('screenshots')
      .delete()
      .eq('id', screenshot.id);

    if (!error) {
      setScreenshots((prev) => prev.filter((s) => s.id !== screenshot.id));
    }
  };

  const getImageUrl = async (storagePath: string) => {
    const { data } = await window.electronAPI!.file.read(storagePath);
    return `data:image/png;base64,${data}`;
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">
          {activeView.charAt(0).toUpperCase() + activeView.slice(1)} Screenshots
        </h2>
        <p className="text-gray-500">{screenshots.length} screenshots</p>
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
}: {
  screenshot: Screenshot;
  onSelect: (screenshot: Screenshot) => void;
  onToggleFavorite: (screenshot: Screenshot, e: React.MouseEvent) => void;
  onDelete: (screenshot: Screenshot, e: React.MouseEvent) => void;
  getImageUrl: (path: string) => Promise<string>;
  formatDate: (date: string) => string;
}) {
  const [imageUrl, setImageUrl] = useState<string>('');

  useEffect(() => {
    getImageUrl(screenshot.storage_path).then(setImageUrl);
  }, [screenshot.storage_path]);

  return (
    <div
      onClick={() => onSelect(screenshot)}
      className="group relative bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer"
    >
      <div className="aspect-video bg-gray-100 overflow-hidden">
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
            className={`w-5 h-5 ${
              screenshot.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-gray-700'
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
