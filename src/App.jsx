import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { DialogProvider } from './components/AppDialog.jsx'

const PinLogin = lazy(() => import('./pages/PinLogin.jsx'))
const PosScreen = lazy(() => import('./pages/pos/PosScreen.jsx'))
const StaffCustomers = lazy(() => import('./pages/pos/StaffCustomers.jsx'))
const StaffCustomerDetail = lazy(() => import('./pages/pos/StaffCustomerDetail.jsx'))
const CustomerDisplay = lazy(() => import('./pages/display/CustomerDisplay.jsx'))
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard.jsx'))
const Reconcile = lazy(() => import('./pages/admin/Reconcile.jsx'))
const Catalog = lazy(() => import('./pages/admin/Catalog.jsx'))
const Rewards = lazy(() => import('./pages/admin/Rewards.jsx'))
const Approvals = lazy(() => import('./pages/admin/Approvals.jsx'))
const Commission = lazy(() => import('./pages/admin/Commission.jsx'))
const People = lazy(() => import('./pages/admin/People.jsx'))
const Receipts = lazy(() => import('./pages/admin/Receipts.jsx'))
const ReceiptDetail = lazy(() => import('./pages/admin/ReceiptDetail.jsx'))
const Customers = lazy(() => import('./pages/admin/Customers.jsx'))
const CustomerDetail = lazy(() => import('./pages/admin/CustomerDetail.jsx'))
const CustomerDisplayMedia = lazy(() => import('./pages/admin/CustomerDisplayMedia.jsx'))
const SystemSettings = lazy(() => import('./pages/admin/SystemSettings.jsx'))
const BranchCounters = lazy(() => import('./pages/admin/BranchCounters.jsx'))
const LiffMember = lazy(() => import('./pages/liff/LiffMember.jsx'))

function RequireStaff({ children, ownerOnly = false }) {
  const { staff, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="min-h-screen grid place-items-center text-sagegray">กำลังตรวจสอบ session…</div>
  if (!staff) {
    const from = location.pathname + location.search + location.hash
    return <Navigate to="/login" replace state={{ from }} />
  }
  if (ownerOnly && staff.role !== 'owner') return <Navigate to="/pos" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <DialogProvider>
      <Suspense fallback={<div className="min-h-screen grid place-items-center text-sagegray">กำลังโหลด…</div>}>
        <Routes>
          <Route path="/login" element={<PinLogin />} />
          <Route path="/pos" element={<RequireStaff><PosScreen /></RequireStaff>} />
          <Route path="/pos/pending" element={<RequireStaff><PosScreen /></RequireStaff>} />
          <Route path="/pos/customers" element={<RequireStaff><StaffCustomers /></RequireStaff>} />
          <Route path="/pos/customers/:memberId" element={<RequireStaff><StaffCustomerDetail /></RequireStaff>} />
          <Route path="/display" element={<CustomerDisplay />} />
          <Route path="/liff" element={<LiffMember />} />
          <Route path="/admin" element={<RequireStaff ownerOnly><AdminLayout /></RequireStaff>}>
            <Route index element={<Dashboard />} />
            <Route path="reconcile" element={<Reconcile />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="receipts" element={<Receipts />} />
            <Route path="receipts/:orderId" element={<ReceiptDetail />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:memberId" element={<CustomerDetail />} />
            <Route path="settings" element={<SystemSettings />} />
            <Route path="settings/display" element={<CustomerDisplayMedia />} />
            <Route path="settings/branch-counters" element={<BranchCounters />} />
            <Route path="settings/catalog" element={<Catalog />} />
            <Route path="settings/rewards" element={<Rewards />} />
            <Route path="settings/commission" element={<Commission />} />
            <Route path="settings/people" element={<People />} />
            <Route path="display-media" element={<Navigate to="/admin/settings/display" replace />} />
            <Route path="catalog" element={<Navigate to="/admin/settings/catalog" replace />} />
            <Route path="rewards" element={<Navigate to="/admin/settings/rewards" replace />} />
            <Route path="commission" element={<Navigate to="/admin/settings/commission" replace />} />
            <Route path="people" element={<Navigate to="/admin/settings/people" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
      </DialogProvider>
    </AuthProvider>
  )
}
