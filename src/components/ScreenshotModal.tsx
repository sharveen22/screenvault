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
  Plus,
} from 'lucide-react';

interface ScreenshotModalProps {
  screenshot: Screenshot;
  onClose: () => void;
  onUpdate: () => void;
  onFavoriteToggle?: (delta: number) => void;
}

export function ScreenshotModal({ screenshot, onClose, onUpdate, onFavoriteToggle }: ScreenshotModalProps) {
  const [newTag, setNewTag] = useState('');
  const [isFavorite, setIsFavorite] = useState(screenshot.is_favorite);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imageLoading, setImageLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [noteHistory, setNoteHistory] = useState<Array<{ text: string; timestamp: string }>>(screenshot.note_history || []);

  useEffect(() => {
    loadImage();
  }, [screenshot.storage_path]);

  // Sync local state with prop updates
  useEffect(() => {
    setIsFavorite(screenshot.is_favorite);
  }, [screenshot.is_favorite]);

  useEffect(() => {
    setNoteHistory(screenshot.note_history || []);
  }, [screenshot.note_history]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  const loadImage = async () => {
    setImageLoading(true);
    // Use requestIdleCallback or setTimeout to defer image loading slightly
    // This allows the modal to open quickly and show UI first
    requestIdleCallback(async () => {
      // Load full-resolution image (useThumbnail = false) for modal
      const { data } = await window.electronAPI!.file.read(screenshot.storage_path, false);
      setImageUrl(`data:image/png;base64,${data}`);
      setImageLoading(false);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, action: () => void) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      action();
    }
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
      // Update favorite count in Dashboard immediately
      onFavoriteToggle?.(nextState ? 1 : -1);
      // Sync parent on success
      onUpdate();
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;

    const newNoteEntry = {
      text: newNote.trim(),
      timestamp: new Date().toISOString()
    };

    const updatedHistory = [newNoteEntry, ...noteHistory];

    const { error } = await db
      .from('screenshots')
      .update({ note_history: updatedHistory })
      .eq('id', screenshot.id)
      .select();

    if (!error) {
      setNoteHistory(updatedHistory);
      setNewNote('');
      onUpdate();
    }
  };

  const formatNoteDate = (timestamp: string) => {
    let normalized = timestamp;
    if (!timestamp.includes('Z') && !timestamp.includes('+')) {
      normalized = timestamp.replace(' ', 'T') + 'Z';
    }
    return new Date(normalized).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
    let normalized = dateString;
    // If it looks like "YYYY-MM-DD HH:MM:SS" (common SQL default), treat as UTC
    if (!dateString.includes('Z') && !dateString.includes('+')) {
      normalized = dateString.replace(' ', 'T') + 'Z';
    }
    return new Date(normalized).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#161419]/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#e9e6e4] rounded-2xl shadow-2xl max-w-[95vw] w-full max-h-[90vh] overflow-hidden flex flex-col border border-[#94918f]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-[#94918f]">
          <h2 className="text-xl font-bold text-[#161419] truncate flex-1 pr-4 title-font">
            {screenshot.file_name}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleFavorite}
              className="p-2 hover:bg-[#161419] hover:text-[#e9e6e4] rounded-lg transition-all hover:scale-110 border border-transparent hover:border-[#161419] hover:shadow-md"
            >
              <Star
                className={`w-5 h-5 ${isFavorite ? 'fill-[#161419] text-[#161419]' : 'text-[#161419]'
                  }`}
              />
            </button>
            <button
              onClick={() => window.electronAPI?.file.reveal(screenshot.storage_path)}
              className="p-2 hover:bg-[#161419] hover:text-[#e9e6e4] rounded-lg transition-all hover:scale-110 text-[#161419] hover:shadow-md"
              title="Show in Finder"
            >
              <FolderOpen className="w-5 h-5" />
            </button>
            <button
              onClick={() => window.electronAPI?.file.share(screenshot.storage_path)}
              className="p-2 hover:bg-[#161419] hover:text-[#e9e6e4] rounded-lg transition-all hover:scale-110 text-[#161419] hover:shadow-md"
              title="Share"
            >
              <Share2 className="w-5 h-5" />
            </button>
            <button
              onClick={deleteScreenshot}
              className="p-2 hover:bg-red-600 hover:text-white rounded-lg transition-all hover:scale-110 text-red-600 hover:shadow-md"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#161419] hover:text-[#e9e6e4] rounded-lg transition-all hover:scale-110 ml-2 text-[#161419] hover:shadow-md"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 bg-[#dcd9d7] flex items-center justify-center p-6 overflow-auto">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={screenshot.file_name}
                className="w-full h-full object-contain shadow-xl"
                style={{ maxWidth: '100%', maxHeight: '100%' }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center">
                <ImageIcon className="w-16 h-16 text-[#94918f] mb-4" />
                <p className="text-[#161419] opacity-50 subtitle-font">Loading image...</p>
              </div>
            )}
          </div>

          <div className="w-96 bg-[#e9e6e4] border-l border-[#94918f] overflow-y-auto p-6 space-y-6">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#161419] mb-3 title-font">
                <FileText className="w-4 h-4" />
                Details
              </div>
              <div className="space-y-2 text-sm subtitle-font">
                <div className="flex justify-between">
                  <span className="text-[#161419] opacity-60">Size:</span>
                  <span className="text-[#161419] font-medium">
                    {(screenshot.file_size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#161419] opacity-60">Dimensions:</span>
                  <span className="text-[#161419] font-medium">
                    {screenshot.width} × {screenshot.height}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#161419] opacity-60">Format:</span>
                  <span className="text-[#161419] font-medium uppercase">
                    {screenshot.file_type.split('/')[1]}
                  </span>
                </div>
                <div className="flex items-start justify-between">
                  <span className="text-[#161419] opacity-60">Uploaded:</span>
                  <span className="text-[#161419] font-medium text-right">
                    {formatDate(screenshot.created_at)}
                  </span>
                </div>
              </div>
            </div>



            {screenshot.ai_description && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#161419] mb-3 title-font">
                  <Monitor className="w-4 h-4" />
                  AI Description
                </div>
                <p className="text-sm text-[#161419] opacity-80 subtitle-font">{screenshot.ai_description}</p>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#161419] mb-3 title-font">
                <Tag className="w-4 h-4" />
                Tags
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {screenshot.custom_tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 border border-[#161419] text-[#161419] rounded-md text-xs uppercase tracking-wider subtitle-font"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-red-600 transition-colors"
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
                  onKeyDown={(e) => handleKeyDown(e, addTag)}
                  placeholder="Add tag..."
                  className="flex-1 px-3 py-1.5 text-sm bg-transparent border border-[#94918f] rounded-lg focus:border-[#161419] focus:shadow-md outline-none placeholder-[#161419]/40 subtitle-font transition-all"
                />
                <button
                  onClick={addTag}
                  className="px-3 py-1.5 bg-[#161419] text-[#e9e6e4] rounded-lg text-sm font-medium hover:bg-[#2a2730] hover:shadow-lg transition-all hover:scale-105 subtitle-font"
                >
                  Add
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#161419] mb-3 title-font">
                <FileText className="w-4 h-4" />
                Notes
              </div>

              {/* Add Note Input */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, addNote)}
                  placeholder="Add a note..."
                  className="flex-1 px-3 py-2 text-sm bg-transparent border border-[#94918f] rounded-lg focus:border-[#161419] focus:shadow-md outline-none placeholder-[#161419]/40 subtitle-font transition-all"
                />
                <button
                  onClick={addNote}
                  className="px-3 py-2 bg-[#161419] text-[#e9e6e4] rounded-lg text-sm font-medium hover:bg-[#2a2730] hover:shadow-lg transition-all hover:scale-105 flex items-center gap-1 subtitle-font"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>

              {/* Note History List */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {noteHistory.length === 0 && (
                  <p className="text-sm text-[#161419] opacity-50 text-center py-4 subtitle-font">No notes yet. Add your first note above!</p>
                )}
                {noteHistory.map((note, index) => (
                  <div
                    key={index}
                    className="p-3 bg-transparent border border-[#94918f] rounded-lg"
                  >
                    <p className="text-sm text-[#161419] mb-1 subtitle-font">{note.text}</p>
                    <p className="text-xs text-[#161419] opacity-50 subtitle-font">{formatNoteDate(note.timestamp)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
