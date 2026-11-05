import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LegacyBanner, LegacyRescueProvider } from './components/LegacyRescue'
import { SyncIssues } from './components/SyncIssues'
import { useApp } from './lib/AppContext'
import History from './pages/History'
import Home from './pages/Home'
import Import from './pages/Import'
import ItemForm from './pages/ItemForm'
import Login from './pages/Login'
import Members from './pages/Members'
import Orgs from './pages/Orgs'
import Scan from './pages/Scan'
import Settings from './pages/Settings'

export default function App() {
  const { session, authLoading, orgs, org } = useApp()
  if (authLoading) return <p className="p-6 text-slate-400">Loading…</p>
  if (!session) return <Login />
  return (
    <BrowserRouter>
      <LegacyRescueProvider>
        <SyncIssues />
        <LegacyBanner />
        <Routes>
          {!org && orgs.length === 0 ? (
            <>
              <Route path="/orgs" element={<Orgs firstRun />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/orgs" replace />} />
            </>
          ) : (
            <>
              <Route path="/" element={<Home />} />
              <Route path="/scan" element={<Scan />} />
              <Route path="/item/:id/history" element={<History />} />
            <Route path="/item/:id" element={<ItemForm />} />
              <Route path="/new/:barcode?" element={<ItemForm />} />
              <Route path="/import" element={<Import />} />
              <Route path="/orgs" element={<Orgs />} />
              <Route path="/members" element={<Members />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </LegacyRescueProvider>
    </BrowserRouter>
  )
}
