import { useState, useCallback, useEffect } from 'react';
import { Upload, X, Image as ImageIcon, Loader, FileSearch } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { extractTextFromImage, generateSmartFilename, generateTags } from '../lib/ocr';

interface UploadZoneProps {
  onClose: () => void;
}

type FileStatus = 'uploading' | 'processing' | 'success' | 'error';

export function UploadZone({ onClose }: UploadZoneProps) {
  const { user } = useAuth();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; status: FileStatus; message?: string }[]>([]);

  const uploadFile = async (file: File, index: number) => {
    if (!user) return;

    setUploadedFiles((prev) =>
      prev.map((f, idx) => (idx === index ? { ...f, status: 'processing' as FileStatus, message: 'Analyzing with OCR...' } : f))
    );

    const ocrResult = await extractTextFromImage(file);

    const smartFilename = generateSmartFilename(ocrResult.text, file.name);
    const autoTags = generateTags(ocrResult.text);

    const fileName = `${user.id}/${Date.now()}-${smartFilename}`;

    const { error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const { error: dbError } = await supabase
      .from('screenshots')
      .insert([
        {
          user_id: user.id,
          file_name: smartFilename,
          file_size: file.size,
          file_type: file.type,
          width: img.width,
          height: img.height,
          storage_path: fileName,
          source: 'web',
          ocr_text: ocrResult.text,
          ocr_confidence: ocrResult.confidence,
          custom_tags: autoTags,
        },
      ]);

    if (dbError) throw dbError;
  };

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setUploading(true);
      const fileArray = Array.from(files);
      setUploadedFiles(fileArray.map((f) => ({ name: f.name, status: 'uploading' as FileStatus, message: 'Uploading...' })));

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        try {
          await uploadFile(file, i);
          setUploadedFiles((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, status: 'success' as FileStatus, message: 'Complete!' } : f))
          );
        } catch (error) {
          console.error('Upload error:', error);
          setUploadedFiles((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, status: 'error' as FileStatus, message: 'Failed' } : f))
          );
        }
      }

      setUploading(false);
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1500);
    },
    [user, onClose]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith('image/')
      );

      if (imageItems.length === 0) return;

      const files = await Promise.all(
        imageItems.map(async (item) => {
          const blob = item.getAsFile();
          if (!blob) return null;
          const timestamp = Date.now();
          return new File([blob], `screenshot_${timestamp}.png`, { type: blob.type });
        })
      );

      const validFiles = files.filter((f): f is File => f !== null);
      if (validFiles.length > 0) {
        const dt = new DataTransfer();
        validFiles.forEach((file) => dt.items.add(file));
        handleFiles(dt.files);
      }
    },
    [handleFiles]
  );

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Upload Screenshots</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50'
            }`}
          >
            <div className="flex flex-col items-center gap-4">
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center ${
                  isDragging ? 'bg-blue-100' : 'bg-gray-200'
                }`}
              >
                <Upload
                  className={`w-8 h-8 ${isDragging ? 'text-blue-600' : 'text-gray-500'}`}
                />
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  Drag and drop screenshots here
                </h3>
                <p className="text-gray-500 text-sm">or click to browse</p>
              </div>

              <label className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer">
                Browse Files
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileInput}
                  className="hidden"
                  disabled={uploading}
                />
              </label>

              <div className="text-xs text-gray-500 text-center">
                <p>Supported: PNG, JPG, WebP, GIF (Max 10MB per file)</p>
                <p className="mt-1">
                  <kbd className="px-2 py-1 bg-gray-200 rounded text-xs font-mono">Ctrl/Cmd + V</kbd>
                  {' '}to paste from clipboard
                </p>
              </div>
            </div>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="mt-6 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload Progress</h3>
              {uploadedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                >
                  {file.status === 'processing' ? (
                    <FileSearch className="w-5 h-5 text-blue-600" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-gray-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-700 truncate block">{file.name}</span>
                    {file.message && (
                      <span className="text-xs text-gray-500">{file.message}</span>
                    )}
                  </div>
                  {(file.status === 'uploading' || file.status === 'processing') && (
                    <Loader className="w-4 h-4 text-blue-600 animate-spin" />
                  )}
                  {file.status === 'success' && (
                    <span className="text-green-600 text-sm font-medium">✓</span>
                  )}
                  {file.status === 'error' && (
                    <span className="text-red-600 text-sm font-medium">✗</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
