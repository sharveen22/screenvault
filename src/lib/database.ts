// db.ts (fixed)

declare global {
  interface Window {
    electronAPI?: {
      takeScreenshot: () => Promise<void>;
      onScreenshotCaptured: (callback: (data: any) => void) => void;
      auth: {
        signUp: (email: string, password: string) => Promise<{ user: any; error: string | null }>;
        signIn: (email: string, password: string) => Promise<{ user: any; error: string | null }>;
        signOut: () => Promise<{ error: string | null }>;
        getSession: () => Promise<{ user: any }>;
      };
      db: {
        query: (params: {
          table: string;
          operation: 'select' | 'insert' | 'update' | 'delete';
          data?: any;
          where?: Record<string, any>;
          orderBy?: { column: string; direction?: 'asc' | 'desc' };
          limit?: number;
          offset?: number;
        }) => Promise<{ data: any; error: string | null }>;
      };
      file: {
        delete: (filePath: string) => Promise<{ data: string; error: string | null }>;
        read: (filePath: string) => Promise<{ data: string; error: string | null }>;
      };
    };
  }
}

/** ==== Types ==== */

type Direction = 'asc' | 'desc';

type OrderByOpt =
  | { column: string; direction?: Direction; ascending?: boolean }
  | undefined;

type SelectOptions = {
  where?: Record<string, any>;
  orderBy?: OrderByOpt;
  limit?: number;
  offset?: number;
  columns?: string; // tidak dipakai oleh IPC saat ini, disimpan untuk kompatibilitas API
};

type DBQueryParams = Parameters<NonNullable<Window['electronAPI']>['db']['query']>[0];

type DBResponse<T = any> = Promise<{ data: T; error: string | null }>;

/** ==== Utils ==== */

const hasWindow = typeof window !== 'undefined';
const api = hasWindow ? window.electronAPI : undefined;

export const isElectron = !!api;

function assertElectron(method: string): asserts api is NonNullable<typeof window.electronAPI> {
  if (!api) {
    throw new Error(`[db] Electron API not available. Tried to call: ${method}`);
  }
}

/** Normalisasi direction:
 * - hormati orderBy.direction jika ada
 * - kalau pakai ascending, true => 'asc', false => 'desc'
 * - default 'desc'
 */
function normalizeDirection(orderBy?: OrderByOpt): Direction | undefined {
  if (!orderBy) return undefined;

  if (orderBy.direction) {
    const d = orderBy.direction.toLowerCase();
    return d === 'asc' || d === 'desc' ? d : 'desc';
  }

  if (typeof orderBy.ascending === 'boolean') {
    return orderBy.ascending ? 'asc' : 'desc';
  }

  // default kalau kolom ada tapi arah tak didefinisikan -> desc
  return 'desc';
}

function toIPCOrderBy(orderBy?: OrderByOpt):
  | { column: string; direction: Direction }
  | undefined {
  if (!orderBy || !('column' in orderBy) || !orderBy?.column) return undefined;
  const direction = (normalizeDirection(orderBy) ?? 'desc').toUpperCase() as Direction;
  return { column: String(orderBy.column).trim(), direction };
}

/** ==== DB Wrapper ==== */

