import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { extractTextFromImage, generateSmartFilename, generateTags } from '../lib/ocr';

declare global {
  interface Window {
    electronAPI?: {
      takeScreenshot: () => Promise<void>;
      onScreenshotCaptured: (callback: (data: any) => void) => void;
    };
  }
}

export function useElectronScreenshots(userId: string | undefined) {
  useEffect(() => {
    if (!window.electronAPI || !userId) return;

    const handleScreenshot = async (data: {
      buffer: string;
      filename: string;
      bounds: any;
    }) => {
      try {
        console.log('Screenshot received from Electron');

        const buffer = Buffer.from(data.buffer, 'base64');
        const blob = new Blob([buffer], { type: 'image/png' });
        const file = new File([blob], data.filename, { type: 'image/png' });

        const ocrResult = await extractTextFromImage(file);
        const smartFilename = generateSmartFilename(ocrResult.text, data.filename);
        const autoTags = generateTags(ocrResult.text);

        const fileName = `${userId}/${Date.now()}-${smartFilename}`;

        const { error: uploadError } = await supabase.storage
          .from('screenshots')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const { error: dbError } = await supabase.from('screenshots').insert([
          {
            user_id: userId,
            file_name: smartFilename,
            file_size: file.size,
            file_type: file.type,
            width: img.width,
            height: img.height,
            storage_path: fileName,
            source: 'desktop',
            ocr_text: ocrResult.text,
            ocr_confidence: ocrResult.confidence,
            custom_tags: autoTags,
          },
        ]);

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
