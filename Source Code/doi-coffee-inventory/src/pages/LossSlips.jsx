import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CircleCheck, Plus, X } from 'lucide-react'
import { useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'
import { DataTable, RowActions, SearchBox, Select, Modal, Field, ConfirmModal, fmtNum, fmtDate, todayISO, useToast } from '../components/ui.jsx'
import { LOSS_REASONS } from '../data.js'

function SlipForm({ initial, onSave, onClose }) {
  const s = useStore()
  const materials = s.materials
  const materialsLoading = s.materialsLoading
  const materialsError = s.materialsError
  const [date, setDate] = useState(initial?.date ?? todayISO())
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [items, setItems] = useState(initial?.items.map((i) => ({ ...i })) ?? [{ materialId: '', qty: '' }])
  const [err, setErr] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const mat = (id) => materials.find((m) => m.id === id)
  // tồn kho khả dụng: khi sửa, cộng lại số lượng của phiếu cũ
  const avail = (id) => (mat(id)?.stock ?? 0) + (initial?.items.filter((i) => i.materialId === id).reduce((a, i) => a + i.qty, 0) ?? 0)
  const setItem = (i, k, v) => {
    setItems((current) => current.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)))
    setFieldErrors((current) => ({ ...current, [`item-${i}-${k === 'materialId' ? 'material' : k}`]: '' }))
  }

  const submit = async () => {
    if (saving) return
    if (materialsLoading) return setErr('Đang tải danh sách nguyên vật liệu. Vui lòng chờ!')
    if (materialsError || materials.length === 0) return setErr(materialsError || 'Không có nguyên vật liệu đang hoạt động để chọn.')
    const errors = {}
    if (!date) errors.date = 'Vui lòng chọn ngày hao hụt.'
    else if (date > todayISO()) errors.date = 'Ngày hao hụt không được ở tương lai.'
    if (!reason) errors.reason = 'Vui lòng chọn lý do hao hụt.'
    if (reason === 'Khác' && !note.trim()) errors.note = 'Vui lòng nhập ghi chú khi chọn lý do “Khác”.'
    if (!items.length) errors.items = 'Phiếu hao hụt phải có ít nhất 1 nguyên vật liệu.'
    const selectedIds = items.map((item) => item.materialId).filter(Boolean)
    items.forEach((item, index) => {
      if (!item.materialId) errors[`item-${index}-material`] = 'Vui lòng chọn nguyên vật liệu.'
      else if (selectedIds.filter((id) => id === item.materialId).length > 1) errors[`item-${index}-material`] = 'Nguyên vật liệu đã có trong phiếu.'
      if (item.qty === '' || !Number.isFinite(Number(item.qty))) errors[`item-${index}-qty`] = 'Số lượng phải là số.'
      else if (Number(item.qty) <= 0) errors[`item-${index}-qty`] = 'Số lượng phải lớn hơn 0.'
      else if (item.materialId && Number(item.qty) > avail(item.materialId)) errors[`item-${index}-qty`] = `Tồn kho chỉ còn ${fmtNum(avail(item.materialId))} ${mat(item.materialId)?.unit || ''}.`
    })
    setFieldErrors(errors)
    if (Object.keys(errors).length) { setErr(''); return }
    setErr('')
    setSaving(true)
    try {
      const result = await onSave({ date, reason, note, items: items.map((i) => ({ materialId: i.materialId, qty: Number(i.qty), unit: mat(i.materialId).unit })) })
      if (!result?.success) setErr(result?.message || 'Không thể tạo phiếu hao hụt!')
    } catch (error) {
      setErr(error.message || 'Không thể tạo phiếu hao hụt!')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title={initial ? 'Sửa phiếu hao hụt' : 'Tạo phiếu hao hụt'} size="lg" className="loss-form-modal" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn primary" onClick={submit} disabled={saving || materialsLoading || !!materialsError || materials.length === 0}>{saving ? 'Đang lưu...' : 'Lưu'}</button></>}>
      {err && <div className="banner error loss-form-alert">{err}</div>}
      {materialsError && <div className="banner error">Không thể tải danh sách nguyên vật liệu từ máy chủ: {materialsError}</div>}
      <div className="grid2 loss-form-grid">
        <Field label="Mã phiếu"><input className="input" readOnly value={initial?.id ?? 'Tự động sinh'} /></Field>
        <Field label="Ngày lập"><input className="input" readOnly value={fmtDate(initial?.created ?? todayISO())} /></Field>
        <Field label="Ngày hao hụt" required error={fieldErrors.date}><input className={`input ${fieldErrors.date ? 'err' : ''}`} type="date" max={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setFieldErrors((current) => ({ ...current, date: '' })) }} /></Field>
        <Field label="Lý do hao hụt" required error={fieldErrors.reason}><Select className={fieldErrors.reason ? 'err' : ''} value={reason} onChange={(value) => { setReason(value); setFieldErrors((current) => ({ ...current, reason: '' })) }} options={LOSS_REASONS} placeholder="Chọn lý do" /></Field>
      </div>
      <div className="loss-items-section">
        <div className="line loss-items-head" style={{ marginBottom: 4 }}><label>Nguyên vật liệu <span className="red">*</span></label><label>Số lượng <span className="red">*</span></label><span /></div>
        {fieldErrors.items && <div className="loss-inline-error">{fieldErrors.items}</div>}
        {items.map((it, i) => (
          <div className="line loss-item-row" key={i}>
            <Field error={fieldErrors[`item-${i}-material`]} hint={it.materialId && mat(it.materialId) ? `Tồn kho hiện tại: ${fmtNum(avail(it.materialId))} ${mat(it.materialId).unit}` : ''}>
              <select className={`select ${fieldErrors[`item-${i}-material`] ? 'err' : ''}`} value={it.materialId} disabled={materialsLoading || !!materialsError || materials.length === 0} onChange={(e) => setItem(i, 'materialId', e.target.value)}>
                <option value="">{materialsLoading ? 'Đang tải nguyên vật liệu...' : materialsError ? 'Không tải được nguyên vật liệu' : materials.length === 0 ? 'Danh mục nguyên vật liệu trống' : 'Chọn nguyên vật liệu'}</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
              </select>
            </Field>
            <Field error={fieldErrors[`item-${i}-qty`]}><input className={`input ${fieldErrors[`item-${i}-qty`] ? 'err' : ''}`} type="number" min="0" step="any" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} /></Field>
            {items.length > 1 ? <button className="x-btn" onClick={() => setItems(items.filter((_, x) => x !== i))}><X size={16} /></button> : <span />}
          </div>
        ))}
        <button className="btn sm" onClick={() => setItems([...items, { materialId: '', qty: '' }])} disabled={materialsLoading || !!materialsError || materials.length === 0}><Plus size={14} /> Thêm dòng</button>
      </div>
      <Field label={`Ghi chú (Nếu lý do "Khác")${reason === 'Khác' ? ' *' : ''}`} full error={fieldErrors.note}>
        <input className={`input ${fieldErrors.note ? 'err' : ''}`} value={note} onChange={(e) => { setNote(e.target.value); setFieldErrors((current) => ({ ...current, note: '' })) }} placeholder="Nhập ghi chú nếu có..." style={{ marginTop: 0 }} />
      </Field>
    </Modal>
  )
}

