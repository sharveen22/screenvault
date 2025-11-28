import { useState, useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { Dashboard } from './components/Dashboard';
import { Editor } from './components/Editor';

function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (route === '#editor') {
    return <Editor />;
  }

  return (
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
}

export default App;
