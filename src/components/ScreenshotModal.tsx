import { useState, useEffect } from 'react';
import { Screenshot, db } from '../lib/database';
import {
  X,
  FolderOpen,
  Star,
  Tag,
  FileText,
  Monitor,
  Share2,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';

interface ScreenshotModalProps {
  screenshot: Screenshot;
  onClose: () => void;
  onUpdate: () => void;
}

export function ScreenshotModal({ screenshot, onClose, onUpdate }: ScreenshotModalProps) {
  const [notes, setNotes] = useState(screenshot.user_notes);
  const [newTag, setNewTag] = useState('');
  const [isFavorite, setIsFavorite] = useState(screenshot.is_favorite);
  const [imageUrl, setImageUrl] = useState<string>('');

  useEffect(() => {
    loadImage();
  }, [screenshot.storage_path]);

  // Sync local state with prop updates
  useEffect(() => {
    setIsFavorite(screenshot.is_favorite);
  }, [screenshot.is_favorite]);

  const loadImage = async () => {
    const { data } = await window.electronAPI!.file.read(screenshot.storage_path);
    setImageUrl(`data:image/png;base64,${data}`);
  };

  const toggleFavorite = async () => {
    // Optimistic update
    const nextState = !isFavorite;
    setIsFavorite(nextState);

    const { error } = await db
      .from('screenshots')
      .update({ is_favorite: nextState })
      .eq('id', screenshot.id)
      .select();

    if (error) {
      // Revert on error
      setIsFavorite(!nextState);
      console.error('Failed to toggle favorite:', error);
    } else {
      // Sync parent on success
      onUpdate();
    }
  };

  const saveNotes = async () => {
    const { error } = await db
      .from('screenshots')
      .update({ user_notes: notes })
      .eq('id', screenshot.id)
      .select();

    if (!error) {
      onUpdate();
    }
  };

  const addTag = async () => {
    if (!newTag.trim()) return;

    const updatedTags = [...screenshot.custom_tags, newTag.trim()];
    const { error } = await db
      .from('screenshots')
      .update({ custom_tags: updatedTags })
      .eq('id', screenshot.id)
      .select();

    if (!error) {
      screenshot.custom_tags = updatedTags;
      setNewTag('');
      onUpdate();
    }
  };

  const removeTag = async (tagToRemove: string) => {
    const updatedTags = screenshot.custom_tags.filter((tag) => tag !== tagToRemove);
    const { error } = await db
      .from('screenshots')
      .update({ custom_tags: updatedTags })
      .eq('id', screenshot.id)
      .select();

    if (!error) {
      screenshot.custom_tags = updatedTags;
      onUpdate();
    }
  };



  const deleteScreenshot = async () => {
    if (!confirm('Are you sure you want to delete this screenshot?')) return;

    await db.from('screenshots').delete().eq('id', screenshot.id);
    onClose();
    onUpdate();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 truncate flex-1 pr-4">
            {screenshot.file_name}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleFavorite}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Star
                className={`w-5 h-5 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'
                  }`}
              />
            </button>
            <button
              onClick={() => window.electronAPI?.file.reveal(screenshot.storage_path)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Show in Finder"
            >
              <FolderOpen className="w-5 h-5 text-gray-600" />
            </button>
            <button
              onClick={() => window.electronAPI?.file.share(screenshot.storage_path)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Share"
            >
              <Share2 className="w-5 h-5 text-gray-600" />
            </button>
            <button
              onClick={deleteScreenshot}
              className="p-2 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-5 h-5 text-red-600" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors ml-2"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 bg-gray-50 flex items-center justify-center p-6 overflow-auto">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={screenshot.file_name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              />
            ) : (
              <div className="flex flex-col items-center justify-center">
                <ImageIcon className="w-16 h-16 text-gray-400 mb-4" />
                <p className="text-gray-500">Loading image...</p>
              </div>
            )}
          </div>

          <div className="w-96 bg-white border-l border-gray-200 overflow-y-auto p-6 space-y-6">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <FileText className="w-4 h-4" />
                Metadata
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Size:</span>
                  <span className="text-gray-900 font-medium">
                    {(screenshot.file_size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Dimensions:</span>
                  <span className="text-gray-900 font-medium">
                    {screenshot.width} × {screenshot.height}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Format:</span>
                  <span className="text-gray-900 font-medium uppercase">
                    {screenshot.file_type.split('/')[1]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Source:</span>
                  <span className="text-gray-900 font-medium capitalize">
                    {screenshot.source}
                  </span>
                </div>
                <div className="flex items-start justify-between">
                  <span className="text-gray-500">Uploaded:</span>
                  <span className="text-gray-900 font-medium text-right">
                    {formatDate(screenshot.created_at)}
                  </span>
                </div>
              </div>
            </div>

            {screenshot.ocr_text && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                  <FileText className="w-4 h-4" />
                  OCR Text
                  {screenshot.ocr_confidence && (
                    <span className="text-xs text-gray-500">
                      ({(screenshot.ocr_confidence * 100).toFixed(0)}% confidence)
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg max-h-40 overflow-y-auto">
                  {screenshot.ocr_text}
                </div>
              </div>
            )}

            {screenshot.ai_description && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                  <Monitor className="w-4 h-4" />
                  AI Description
                </div>
                <p className="text-sm text-gray-700">{screenshot.ai_description}</p>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <Tag className="w-4 h-4" />
                Tags
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {screenshot.custom_tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-blue-900"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  placeholder="Add tag..."
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <button
                  onClick={addTag}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <FileText className="w-4 h-4" />
                Notes
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                placeholder="Add notes about this screenshot..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                rows={4}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
