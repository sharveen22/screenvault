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
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserExtended | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    if (isElectron) {
      try {
        const { user: currentUser } = await window.electronAPI!.auth.getSession();
        if (currentUser) {
          setUser({ id: currentUser.id, email: currentUser.email });
          setUserProfile(currentUser);
        }
      } catch (error) {
        console.error('Error checking session:', error);
      }
    }
    setLoading(false);
  };

  const signUp = async (email: string, password: string) => {
    if (!isElectron) {
      return { error: 'Desktop app only' };
    }

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
    if (!isElectron) {
      return { error: 'Desktop app only' };
    }

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
    if (isElectron) {
      await window.electronAPI!.auth.signOut();
    }
    setUser(null);
    setUserProfile(null);
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
