import { AuthProvider } from './contexts/AuthContext';
import { Dashboard } from './components/Dashboard';

function App() {
  return (
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
}

export default App;
