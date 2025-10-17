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

declare global {
  interface Window {
    electronAPI?: {
      takeScreenshot?: () => Promise<void> | void;
      onScreenshotCaptured?: (cb: (data: ScreenshotPayload) => void) => (() => void) | void;
      offScreenshotCaptured?: (cb: (data: ScreenshotPayload) => void) => void;
      onLog?: (cb: (p: { ts: string; level: string; msg: string }) => void) => (() => void) | void;
      openMacScreenSettings?: () => Promise<void> | void;

      // ✅ Notifikasi dari Electron (pastikan sudah diexpose di preload)
      notify?: (payload: {
        id?: string;
        title: string;
        body?: string;
        silent?: boolean;
        focus?: boolean;
        openPath?: string;
        openUrl?: string;
        actions?: { text: string; openPath?: string; openUrl?: string; channel?: string }[];
        closeButtonText?: string;
      }) => Promise<boolean> | boolean | void;
      onNotificationAction?: (cb: (data: { id?: string; index: number; action: any }) => void) => (() => void) | void;
    };
  }
}

export function useElectronScreenshots(userId: string | undefined) {
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

  // bytes first
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

  const handleScreenshot = useCallback(
    async (data: ScreenshotPayload) => {
      // DEDUPE < 600ms
      const now = Date.now();
      const sig = makeSig(data);
      const last = lastEventRef.current;
      if (last && last.sig === sig && now - last.ts < 600) return;
      lastEventRef.current = { sig, ts: now };

      if (!userId) return;

      try {
        // ---- Bytes -> Blob/File ----
        const bytes = toUint8(data);
        if (!bytes || bytes.length === 0) throw new Error('Empty bytes');

        const blob = new Blob([bytes], { type: 'image/png' });
        const file = new File([blob], (data as any).filename || 'screenshot.png', { type: 'image/png' });

        // ---- Dimensi (cepat) ----
        let width = 0,
          height = 0;
        try {
          const bmp = await createImageBitmap(blob);
          width = bmp.width;
          height = bmp.height;
          bmp.close();
        } catch {
          // aman diabaikan
        }

        // ---- OCR (JALANKAN SEBELUM INSERT) ----
        // Notifikasi: mulai OCR
        const ocrStartId = `ocr-${Date.now()}`;
        if (window.electronAPI?.notify) {
          await window.electronAPI.notify({
            id: ocrStartId,
            title: 'Processing OCR',
            body: 'Analyzing text from screenshot…',
            silent: true,
          });
        } else {
          await html5Notify('Processing OCR', 'Analyzing text from screenshot…');
        }

        let ocrText = '';
        let ocrConf: number | null = null;
        let ocrOk = false;
        try {
          const ocr = await extractTextFromImage(file);
          ocrText = ocr?.text || '';
          ocrConf = (ocr as any)?.confidence ?? null;
          ocrOk = !!ocrText?.trim();
          // Notifikasi: hasil OCR (sukses/empty)
          if (ocrOk) {
            await window.electronAPI?.notify?.({
              title: 'OCR complete',
              body: `Extracted ~${Math.min(ocrText.length, 80)} chars`,
              silent: true,
            });
          } else {
            await window.electronAPI?.notify?.({
              title: 'OCR complete',
              body: 'No text detected',
              silent: true,
            });
          }
        } catch (e) {
          console.warn('OCR failed, continue insert with empty OCR:', e);
          // Notifikasi: OCR gagal
          if (window.electronAPI?.notify) {
            await window.electronAPI.notify({
              title: 'OCR failed',
              body: 'Saved without OCR text',
              silent: true,
            });
          } else {
            await html5Notify('OCR failed', 'Saved without OCR text');
          }
        }

        // ---- Smart filename & tags (berdasarkan OCR) ----
        const baseName = (data as any).filename || 'screenshot.png';
        const smartName = generateSmartFilename(ocrText, baseName);
        const tags = generateTags(ocrText);

        // ---- Insert ke DB (lengkap) ----
        const rowId =
          (globalThis.crypto as any)?.randomUUID?.() ??
          Math.random().toString(36).slice(2) + Date.now().toString(36);

        const { error: insertErr } = await db
          .from('screenshots')
          .insert({
            id: rowId,
            user_id: userId,
            file_name: smartName,           // langsung pakai nama cerdas
            file_size: file.size,
            file_type: file.type,
            width,
            height,
            storage_path: (data as any).filePath,
            source: 'desktop',
            ocr_text: ocrText,              // hasil OCR
            ocr_confidence: ocrConf,        // confidence jika tersedia
            custom_tags: tags,              // pakai generator tags kamu
            ai_tags: [],                    // bisa diisi nanti kalau ada pipeline AI
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

        // ✅ Notifikasi: screenshot tersimpan
        const sizeKB = Math.max(1, Math.round(file.size / 1024));
        if (window.electronAPI?.notify) {
          await window.electronAPI.notify({
            title: 'Screenshot saved',
            body: `${smartName} • ${width || '?'}×${height || '?'} (${sizeKB} KB)`,
            focus: false,
            openPath: (data as any).filePath,
            actions: [
              { text: 'Show in folder', openPath: (data as any).filePath },
            ],
          });
        } else {
          await html5Notify('Screenshot saved', `${smartName}`);
        }

        // (opsional) refresh UI ringan
        setTimeout(() => {
          if (typeof window !== 'undefined') window.location.reload();
        }, 50);

      } catch (error) {
        console.error('Error processing screenshot (OCR-first path):', error);
        // Notifikasi error proses keseluruhan
        if (window.electronAPI?.notify) {
          await window.electronAPI.notify({
            title: 'Save failed',
            body: error instanceof Error ? error.message : 'Unexpected error',
          });
        } else {
          await html5Notify('Save failed', error instanceof Error ? error.message : 'Unexpected error');
        }
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!isElectron || !userId) return;
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    let off: (() => void) | undefined;
    const handler = (data: ScreenshotPayload) => void handleScreenshot(data);

    try {
      off = window.electronAPI?.onScreenshotCaptured?.(handler) as (() => void) | undefined;
    } catch (e) {
      console.error('Failed to subscribe to screenshot events:', e);
    }

    // optional: log dari main
    const offLog = window.electronAPI?.onLog?.((_p) => {
      // contoh: tampilkan ke toast/devtools jika mau
      // console.debug('[MainLog]', p.level, p.msg);
    });

    return () => {
      try {
        if (off) off();
        else window.electronAPI?.offScreenshotCaptured?.(handler);
        offLog && offLog();
      } catch (e) {
        console.warn('Cleanup screenshot listener failed:', e);
      }
      subscribedRef.current = false;
    };
  }, [isElectron, userId, handleScreenshot]);

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
