import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X, Eye, Pencil, Trash2, ChevronLeft, ChevronRight, CheckCircle2, CircleAlert, ChevronDown, Check } from 'lucide-react'

export const fmtNum = (n) => (n == null ? '' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 }))
export const alertMessage = (message) => `${String(message).trim().replace(/[.!?]+$/, '')}!`
export const fmtMoney = (n) => Number(n).toLocaleString('vi-VN')
export const fmtDate = (iso) => {
  if (!iso) return 'Không áp dụng'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export const fmtDateTime = (iso) => `${fmtDate(iso)} ${iso.slice(11, 16)}`
export const todayISO = () => { const d = new Date(); const offset = d.getTimezoneOffset() * 60000; return new Date(d.getTime() - offset).toISOString().slice(0, 10) }
export const isExpired = (iso) => !!iso && iso <= todayISO()

export function SearchBox({ value, onChange, placeholder, showClearAlways = false, className = '' }) {
  return (
    <div className={`search ${className}`}>
      <Search size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {(value || showClearAlways) && (
        <button type="button" className="search-clear" aria-label="Xóa nội dung tìm kiếm" title="Xóa nội dung tìm kiếm" disabled={!value} onClick={() => onChange('')}>
          <X size={12} />
        </button>
      )}
    </div>
  )
}

export function Select({ value, onChange, options, placeholder, className = '', disabled, hidePlaceholderOption = false }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])
  const items = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option)
  const selected = items.find((item) => item.value === value)
  return (
    <div ref={root} className={`select-control ${className} ${open ? 'is-open' : ''}`}>
      <button type="button" className={`select select-trigger ${className} ${selected ? '' : 'is-placeholder'}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span>{selected?.label || placeholder}</span><ChevronDown size={14} />
      </button>
      {open && <div className="select-options" role="listbox">
        {placeholder && !hidePlaceholderOption && <button type="button" className="select-option" role="option" aria-selected={!value} onClick={() => { onChange(''); setOpen(false) }}>{placeholder}</button>}
{items.map((item) => (
  <button
    key={item.value}
    type="button"
    className="select-option recipe-material-option"
    role="option"
    aria-selected={value === item.value}
    disabled={item.disabled}
    onClick={() => {
      onChange(item.value)
      setOpen(false)
    }}
  >
    {item.optionLabel || item.label}
  </button>
))}      </div>}
    </div>
  )
}

export function RowActions({ onView, onEdit, onDelete, editDisabled, deleteDisabled, viewTooltip = 'Xem chi tiết' }) {
  return (
    <div className="actions">
      {onView && <button className="act view custom-tooltip" data-tooltip={viewTooltip} aria-label={viewTooltip} onClick={onView}><Eye size={16} /></button>}
      {onEdit && <button className="act edit custom-tooltip" data-tooltip="Chỉnh sửa" aria-label="Chỉnh sửa" onClick={onEdit} disabled={editDisabled}><Pencil size={16} /></button>}
      {onDelete && <button className="act del custom-tooltip" data-tooltip="Xóa" aria-label="Xóa" onClick={onDelete} disabled={deleteDisabled}><Trash2 size={16} /></button>}
    </div>
  )
}

// Bảng + phân trang (10 dòng/trang)
export function DataTable({ columns, rows, pageSize = 10, emptyText = 'Không có dữ liệu', emptyContent, hideEmptyPager = false, footer, rowClassName }) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => { if (page > pages) setPage(pages) }, [pages, page])
  const slice = rows.slice((page - 1) * pageSize, page * pageSize)
  return (
    <>
      <table className="tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {slice.length === 0 && <tr><td className={`empty ${emptyContent ? 'empty-custom' : ''}`} colSpan={columns.length}>{emptyContent || emptyText}</td></tr>}
          {slice.map((r, i) => (
            <tr key={r.id ?? i} className={rowClassName ? rowClassName(r) : undefined}>
              {columns.map((c) => (
                <td key={c.label} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
      {!(hideEmptyPager && rows.length === 0) && (
        <div className="pager">
          <span className="info"></span>
          <button className="btn sm square" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>
          <b>{page}/{pages}</b>
          <button className="btn sm square" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button>
        </div>
      )}
    </>
  )
}

export function Modal({ title, subtitle, header, onClose, children, footer, size = '', className = '' }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size} ${className}`.trim()}>
        <div className={`modal-head ${header ? 'custom-modal-head' : ''}`}>
          {header || <div>
            <h3>{title}</h3>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, required, hint, error, full, children, plainError = false, className = '' }) {
  return (
    <div className={`field ${full ? 'full' : ''} ${className}`.trim()}>
      {label && <label>{label} {required && <span className="req">*</span>}</label>}
      {children}
      {error ? <div className="error field-error"><CircleAlert size={13} aria-hidden="true" /><span>{plainError && /không được để trống[.!?]*$/i.test(String(error)) ? String(error).replace(/[.!?]+$/, '') : alertMessage(error)}</span></div> : hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function ConfirmModal({ title, message, confirmText = 'Xác nhận', cancelText = 'Hủy bỏ', danger, onConfirm, onClose, error, children, className = '', header }) {
  return (
    <Modal
      title={title}
      size="sm"
      className={className}
      header={header}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{cancelText}</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmText}</button>
        </>
      }
    >
      {error && <div className="banner error">{error}</div>}
      {children || <p style={{ margin: 0 }}>{message}</p>}
    </Modal>
  )
}

export function Toast({ message, onDone }) {
  const item = typeof message === 'string' ? { type: 'success', text: message } : { type: message.type || 'success', text: message.message }
  const Icon = item.type === 'error' ? CircleAlert : CheckCircle2
  useEffect(() => {
    const t = setTimeout(onDone, 4000)
    return () => clearTimeout(t)
  }, [onDone])
  return <div className={`toast ${item.type}`} role={item.type === 'error' ? 'alert' : 'status'}>{item.type === 'success' ? <span className="toast-icon"><Check size={16} strokeWidth={3} aria-hidden="true" /></span> : <Icon size={19} aria-hidden="true" />}<span>{item.text}</span></div>
}

export function useToast() {
  const notify = useCallback((message) => {
    window.dispatchEvent(new CustomEvent('app-toast', { detail: message }))
  }, [])
  return [null, notify]
}
