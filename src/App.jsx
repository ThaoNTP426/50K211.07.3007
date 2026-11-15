import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Materials from './pages/Materials.jsx'
import StockCheck from './pages/StockCheck.jsx'
import StockAdjust from './pages/StockAdjust.jsx'
import StockHistory from './pages/StockHistory.jsx'
import Trash from './pages/Trash.jsx'
import Recipes from './pages/Recipes.jsx'
import Suppliers from './pages/Suppliers.jsx'
import Receipts from './pages/Receipts.jsx'
import LossSlips from './pages/LossSlips.jsx'
import LossSlipDetail from './pages/LossSlipDetail.jsx'
import Report from './pages/Report.jsx'
import Pos from './pages/Pos.jsx'
import { apiFetch, API_URL } from './service/apiClient.js'

export default function App() {
  const [auth, setAuth] = useState(() => !!sessionStorage.getItem('auth-token'))
  const login = ({ token }) => { sessionStorage.setItem('auth-token', token); setAuth(true) }
  const logout = () => {
    apiFetch(`${API_URL}/auth/logout`, { method: 'POST' }).catch(() => {})
    sessionStorage.removeItem('auth-token')
    setAuth(false)
  }

  useEffect(() => {
    const expireSession = () => setAuth(false)
    window.addEventListener('auth-expired', expireSession)
    return () => window.removeEventListener('auth-expired', expireSession)
  }, [])

  useEffect(() => {
    if (!auth) return undefined
    let timer
    const expire = () => logout()
    const reset = () => { clearTimeout(timer); timer = setTimeout(expire, 30 * 60 * 1000) }
    const events = ['pointerdown', 'keydown', 'mousemove', 'touchstart']
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }))
    reset()
    return () => { clearTimeout(timer); events.forEach((event) => window.removeEventListener(event, reset)) }
  }, [auth])

  if (!auth) return <Login onLogin={login} />
  return (
    <Routes>
      <Route path="/pos" element={<Pos onLogout={logout} />} />
      <Route element={<Layout onLogout={logout} />}>
        <Route path="/" element={<Navigate to="/nguyen-vat-lieu" replace />} />
        <Route path="/nguyen-vat-lieu" element={<Materials />} />
        <Route path="/ton-kho/kiem-tra" element={<StockCheck />} />
        <Route path="/ton-kho/dieu-chinh" element={<StockAdjust />} />
        <Route path="/ton-kho/lich-su" element={<StockHistory />} />
        <Route path="/ton-kho/thung-rac" element={<Trash />} />
        <Route path="/cong-thuc-mon" element={<Recipes />} />
        <Route path="/nha-cung-cap" element={<Suppliers />} />
        <Route path="/phieu-nhap-kho" element={<Receipts />} />
        <Route path="/hao-hut/:id" element={<LossSlipDetail />} />
        <Route path="/hao-hut" element={<LossSlips />} />
        <Route path="/bao-cao" element={<Report />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
