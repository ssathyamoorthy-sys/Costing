import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { RawMaterialsPage } from './pages/RawMaterialsPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductEditPage } from './pages/ProductEditPage';
import { CustomersPage } from './pages/CustomersPage';
import { ItemTypesPage } from './pages/ItemTypesPage';
import { ProcessingChargesPage } from './pages/ProcessingChargesPage';
import { AccessoryTypesPage } from './pages/AccessoryTypesPage';
import { ExchangeRatesPage } from './pages/ExchangeRatesPage';
import { GeneralSettingsPage } from './pages/GeneralSettingsPage';
import { QuotesListPage } from './pages/QuotesListPage';
import { QuoteDetailPage } from './pages/QuoteDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/quotes" element={<QuotesListPage />} />
        <Route path="/quotes/:id" element={<QuoteDetailPage />} />
        <Route path="/raw-materials" element={<RawMaterialsPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductEditPage />} />
        <Route path="/products/:id" element={<ProductEditPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/item-types" element={<ItemTypesPage />} />
        <Route path="/processing-charges" element={<ProcessingChargesPage />} />
        <Route path="/accessory-types" element={<AccessoryTypesPage />} />
        <Route path="/exchange-rates" element={<ExchangeRatesPage />} />
        <Route path="/general-settings" element={<GeneralSettingsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