function LossEditSummary({ slip, value }) {
  const s = useStore()
  const oldItems = new Map()
  const newItems = new Map()
  slip.items.forEach((item) => oldItems.set(item.materialId, (oldItems.get(item.materialId) || 0) + Number(item.qty)))
  value.items.forEach((item) => newItems.set(item.materialId, (newItems.get(item.materialId) || 0) + Number(item.qty)))
  const changes = []
  if (slip.date !== value.date) changes.push(['Ngày hao hụt', fmtDate(slip.date), fmtDate(value.date)])
  if (slip.reason !== value.reason) changes.push(['Lý do hao hụt', slip.reason, value.reason])
  for (const id of new Set([...oldItems.keys(), ...newItems.keys()])) {
    const material = s.materials.find((item) => item.id === id)
    const name = material?.name || id
    const unit = material?.unit || ''
    const oldQty = oldItems.get(id) || 0
    const newQty = newItems.get(id) || 0
    if (oldQty !== newQty) changes.push([`Số lượng hao hụt · ${name}`, oldQty ? `${fmtNum(oldQty)} ${unit}` : '—', newQty ? `${fmtNum(newQty)} ${unit}` : '—'])
    const stockBefore = Number(material?.stock || 0)
    const stockAfter = stockBefore + oldQty - newQty
    if (oldQty !== newQty) changes.push([`Tồn kho ${name}`, `${fmtNum(stockBefore)} ${unit}`, `${fmtNum(stockAfter)} ${unit}`])
  }
  if ((slip.note || '') !== (value.note || '')) changes.push(['Ghi chú', slip.note || '—', value.note || '—'])
  return <table className="loss-change-table">
    <thead><tr><th>Nội dung</th><th>Giá trị cũ</th><th>Giá trị mới</th></tr></thead>
    <tbody>{changes.map(([label, before, after]) => <tr key={label}><td>{label}</td><td>{before}</td><td className="loss-change-new">{after}</td></tr>)}</tbody>
  </table>
}

