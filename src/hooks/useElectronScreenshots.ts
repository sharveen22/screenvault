import { useEffect } from 'react';
import { db } from '../lib/database';
import { extractTextFromImage, generateSmartFilename, generateTags } from '../lib/ocr';

export function useElectronScreenshots(userId: string | undefined) {
  useEffect(() => {
    if (!window.electronAPI || !userId) return;

    const handleScreenshot = async (data: {
      buffer: string;
      filename: string;
      bounds: any;
      filePath: string;
    }) => {
      try {
        console.log('Screenshot received from Electron');

        const binaryString = atob(data.buffer);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'image/png' });
        const file = new File([blob], data.filename, { type: 'image/png' });

        const ocrResult = await extractTextFromImage(file);
        const smartFilename = generateSmartFilename(ocrResult.text, data.filename);
        const autoTags = generateTags(ocrResult.text);

        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const { error: dbError } = await db.from('screenshots').insert({
          id: crypto.randomUUID(),
          user_id: userId,
          file_name: smartFilename,
          file_size: file.size,
          file_type: file.type,
          width: img.width,
          height: img.height,
          storage_path: data.filePath,
          source: 'desktop',
          ocr_text: ocrResult.text,
          ocr_confidence: ocrResult.confidence,
          custom_tags: autoTags,
          ai_tags: [],
          user_notes: '',
          is_favorite: false,
          is_archived: false,
          thumbnail_path: null,
          ai_description: null,
          folder_id: null,
          view_count: 0,
        }).select();

        if (dbError) throw dbError;

        console.log('Screenshot saved successfully');

        window.location.reload();
      } catch (error) {
        console.error('Error processing screenshot:', error);
      }
    };

    window.electronAPI.onScreenshotCaptured(handleScreenshot);
  }, [userId]);

  return {
    isElectron: !!window.electronAPI,
    takeScreenshot: window.electronAPI?.takeScreenshot,
  };
}
