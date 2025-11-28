/// <reference types="vite/client" />

declare global {
    interface Window {
        readonly electronAPI: {
            takeScreenshot: () => Promise<void>;
            onScreenshotCaptured: (callback: (data: any) => void) => () => void;
            offScreenshotCaptured: (callback: (data: any) => void) => void;
            onLog: (callback: (payload: any) => void) => () => void;
            openMacScreenSettings: () => Promise<void>;
            notify: (payload: any) => Promise<boolean>;
            onNotificationAction: (callback: (data: any) => void) => () => void;

            // Popup / Editor API
            onInit: (callback: (filePath: string) => void) => () => void;
            copy: () => void;
            copyData: (dataUrl: string) => void;
            save: (dataUrl: string) => void;
            trash: () => void;
            share: () => void;
            close: () => void;

            auth: {
                signUp: (email: string, password: string) => Promise<{ user: any; error: string | null }>;
                signIn: (email: string, password: string) => Promise<{ user: any; error: string | null }>;
                signOut: () => Promise<{ error: null }>;
                getSession: () => Promise<{ user: any }>;
            };
            db: {
                query: (params: any) => Promise<{ data: any; error: string | null }>;
                getInfo: () => Promise<{ data: any; error: string | null }>;
                export: (path: string) => Promise<{ data: any; error: string | null }>;
                import: (path: string) => Promise<{ data: any; error: string | null }>;
                getPath: () => Promise<{ data: string; error: string | null }>;
            };
            file: {
                read: (path: string) => Promise<{ data: string; error: string | null }>;
                delete: (path: string) => Promise<boolean>;
            };
        };
    }
}