export default function LossSlips() {
  const s = useStore()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState('')
  const [modal, setModal] = useState(null)
  const [toast, notify] = useToast()
  const mat = (id) => s.materials.find((m) => m.id === id)

  // mỗi dòng NVL của phiếu hiển thị thành 1 hàng, giống thiết kế
  const rows = useMemo(() => s.slips.flatMap((sl) => sl.items.map((it, i) => ({ ...sl, item: it, key: sl.id + i, first: i === 0 })))
    .filter((r) => (!q || (r.id + (mat(r.item.materialId)?.name || '')).toLowerCase().includes(q.toLowerCase())) && (!reason || r.reason === reason) && (!status || r.status === status))
    .map((r) => ({ ...r, id: r.key, slipId: r.id }))
    .sort((a, b) => compareCodes(a.slipId, b.slipId)), [s.slips, s.materials, q, reason, status])

  const slip = (id) => s.slips.find((x) => x.id === id)
  const cols = [
    { label: 'Mã phiếu', render: (r) => <span className="code">{r.slipId}</span> },
    { label: 'Ngày lập', render: (r) => fmtDate(r.created) },
    { label: 'Ngày hao hụt', render: (r) => fmtDate(r.date) },
    { label: 'Tên NVL', render: (r) => r.item.materialName || 'Không xác định' },
    { label: 'Số lượng', render: (r) => fmtNum(r.item.qty) },
    { label: 'ĐVT', render: (r) => r.item.unit },
    { label: 'Lý do', key: 'reason' },
    { label: 'Trạng thái', render: (r) => <span className={`pill ${r.status === 'Đã hủy' ? 'red' : 'green'}`}>{r.status}</span> },
    { label: 'Thao tác', render: (r) => <RowActions onView={() => navigate(`/hao-hut/${encodeURIComponent(r.slipId)}`)} editDisabled={r.status === 'Đã hủy'} onEdit={() => setModal({ k: 'edit', sl: slip(r.slipId) })} deleteDisabled={r.status === 'Đã hủy'} onDelete={() => setModal({ k: 'cancel', sl: slip(r.slipId) })} /> },
  ]
  const close = () => setModal(null)
  return (
    <>
      <div className="page-head">
        <h2>Quản lý hao hụt</h2>
        <button className="btn" onClick={() => setModal({ k: 'add' })}><Plus size={18} /> Tạo phiếu hao hụt</button>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm theo mã phiếu hoặc tên nguyên vật liệu" />
          <Select value={reason} onChange={setReason} options={LOSS_REASONS} placeholder="Tất cả lý do" />
          <Select value={status} onChange={setStatus} options={['Hoàn thành', 'Đã hủy']} placeholder="Tất cả trạng thái" />
        </div>
        {s.lossesError && <div className="banner error">Không thể tải phiếu hao hụt từ máy chủ: {s.lossesError}</div>}
        <DataTable
          columns={cols}
          rows={rows}
          emptyText={s.lossesLoading ? 'Đang tải phiếu hao hụt...' : s.lossesError ? 'Không có dữ liệu từ máy chủ' : 'Không tìm thấy phiếu hao hụt'}
        />
      </div>
      {modal?.k === 'add' && <SlipForm onClose={close} onSave={async (v) => {
        const result = await s.createSlip(v)
        if (!result.success) return result

        close()
        notify(result.message || 'Tạo phiếu hao hụt thành công')
        return result
      }} />}
      {modal?.k === 'edit' && <SlipForm initial={modal.sl} onClose={close} onSave={(v) => setModal({ k: 'confirm-edit', sl: modal.sl, value: v })} />}
      {modal?.k === 'confirm-edit' && <ConfirmModal className="loss-edit-confirm-modal" title="Xác nhận sửa phiếu hao hụt" cancelText="Hủy" confirmText="Xác nhận" message="Vui lòng kiểm tra các thay đổi trước khi lưu." header={<div className="loss-confirm-head"><CircleCheck size={20} /><div><b>Xác nhận sửa phiếu hao hụt</b><span>Vui lòng kiểm tra các thay đổi trước khi lưu</span></div></div>} onClose={close}
        onConfirm={async () => { const result = await s.updateSlip(modal.sl.id, modal.value); if (!result.success) return notify(result.message); close(); notify(result.message || 'Sửa phiếu hao hụt thành công') }}>
        <LossEditSummary slip={modal.sl} value={modal.value} />
      </ConfirmModal>}
      {modal?.k === 'view' && (
        <Modal title={`Chi tiết phiếu ${modal.sl.id}`} onClose={close} footer={<button className="btn primary" onClick={close}>Đóng</button>}>
          <div className="grid2" style={{ marginBottom: 14 }}>
            {[['Ngày lập', fmtDate(modal.sl.created)], ['Ngày hao hụt', fmtDate(modal.sl.date)], ['Lý do', modal.sl.reason], ['Trạng thái', modal.sl.status], ['Ghi chú', modal.sl.note || '—']]
              .map(([l, v]) => <Field key={l} label={l}><input className="input" readOnly value={v} /></Field>)}
          </div>
          <table className="tbl">
            <thead><tr><th>Nguyên vật liệu</th><th className="num">Số lượng</th></tr></thead>
            <tbody>{modal.sl.items.map((i) => <tr key={i.materialId}><td>{mat(i.materialId)?.name}</td><td className="num">{fmtNum(i.qty)} {i.unit}</td></tr>)}</tbody>
          </table>
        </Modal>
      )}
      {modal?.k === 'cancel' && (
        <ConfirmModal className="loss-cancel-confirm-modal" title="Hủy phiếu hao hụt" danger cancelText="Đóng" confirmText="Xác nhận hủy" message={`Bạn có chắc chắn muốn hủy phiếu hao hụt ${modal.sl.id}? Số lượng nguyên vật liệu trong phiếu sẽ được hoàn lại vào tồn kho.`} header={<div className="loss-cancel-head"><span><AlertTriangle size={15} /></span><b>Hủy phiếu hao hụt</b></div>} onClose={close}
          onConfirm={async () => { const result = await s.cancelSlip(modal.sl.id); if (!result.success) return notify({ type: 'error', message: result.message }); close(); notify(result.message || 'Hủy phiếu hao hụt thành công') }} />
      )}
      {toast}
    </>
  )
}
