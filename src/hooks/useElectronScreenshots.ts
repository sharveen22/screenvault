import { useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '../lib/database';
import { extractTextFromImage, generateSmartFilename, generateTags } from '../lib/ocr';

type ScreenshotPayload =
  | {
      bytes: number[] | Uint8Array | ArrayBuffer; // preferred
      filename: string;
      bounds: { x: number; y: number; width: number; height: number } | null;
      filePath: string;
      buffer?: string; // base64 (back-compat)
    }
  | {
      buffer: string; // base64 / dataURL / CSV bytes (legacy)
      filename: string;
      bounds: { x: number; y: number; width: number; height: number } | null;
      filePath: string;
      bytes?: number[] | Uint8Array | ArrayBuffer;
    };

type OCRPayload = {
  screenshotId: string;
  filePath: string;
  fileName: string;
  base64: string;
};

export function useElectronScreenshots() {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const subscribedRef = useRef(false);
  const lastEventRef = useRef<{ sig: string; ts: number } | null>(null);
  const capturingRef = useRef(false);

  const makeSig = (d: ScreenshotPayload) => {
    const size =
      'bytes' in d && d.bytes != null
        ? (d.bytes as Uint8Array | ArrayBuffer | number[] as any)?.byteLength ||
          (Array.isArray(d.bytes) ? d.bytes.length : 0)
        : (d as any).buffer?.length ?? 0;
    const b: any = d.bounds || {};
    return `${d.filePath}|${b.x || 0},${b.y || 0},${b.width || 0},${b.height || 0}|${size}`;
  };

  const isCsvBytes = (s: string) => /^[0-9]+(?:,[0-9]+)+$/.test((s || '').trim());
  const isDataUrl = (s: string) => /^data:image\/[^;]+;base64,/.test(s || '');

  const html5Notify = async (title: string, body?: string) => {
    if ('Notification' in window) {
      try {
        if (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted') {
          new Notification(title, { body });
        }
      } catch {
        // ignore
      }
    }
  };

  const toUint8 = (data: ScreenshotPayload): Uint8Array => {
    if ('bytes' in data && data.bytes != null) {
      const b: any = data.bytes;
      if (b instanceof Uint8Array) return b;
      if (b instanceof ArrayBuffer) return new Uint8Array(b);
      if (Array.isArray(b)) return new Uint8Array(b);
    }
    const buf = (data as any).buffer as string;
    if (!buf) return new Uint8Array();
    if (isCsvBytes(buf)) {
      return new Uint8Array(buf.split(',').map((n) => Math.max(0, Math.min(255, Number(n.trim())))));
    }
    const base64 = isDataUrl(buf) ? buf.split(',')[1] || '' : buf;
    const bin = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  // Background OCR processing (non-blocking)
  const processOCRInBackground = async (file: File, screenshotId: string, originalName: string, storagePath: string) => {
    try {
      const ocr = await extractTextFromImage(file);
      const ocrText = ocr?.text || '';
      const ocrConf = (ocr as any)?.confidence ?? null;

      if (!ocrText.trim()) {
        // No text found, skip update
        return;
      }

      // Generate smart filename and tags from OCR
      const smartName = generateSmartFilename(ocrText, originalName);
      const tags = generateTags(ocrText);

      // Rename the actual file on disk to match smart name
      let newStoragePath = storagePath;
      if (smartName !== originalName && storagePath && (window.electronAPI as any)?.renameFile) {
        try {
          const result = await (window.electronAPI as any).renameFile(storagePath, smartName);
          if (result?.newPath) {
            newStoragePath = result.newPath;
            console.log(`[OCR] Renamed file: ${storagePath} -> ${newStoragePath}`);
          }
        } catch (renameErr) {
          console.warn('[OCR] File rename failed, keeping original name:', renameErr);
          // Keep using original storage path if rename fails
        }
      }

      // Update database with OCR results and new path
      await db
        .from('screenshots')
        .update({
          file_name: smartName,
          storage_path: newStoragePath,
          ocr_text: ocrText,
          ocr_confidence: ocrConf,
          custom_tags: tags,
        })
        .eq('id', screenshotId)
        .select();

      console.log(`[OCR] Completed for ${screenshotId}: ${ocrText.length} chars`);
    } catch (e) {
      console.warn('[OCR] Background processing failed:', e);
      // Silent fail - screenshot is already saved
    }
  };

  const handleScreenshot = useCallback(
    async (data: ScreenshotPayload) => {
      // DEDUPE < 600ms
      const now = Date.now();
      const sig = makeSig(data);
      const last = lastEventRef.current;
      if (last && last.sig === sig && now - last.ts < 600) return;
      lastEventRef.current = { sig, ts: now };

      try {
        // ---- Bytes -> Blob/File ----
        const bytes = toUint8(data);
        if (!bytes || bytes.length === 0) throw new Error('Empty bytes');

        const blob = new Blob([bytes as any], { type: 'image/png' });
        const file = new File([blob], (data as any).filename || 'screenshot.png', { type: 'image/png' });

        // ---- Get dimensions (fast) ----
        let width = 0,
          height = 0;
        try {
          const bmp = await createImageBitmap(blob);
          width = bmp.width;
          height = bmp.height;
          bmp.close();
        } catch {
          // safe to ignore
        }

        // ---- SAVE IMMEDIATELY (without OCR) ----
        const rowId =
          (globalThis.crypto as any)?.randomUUID?.() ??
          Math.random().toString(36).slice(2) + Date.now().toString(36);

        const baseName = (data as any).filename || 'screenshot.png';

        const { error: insertErr } = await db
          .from('screenshots')
          .insert({
            id: rowId,
            file_name: baseName,           // Use original name initially
            file_size: file.size,
            file_type: file.type,
            width,
            height,
            storage_path: (data as any).filePath,
            source: 'desktop',
            ocr_text: '',                  // Empty initially
            ocr_confidence: null,
            custom_tags: [],               // Empty initially
            ai_tags: [],
            user_notes: '',
            is_favorite: false,
            is_archived: false,
            thumbnail_path: null,
            ai_description: null,
            folder_id: null,
            view_count: 0,
          })
          .select();

        if (insertErr) throw insertErr;

        // ✅ Notify: screenshot saved immediately
        const sizeKB = Math.max(1, Math.round(file.size / 1024));
        if ((window.electronAPI as any)?.notify) {
          await (window.electronAPI as any).notify({
            title: 'Screenshot saved',
            body: `${baseName} • ${width || '?'}×${height || '?'} (${sizeKB} KB)`,
            silent: true,
          });
        } else {
          await html5Notify('Screenshot saved', `${baseName}`);
        }

        // DON'T reload page - this brings the window to foreground!
        // Dispatch event instead for gallery to refresh
        window.dispatchEvent(new CustomEvent('screenshot-saved-local', { 
          detail: { id: rowId, fileName: baseName } 
        }));

        // ---- OCR IN BACKGROUND (async, non-blocking) ----
        processOCRInBackground(file, rowId, baseName, (data as any).filePath);

      } catch (error) {
        console.error('[Screenshot] Error processing:', error);
        if ((window.electronAPI as any)?.notify) {
          await (window.electronAPI as any).notify({
            title: 'Save failed',
            body: error instanceof Error ? error.message : 'Unexpected error',
          });
        } else {
          await html5Notify('Save failed', error instanceof Error ? error.message : 'Unexpected error');
        }
      }
    },
    []
  );

  // Handle OCR processing triggered from main process
  const handleOCRProcess = useCallback(async (data: OCRPayload) => {
    console.log('[OCR] Received OCR request for:', data.screenshotId);
    
    // Dispatch event to show loading state
    window.dispatchEvent(new CustomEvent('ocr-start', { 
      detail: { screenshotId: data.screenshotId } 
    }));
    
    try {
      // Convert base64 to File
      const binary = atob(data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], data.fileName, { type: 'image/png' });

      // Run OCR
      const ocr = await extractTextFromImage(file);
      const ocrText = ocr?.text || '';
      const ocrConf = ocr?.confidence ?? null;

      console.log(`[OCR] Extracted ${ocrText.length} chars from ${data.fileName}`);

      if (!ocrText.trim()) {
        console.log('[OCR] No text found, skipping update');
        return;
      }

      // Generate smart filename and tags
      const smartName = generateSmartFilename(ocrText, data.fileName);
      const tags = generateTags(ocrText);

      console.log(`[OCR] Smart name: ${smartName}, Tags: ${tags.join(', ')}`);

      // Rename the actual file on disk to match smart name
      let newStoragePath = data.filePath;
      if (smartName !== data.fileName && data.filePath && (window.electronAPI as any)?.renameFile) {
        try {
          const result = await (window.electronAPI as any).renameFile(data.filePath, smartName);
          if (result?.newPath) {
            newStoragePath = result.newPath;
            console.log(`[OCR] Renamed file: ${data.filePath} -> ${newStoragePath}`);
          }
        } catch (renameErr) {
          console.warn('[OCR] File rename failed:', renameErr);
        }
      }

      // Update database with OCR results
      const { error } = await db
        .from('screenshots')
        .update({
          file_name: smartName,
          storage_path: newStoragePath,
          ocr_text: ocrText,
          ocr_confidence: ocrConf,
          custom_tags: tags,
        })
        .eq('id', data.screenshotId)
        .select();

      if (error) {
        console.error('[OCR] Database update failed:', error);
      } else {
        console.log(`[OCR] Completed for ${data.screenshotId}`);
        
        // Dispatch custom event to notify gallery to refresh (without page reload)
        window.dispatchEvent(new CustomEvent('ocr-complete', { 
          detail: { screenshotId: data.screenshotId, smartName, tags } 
        }));
        
        // DON'T reload page - this brings the window to foreground!
        // The gallery will refresh via the ocr-complete event
      }
    } catch (e) {
      console.error('[OCR] Processing failed:', e);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    let off: (() => void) | undefined;
    const handler = (data: ScreenshotPayload) => void handleScreenshot(data);

    try {
      off = window.electronAPI?.onScreenshotCaptured?.(handler) as (() => void) | undefined;
    } catch (e) {
      console.error('Failed to subscribe to screenshot events:', e);
    }

    // Subscribe to OCR processing events
    let offOCR: (() => void) | undefined;
    try {
      offOCR = (window.electronAPI as any)?.onOCRProcess?.(handleOCRProcess) as (() => void) | undefined;
      console.log('[OCR] Subscribed to OCR events');
    } catch (e) {
      console.error('Failed to subscribe to OCR events:', e);
    }

    const offLog = (window.electronAPI as any)?.onLog?.((_p: any) => {
      // Optional: display logs
    });

    return () => {
      try {
        if (off) off();
        else (window.electronAPI as any)?.offScreenshotCaptured?.(handler);
        if (offOCR) offOCR();
        offLog && offLog();
      } catch (e) {
        console.warn('Cleanup screenshot listener failed:', e);
      }
      subscribedRef.current = false;
    };
  }, [isElectron, handleScreenshot, handleOCRProcess]);

  const takeScreenshot = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.takeScreenshot) return;
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      await window.electronAPI.takeScreenshot();
    } finally {
      setTimeout(() => {
        capturingRef.current = false;
      }, 250);
    }
  }, [isElectron]);

  return useMemo(
    () => ({ isElectron, takeScreenshot }),
    [isElectron, takeScreenshot]
  );
}