export const db = {
  from: (table: string) => ({
    /** SELECT
     *  Mode 1: select(options) -> eksekusi langsung via IPC
     *  Mode 2: select() -> kembalikan builder lama (eq().all(), maybeSingle(), single(), order().limit())
     */
    select: <T = any>(options?: SelectOptions) => {
      // Mode eksekusi langsung
      if (options) {
        assertElectron('db.query(select:immediate)');
        const payload: DBQueryParams = {
          table,
          operation: 'select',
          where: options.where,
          orderBy: toIPCOrderBy(options.orderBy),
          limit: options.limit,
          offset: options.offset,
        };
        return api!.db.query(payload) as DBResponse<T[]>;
      }

      // Mode builder kompat lama
      return {
        /** Ambil semua baris tanpa where */
        all: async (): DBResponse<T[]> => {
          assertElectron('db.query(select:builder.all)');
          return api!.db.query({
            table,
            operation: 'select',
          });
        },

        /** WHERE eq(...) + varian pengambil */
        eq: (column: string, value: any) => ({
          all: async (): DBResponse<T[]> => {
            assertElectron('db.query(select:eq.all)');
            return api!.db.query({
              table,
              operation: 'select',
              where: { [column]: value },
            });
          },
          maybeSingle: async (): DBResponse<T | null> => {
            assertElectron('db.query(select:eq.maybeSingle)');
            const { data, error } = await api!.db.query({
              table,
              operation: 'select',
              where: { [column]: value },
            });
            return { data: (Array.isArray(data) ? data[0] : null) ?? null, error };
          },
          single: async (): DBResponse<T> => {
            assertElectron('db.query(select:eq.single)');
            const { data, error } = await api!.db.query({
              table,
              operation: 'select',
              where: { [column]: value },
            });
            if (!Array.isArray(data) || !data[0]) {
              return { data: null as unknown as T, error: error ?? 'No rows found' };
            }
            return { data: data[0], error };
          },
        }),

        /** ORDER BY + LIMIT (kompat lama) */
        order: (column: string, options?: { ascending?: boolean }) => ({
          limit: async (count: number): DBResponse<T[]> => {
            assertElectron('db.query(select:order.limit)');
            return api!.db.query({
              table,
              operation: 'select',
              orderBy: {
                column,
                direction: options?.ascending ? 'asc' : 'desc',
              },
              limit: count,
            });
          },
        }),
      };
    },

    /** INSERT (dengan auto id kalau belum ada) */
    insert: (values: any) => ({
      select: async (): DBResponse<any> => {
        assertElectron('db.query(insert)');
        const genId =
          (globalThis as any)?.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const dataWithId = Array.isArray(values)
          ? values.map((v) => ({ id: v?.id ?? genId, ...v }))
          : { id: values?.id ?? genId, ...values };

        if (Array.isArray(dataWithId)) {
          for (const item of dataWithId) {
            await api!.db.query({
              table,
              operation: 'insert',
              data: item,
            });
          }
        } else {
          await api!.db.query({
            table,
            operation: 'insert',
            data: dataWithId,
          });
        }

        return { data: dataWithId, error: null };
      },
    }),

    /** UPDATE ... WHERE column = value */
    update: (data: any) => ({
      eq: (column: string, value: any) => ({
        select: async (): DBResponse<any> => {
          assertElectron('db.query(update)');
          const { error } = await api!.db.query({
            table,
            operation: 'update',
            data,
            where: { [column]: value },
          });
          return { data, error };
        },
      }),
    }),

    /** DELETE ... WHERE column = value */
    delete: () => ({
      eq: (column: string, value: any): DBResponse<any> => {
        assertElectron('db.query(delete)');
        return api!.db.query({
          table,
          operation: 'delete',
          where: { [column]: value },
        });
      },
    }),
  }),

  /** Storage stub untuk kompatibilitas */
  storage: {
    from: (_bucket: string) => ({
      upload: async (path: string, _file: File) => {
        // Di Electron kamu bisa arahkan ke file system, disini stub sukses
        return { data: { path }, error: null };
      },
      getPublicUrl: (path: string) => {
        return { data: { publicUrl: path } };
      },
    }),
  },
};

/** ==== Domain Types ==== */

export type Screenshot = {
  id: string;
  user_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  width: number | null;
  height: number | null;
  storage_path: string;
  thumbnail_path: string | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  ai_description: string | null;
  ai_tags: string[];
  custom_tags: string[];
  user_notes: string;
  is_favorite: boolean;
  is_archived: boolean;
  folder_id: string | null;
  source: string;
  view_count: number;
  created_at: string; // ISO string
  updated_at: string; // ISO string
};

export type Folder = {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string;
  icon: string;
  screenshot_count: number;
  created_at: string;
};

export type UserExtended = {
  id: string;
  email: string;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  storage_used: number;
  storage_limit: number;
  screenshot_count: number;
  onboarding_completed: boolean;
  preferences: Record<string, any>;
  created_at: string;
  updated_at: string;
};
