import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Box, FlaskConical, BookOpen, Truck, FileText, TrendingDown, ChartNoAxesColumn, Bell, LogOut, ChevronDown, Mail, LockKeyhole, CircleAlert, Check } from 'lucide-react'
import { ConfirmModal, Field, fmtDateTime, Modal, Toast } from './ui.jsx'
import { useStore } from '../store.jsx'
import { apiFetch, API_URL } from '../service/apiClient.js'

const link = ({ isActive }) => (isActive ? 'active' : '')

export default function Layout({ onLogout }) {
  const { pathname } = useLocation()
  const { notifications = [], markNotificationRead, markAllNotificationsRead } = useStore()
  const [open, setOpen] = useState(pathname.startsWith('/ton-kho'))
  const [confirm, setConfirm] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [email, setEmail] = useState('')
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [profileError, setProfileError] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [toastMessage, setToastMessage] = useState(null)
  const [errorAlert, setErrorAlert] = useState('')
  useEffect(() => {
    const showToast = (event) => {
      if (typeof event.detail !== 'string' && event.detail?.type === 'error') {
        setToastMessage(null)
        setErrorAlert(event.detail.message)
      } else setToastMessage(event.detail)
    }
    window.addEventListener('app-toast', showToast)
    return () => window.removeEventListener('app-toast', showToast)
  }, [])
  const clearToast = useCallback(() => setToastMessage(null), [])
  const unread = notifications.filter((n) => !n.read).length
  const openProfile = async () => {
    setPasswordForm({ current: '', next: '', confirm: '' })
    setProfileError('')
    setProfileSaved(false)
    setShowProfile(true)
    try {
      const response = await apiFetch(`${API_URL}/auth/profile`)
      const result = await response.json()
      if (!response.ok || !result?.success) throw new Error('Không thể tải thông tin tài khoản. Vui lòng thử lại.')
      setEmail(result.data.email || '')
    } catch (error) {
      setProfileError(error.message || 'Không thể tải thông tin tài khoản. Vui lòng thử lại.')
    }
  }
  const saveProfile = async () => {
    const cleanEmail = email.trim()
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setProfileError('Địa chỉ email không đúng định dạng.')
    if (cleanEmail.length > 50) return setProfileError('Email không được dài quá 50 ký tự.')
    const changingPassword = passwordForm.current || passwordForm.next || passwordForm.confirm
    if (changingPassword) {
      if (!passwordForm.current || !passwordForm.next || !passwordForm.confirm) return setProfileError('Vui lòng điền đầy đủ các trường mật khẩu.')
      if (passwordForm.next.length < 8) return setProfileError('Mật khẩu mới phải có ít nhất 8 ký tự.')
      if (passwordForm.next !== passwordForm.confirm) return setProfileError('Mật khẩu xác nhận không khớp.')
    }
    try {
      const response = await apiFetch(`${API_URL}/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          ...(changingPassword ? { matKhauHienTai: passwordForm.current, matKhauMoi: passwordForm.next } : {})
        })
      })
      const result = await response.json()
      if (!response.ok || !result?.success) return setProfileError(result?.message || 'Không thể lưu thông tin tài khoản. Vui lòng thử lại.')
      if (changingPassword) {
        setShowProfile(false)
        onLogout()
        return
      }
      setEmail(result.data.email || '')
      setProfileSaved(true)
      setProfileError('')
      setPasswordForm({ current: '', next: '', confirm: '' })
    } catch (error) {
      setProfileError(error.message || 'Không thể kết nối đến máy chủ. Vui lòng thử lại.')
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Đợi Coffee</h1>
          <span>Quản lý kho</span>
        </div>
        <nav className="nav">
          <button className="nav-parent" onClick={() => setOpen(!open)}>
            <Box size={20} /> Quản lý tồn kho <ChevronDown className="chev" size={16} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
          </button>
          {open && (
            <div className="sub">
              <NavLink to="/ton-kho/lich-su" className={link}>Lịch sử thay đổi tồn kho</NavLink>
              <NavLink to="/ton-kho/dieu-chinh" className={link}>Điều chỉnh tồn kho</NavLink>
              <NavLink to="/ton-kho/kiem-tra" className={link}>Kiểm tra tồn kho</NavLink>
            </div>
          )}
          <NavLink to="/nguyen-vat-lieu" className={link}><FlaskConical size={20} /> Quản lý nguyên vật liệu</NavLink>
          <NavLink to="/cong-thuc-mon" className={link}><BookOpen size={20} /> Quản lý công thức món</NavLink>
          <NavLink to="/nha-cung-cap" className={link}><Truck size={20} /> Quản lý nhà cung cấp</NavLink>
          <NavLink to="/phieu-nhap-kho" className={link}><FileText size={20} /> Quản lý phiếu nhập kho</NavLink>
          <NavLink to="/hao-hut" className={link}><TrendingDown size={20} /> Quản lý hao hụt</NavLink>
          <NavLink to="/bao-cao" className={link}><ChartNoAxesColumn size={20} /> Báo cáo Nhập - Xuất - Tồn &amp; CP</NavLink>
        </nav>
        <div className="userbox">
          <button className="owner-profile-trigger" type="button" onClick={openProfile} aria-label="Mở hồ sơ chủ quán">
            <span className="avatar">T</span>
            <span className="who"><b>Trần Bảo Khuê</b><span>Chủ quán</span></span>
          </button>
          <button className="icon-btn-dark" title="Thông báo" aria-label={`Thông báo, ${unread} chưa đọc`} aria-expanded={showAlerts} onClick={() => setShowAlerts(!showAlerts)}>
            <Bell size={16} />{unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <button className="icon-btn-dark" title="Đăng xuất" onClick={() => setConfirm(true)}><LogOut size={16} /></button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
      {showAlerts && <section className="alert-panel" aria-label="Danh sách thông báo">
        <div className="alert-head"><b>Thông báo</b><button className="link-button" disabled={!unread} onClick={markAllNotificationsRead}>Đánh dấu tất cả đã đọc</button></div>
        {notifications.length ? <div className="alert-list">{notifications.map((n) => <button key={n.id} className={`alert-row ${n.read ? '' : 'unread'}`} onClick={() => markNotificationRead(n.id)}>
          <span className={`alert-dot ${n.type || 'info'}`} />
          <span className="alert-copy"><b>{n.title}</b><span>{n.message}</span><small>{fmtDateTime(n.time)}</small></span>
          {!n.read && <span className="unread-mark" aria-label="Chưa đọc" />}
        </button>)}</div> : <p className="muted alert-empty">Bạn chưa có thông báo.</p>}
      </section>}
      {toastMessage && <Toast message={toastMessage} onDone={clearToast} />}
      {errorAlert && <Modal size="error-alert-modal" header={<div className="error-alert-icon"><CircleAlert size={22} /></div>} onClose={() => setErrorAlert('')} footer={<button className="btn primary" onClick={() => setErrorAlert('')}>Đóng</button>}>
        <p className="error-alert-message">{errorAlert}</p>
      </Modal>}
      {showProfile && <Modal title="Thông tin chủ quán" size="profile-modal" onClose={() => setShowProfile(false)} footer={<><button className="btn" onClick={() => setShowProfile(false)}>Đóng</button><button className="btn primary" onClick={saveProfile}>Lưu thay đổi</button></>}>
        <div className="owner-profile-summary">
          <div className="owner-profile-avatar">T</div>
          <div><b>Trần Bảo Khuê</b><span>Chủ quán · Tài khoản chuquan</span></div>
        </div>
        {profileError && <div className="banner error">{profileError}</div>}
        {profileSaved && <div className="banner success"><span className="banner-success-icon"><Check size={15} strokeWidth={3} /></span>Đã cập nhật thông tin chủ quán.</div>}
        <Field label="Email"><div className="profile-input-wrap"><Mail size={16} /><input className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setProfileSaved(false) }} placeholder="Nhập email của chủ quán" /></div></Field>
        <div className="profile-section-title"><LockKeyhole size={16} /> Thay đổi mật khẩu</div>
        <div className="profile-password-grid">
          <Field label="Mật khẩu hiện tại"><input className="input" type="password" autoComplete="current-password" value={passwordForm.current} onChange={(e) => setPasswordForm((p) => ({ ...p, current: e.target.value }))} /></Field>
          <span />
          <Field label="Mật khẩu mới"><input className="input" type="password" autoComplete="new-password" value={passwordForm.next} onChange={(e) => setPasswordForm((p) => ({ ...p, next: e.target.value }))} /></Field>
          <Field label="Xác nhận mật khẩu mới"><input className="input" type="password" autoComplete="new-password" value={passwordForm.confirm} onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))} /></Field>
        </div>
      </Modal>}
      {confirm && (
        <ConfirmModal title="Đăng xuất" message="Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?" confirmText="Đăng xuất" onClose={() => setConfirm(false)} onConfirm={onLogout} />
      )}
    </div>
  )
}
