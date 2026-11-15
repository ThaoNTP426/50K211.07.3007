import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Circle, LoaderCircle, LockKeyhole } from 'lucide-react'
import { useStore } from '../store.jsx'
import { createInventoryAdjustment } from '../service/inventoryAdjustmentApi.js'
import { compareCodes } from '../utils/codeSort.js'
import { DataTable, SearchBox, Select, Modal, Field, fmtNum, fmtDateTime, alertMessage, useToast } from '../components/ui.jsx'

const REASONS = ['Kiểm định định kỳ', 'Hao hụt/hư hỏng/hết hạn', 'Nhập hoặc xuất sai', 'Khác']
const parseQuantity = (value) => Number(String(value).trim().replace(',', '.'))

export default function StockAdjust() {
  const s = useStore()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [sel, setSel] = useState(null)
  const [actual, setActual] = useState('')
  const [reason, setReason] = useState('')
  const [reasonOpen, setReasonOpen] = useState(false)
  const [confirmAdjust, setConfirmAdjust] = useState(false)
  const [processingStage, setProcessingStage] = useState(0)
  const [highlight, setHighlight] = useState(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [toast, notify] = useToast()
  const adjustmentInFlight = useRef(false)

  const lastTx = (id) => s.inventoryHistory.find((t) => t.materialId === id)?.time
  const rows = useMemo(() => s.materials.filter((m) =>
    (!q || (m.id + m.name).toLowerCase().includes(q.toLowerCase())) && (!group || m.group === group)
  ).slice().sort((a, b) => compareCodes(a.id, b.id)), [s.materials, q, group])

  const open = (m) => { setSel(m); setActual(''); setReason(''); setReasonOpen(false); setNote(''); setErrors({}) }
  const save = () => {
    const nextErrors = {}
    const normalized = actual.trim().replace(',', '.')
    const decimalDigits = normalized.split('.')[1] || ''
    const n = parseQuantity(actual)
    if (actual.trim() === '') nextErrors.actual = 'Vui lòng nhập số lượng thực tế.'
    else if (!Number.isFinite(n) || n < 0) nextErrors.actual = 'Số lượng thực tế phải là số không âm.'
    else if (decimalDigits.length > 3) nextErrors.actual = `Tối đa 3 chữ số thập phân với đơn vị ${sel.unit}`
    else if (n === sel.stock) nextErrors.actual = 'Số lượng không thay đổi, không cần điều chỉnh.'
    if (!reason) nextErrors.reason = 'Vui lòng chọn lý do điều chỉnh.'
    if (reason === 'Khác' && !note.trim()) nextErrors.note = 'Bắt buộc nhập ghi chú khi chọn lý do “Khác”'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      notify({ type: 'error', message: 'Dữ liệu không hợp lệ!' })
      return
    }
    setConfirmAdjust(true)
  }
  const commitAdjustment = async () => {
    if (adjustmentInFlight.current) return
    adjustmentInFlight.current = true
    setConfirmAdjust(false)
    setProcessingStage(1)
    try {
      await createInventoryAdjustment({ maNVL: sel.id, tonMoi: parseQuantity(actual), lyDo: reason, ghiChu: note })
      setProcessingStage(2)
      await Promise.all([s.refreshMaterials(), s.refreshInventoryHistory()])
      setHighlight({ id: sel.id, type: 'success' })
      setProcessingStage(3)
      setTimeout(() => { setProcessingStage(0); setSel(null); notify('Đã lưu điều chỉnh tồn kho.') }, 450)
    } catch (error) {
      setProcessingStage(0)
      notify({ type: 'error', message: error.message || 'Không thể điều chỉnh tồn kho. Vui lòng thử lại.' })
    } finally {
      adjustmentInFlight.current = false
    }
  }
  const cols = [
    { label: 'Mã NVL', render: (m) => <span className="code">{m.id}</span> },
    { label: 'Tên nguyên vật liệu', render: (m) => <span className="name">{m.name}</span> },
    { label: 'Đơn vị tính', key: 'unit' },
    { label: 'Tồn kho hiện tại', render: (m) => fmtNum(m.stock) },
    { label: 'Cập nhật lần cuối', render: (m) => (lastTx(m.id) ? fmtDateTime(lastTx(m.id)) : '—') },
    { label: 'Thao tác', render: (m) => <button className="btn sm stock-adjust-btn" onClick={() => open(m)}>Điều chỉnh tồn kho</button> },
  ]
  return (
    <>
      <div className="page-head"><h2>Điều chỉnh tồn kho</h2></div>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm theo mã hoặc tên nguyên vật liệu" showClearAlways />
          <Select value={group} onChange={setGroup} options={s.materialGroups} placeholder="Tất cả nhóm" />
        </div>
        {s.materialsLoading && <div className="banner">Đang tải danh mục nguyên vật liệu từ SQL Server...</div>}
        {s.materialsError && <div className="banner error">Không thể tải danh mục nguyên vật liệu: {s.materialsError}</div>}
        <DataTable columns={cols} rows={rows} rowClassName={(m) => m.id === highlight?.id ? `row-${highlight.type}` : undefined} />
      </div>
      {sel && (
        <Modal title="Điều chỉnh tồn kho" onClose={() => setSel(null)}
          footer={<><button className="btn" onClick={() => setSel(null)}>Hủy bỏ</button><button className="btn primary" onClick={save}>Lưu</button></>}>
          <div className="grid2">
            <Field label="Tên nguyên vật liệu"><div className="readonly-with-lock"><input className="input" readOnly value={sel.name} /><LockKeyhole size={12} /></div></Field>
            <Field label="Đơn vị tính"><div className="readonly-with-lock"><input className="input" readOnly value={sel.unit} /><LockKeyhole size={12} /></div></Field>
            <Field label="Tồn kho hiện tại"><div className="readonly-with-lock"><input className="input" readOnly value={`${fmtNum(sel.stock)} ${sel.unit}`} /><LockKeyhole size={12} /></div></Field>
            <Field label="Số lượng thực tế" required><input className={`input actual-quantity-input ${errors.actual ? 'err' : ''}`} type="text" inputMode="decimal" value={actual} onChange={(e) => { setActual(e.target.value); setErrors((current) => ({ ...current, actual: '' })) }} placeholder="Nhập số lượng thực tế" />{errors.actual && <div className="field-validation"><CircleAlert size={13} />{alertMessage(errors.actual)}</div>}</Field>
            <Field label="Lý do điều chỉnh" required full>
              <div className={`reason-select-wrap ${reasonOpen ? 'is-open' : ''}`}>
                <button type="button" className={`input reason-select-trigger ${reason ? '' : 'placeholder'} ${errors.reason ? 'err' : ''}`} aria-haspopup="listbox" aria-expanded={reasonOpen} onClick={() => setReasonOpen((value) => !value)}>
                  <span>{reason || 'Chọn lý do'}</span><ChevronDown size={15} aria-hidden="true" />
                </button>
                {reasonOpen && <div className="reason-options" role="listbox" aria-label="Lý do điều chỉnh">
                  {REASONS.map((option) => <button type="button" role="option" aria-selected={reason === option} className="reason-option" key={option} onClick={() => { setReason(option); setReasonOpen(false); setErrors((current) => ({ ...current, reason: '' })) }}>{option}</button>)}
                </div>}
              </div>
              {errors.reason && <div className="field-validation"><CircleAlert size={13} />{alertMessage(errors.reason)}</div>}
            </Field>
            <Field label="Ghi chú" full><textarea className={`textarea ${errors.note ? 'err' : ''}`} value={note} onChange={(e) => { setNote(e.target.value); setErrors((current) => ({ ...current, note: '' })) }} placeholder="Nhập ghi chú" />{errors.note && <div className="field-validation"><CircleAlert size={13} />{alertMessage(errors.note)}</div>}</Field>
          </div>
        </Modal>
      )}
      {sel && confirmAdjust && <Modal size="adjust-confirm" title="Xác nhận điều chỉnh tồn kho" onClose={() => setConfirmAdjust(false)}
        footer={<><button className="btn" onClick={() => setConfirmAdjust(false)}>Hủy bỏ</button><button className="btn primary" onClick={commitAdjustment}>Xác nhận</button></>}>
        <p className="adjust-confirm-message">Tồn kho sẽ thay đổi từ {fmtNum(sel.stock)} {sel.unit} thành {fmtNum(parseQuantity(actual))} {sel.unit}</p>
      </Modal>}
      {sel && processingStage > 0 && <Modal size="adjust-progress" onClose={() => {}} header={<div className="adjust-progress-title">Đang điều chỉnh tồn kho {sel.name}</div>} footer={<><button className="btn" disabled>Hủy</button><button className="btn primary" disabled>Đang xử lý...</button></>}>
        <div className="adjust-progress-steps">
          <div className={`adjust-progress-step ${processingStage >= 1 ? 'complete' : ''}`}>
            <span className="step-icon">{processingStage >= 1 ? <Check size={13} /> : <Circle size={14} />}</span>
            <span><b>Kiểm tra tồn kho hiện tại</b><small>Đã kiểm tra số lượng và lý do điều chỉnh</small></span>
          </div>
          <div className={`adjust-progress-step ${processingStage === 1 ? 'active' : processingStage >= 2 ? 'complete' : ''}`}>
            <span className="step-icon">{processingStage === 1 ? <LoaderCircle className="spin" size={14} /> : processingStage >= 2 ? <Check size={13} /> : <Circle size={14} />}</span>
            <span><b>Cập nhật số lượng tồn kho</b><small>{sel.name}: {fmtNum(sel.stock)} → {fmtNum(parseQuantity(actual))} {sel.unit}</small></span>
          </div>
          <div className={`adjust-progress-step ${processingStage === 2 ? 'active' : processingStage >= 3 ? 'complete' : ''}`}>
            <span className="step-icon">{processingStage === 2 ? <LoaderCircle className="spin" size={14} /> : processingStage >= 3 ? <Check size={13} /> : <Circle size={14} />}</span>
            <span><b>Ghi lịch sử điều chỉnh</b><small>Bản ghi chênh lệch {fmtNum(parseQuantity(actual) - sel.stock)} {sel.unit} vào lịch sử tồn kho</small></span>
          </div>
        </div>
      </Modal>}
      {toast}
    </>
  )
}
