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
            folder: {
                list: () => Promise<{ data: any[]; error: string | null }>;
                create: (name: string) => Promise<{ data: any; error: string | null }>;
                rename: (id: string, name: string) => Promise<{ data: boolean; error: string | null }>;
                delete: (id: string) => Promise<{ data: boolean; error: string | null }>;
                moveScreenshot: (screenshotId: string, folderId: string) => Promise<{ data: boolean; error: string | null }>;
            };
            file: {
                read: (path: string) => Promise<{ data: string; error: string | null }>;
                delete: (path: string) => Promise<boolean>;
                reveal: (path: string) => Promise<{ data: boolean; error: string | null }>;
                share: (path: string) => Promise<{ data: boolean; error: string | null }>;
            };
            import: {
                files: () => Promise<{ data: string[] | null; error: string | null }>;
                folder: () => Promise<{ data: { folderId: string; folderName: string; imported: string[] } | null; error: string | null }>;
                getScreenVaultPath: () => Promise<{ data: string; error: string | null }>;
                openScreenVaultFolder: () => Promise<{ data: boolean; error: string | null }>;
            };
            onScreenshotImported: (callback: (data: { id: string; filePath: string }) => void) => () => void;
            onFolderCreated: (callback: (data: { id: string; name: string }) => void) => () => void;
            onScreenshotSaved: (callback: (data: { id: string }) => void) => () => void;
            onScreenshotDeleted: (callback: (data: { filePath: string }) => void) => () => void;
            renameFile: (oldPath: string, newName: string) => Promise<{ newPath: string | null; error: string | null }>;
            onOCRProcess: (callback: (data: any) => void) => () => void;
        };
    }
}

export {};
