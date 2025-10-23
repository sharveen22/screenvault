import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { isElectron, UserExtended } from '../lib/database';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  userProfile: UserExtended | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Set default user without authentication
  const [user, setUser] = useState<User | null>({ 
    id: 'default-user', 
    email: 'user@screenvault.app' 
  });
  const [userProfile, setUserProfile] = useState<UserExtended | null>({
    id: 'default-user',
    email: 'user@screenvault.app',
    plan: 'Free',
    storage_used: 0,
    storage_limit: 1024 * 1024 * 1024, // 1GB
    screenshot_count: 0,
    onboarding_completed: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // No need to check session, just set loading to false
    setLoading(false);
  }, []);

  const signUp = async (email: string, password: string) => {
    // if (!isElectron) {
    //   return { error: 'Desktop app only' };
    // }

    try {
      const { user: newUser, error } = await window.electronAPI!.auth.signUp(email, password);

      if (error) {
        return { error };
      }

      setUser({ id: newUser.id, email: newUser.email });
      setUserProfile(newUser);

      return { error: null };
    } catch (error: any) {
      return { error: error.message };
    }
  };

  const signIn = async (email: string, password: string) => {
    // if (!isElectron) {
    //   return { error: 'Desktop app only' };
    // }

    try {
      const { user: currentUser, error } = await window.electronAPI!.auth.signIn(email, password);

      if (error) {
        return { error };
      }

      setUser({ id: currentUser.id, email: currentUser.email });
      setUserProfile(currentUser);

      return { error: null };
    } catch (error: any) {
      return { error: error.message };
    }
  };

  const signOut = async () => {
    // No sign out needed since we don't have authentication
    console.log('Sign out called but authentication is disabled');
  };

  const value = {
    user,
    userProfile,
    loading,
    signUp,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
