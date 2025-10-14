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
          where?: any;
        }) => Promise<{ data: any; error: string | null }>;
      };
      file: {
        read: (filePath: string) => Promise<{ data: string; error: string | null }>;
      };
    };
  }
}

export const isElectron = !!window.electronAPI;

export const db = {
  from: (table: string) => ({
    select: (columns = '*') => {
      let whereClause: any = null;
      let orderClause: { column: string; ascending: boolean } | null = null;
      let limitValue: number | null = null;

      const buildQuery = async () => {
        const { data, error } = await window.electronAPI!.db.query({
          table,
          operation: 'select',
          where: whereClause,
        });

        if (error) return { data: null, error };

        let result = data || [];

        if (orderClause) {
          result = [...result].sort((a, b) => {
            if (orderClause!.ascending) {
              return a[orderClause!.column] > b[orderClause!.column] ? 1 : -1;
            }
            return a[orderClause!.column] < b[orderClause!.column] ? 1 : -1;
          });
        }

        if (limitValue !== null) {
          result = result.slice(0, limitValue);
        }

        return { data: result, error: null };
      };

      const queryBuilder: any = {
        eq: (column: string, value: any) => {
          whereClause = { [column]: value };
          return queryBuilder;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          orderClause = { column, ascending: options?.ascending ?? false };
          return queryBuilder;
        },
        limit: (count: number) => {
          limitValue = count;
          return buildQuery();
        },
        maybeSingle: async () => {
          const { data, error } = await buildQuery();
          return { data: data?.[0] || null, error };
        },
        single: async () => {
          const { data, error } = await buildQuery();
          if (!data?.[0]) {
            return { data: null, error: 'No rows found' };
          }
          return { data: data[0], error };
        },
      };

      return queryBuilder;
    },
    insert: (values: any) => ({
      select: async () => {
        const id = crypto.randomUUID();
        const dataWithId = Array.isArray(values) ? values.map(v => ({ ...v, id })) : { ...values, id };

        if (Array.isArray(dataWithId)) {
          for (const item of dataWithId) {
            await window.electronAPI!.db.query({
              table,
              operation: 'insert',
              data: item,
            });
          }
        } else {
          await window.electronAPI!.db.query({
            table,
            operation: 'insert',
            data: dataWithId,
          });
        }

        return { data: dataWithId, error: null };
      },
    }),
    update: (data: any) => ({
      eq: (column: string, value: any) => ({
        select: async () => {
          const { error } = await window.electronAPI!.db.query({
            table,
            operation: 'update',
            data,
            where: { [column]: value },
          });
          return { data, error };
        },
      }),
    }),
    delete: () => ({
      eq: (column: string, value: any) => window.electronAPI!.db.query({
        table,
        operation: 'delete',
        where: { [column]: value },
      }),
    }),
  }),
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, file: File) => {
        return { data: { path }, error: null };
      },
      getPublicUrl: (path: string) => {
        return { data: { publicUrl: path } };
      },
    }),
  },
};

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
  created_at: string;
  updated_at: string;
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
