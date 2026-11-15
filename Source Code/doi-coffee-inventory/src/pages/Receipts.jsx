
import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'

import { useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'

import {
  ConfirmModal,
  DataTable,
  Field,
  fmtDate,
  fmtMoney,
  fmtNum,
  Modal,
  RowActions,
  todayISO,
  useToast
} from '../components/ui.jsx'

const blankLine = () => ({
  materialId: '',
  qty: '',
  unitPrice: '',
  expiry: ''
})

function ReceiptForm({ initial, onSave, onClose, onBack }) {
  const s = useStore()

  const [f, setF] = useState(() => ({
    date: initial?.date || todayISO(),
    supplier: initial?.supplier || '',
    invoice: initial?.invoice || '',
    note: initial?.note || '',
    items: initial?.items?.map((x) => ({ ...x })) || [blankLine()]
  }))

  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (k, v) => {
    setF((x) => ({ ...x, [k]: v }))
    setError('')
    setFieldErrors((current) => ({ ...current, [k]: '' }))
  }

  const setLine = (idx, k, v) => {
    setF((current) => ({ ...current, items: current.items.map((x, i) => i === idx ? { ...x, [k]: v } : x) }))
    setError('')
    setFieldErrors((current) => ({ ...current, [`item-${idx}-${k}`]: '' }))
  }

  const activeMaterials = s.materials.filter((m) => !m.deleted)

  const total = f.items.reduce(
    (sum, x) =>
      sum + (Number(x.qty) || 0) * (Number(x.unitPrice) || 0),
    0
  )
  const formValid = Boolean(
    f.date && f.date <= todayISO() && f.supplier && f.items.length > 0 &&
    new Set(f.items.map((item) => item.materialId)).size === f.items.length &&
    f.items.every((item) => item.materialId && Number(item.qty) > 0 && Number.isFinite(Number(item.qty)) && Number(item.unitPrice) >= 0 && Number.isFinite(Number(item.unitPrice)) && (!item.expiry || item.expiry >= f.date)) &&
    f.invoice.length <= 100 && f.note.length <= 300
  )

  const save = async () => {
    if (saving) return

    setError('')
    if (s.materialsLoading) return setError('Đang tải danh mục nguyên vật liệu từ SQL Server. Vui lòng chờ!')
    if (s.materialsError || activeMaterials.length === 0) return setError(s.materialsError || 'Danh mục nguyên vật liệu đang trống.')

    // 1. Kiểm tra thông tin chung
    const errors = {}
    if (!f.date) errors.date = 'Vui lòng chọn ngày nhập.'
    if (!f.supplier) errors.supplier = 'Vui lòng chọn nhà cung cấp.'
    if (f.items.length === 0) errors.items = 'Phiếu nhập kho phải có ít nhất 1 nguyên vật liệu!'

    if (f.date > todayISO()) {
      setFieldErrors({ date: 'Ngày nhập không được lớn hơn ngày hiện tại.' })
      return setError('Ngày nhập không được lớn hơn ngày hiện tại.')
    }

    if (f.invoice.length > 100 || f.note.length > 300) {
      return setError(
        'Số hóa đơn tối đa 100 ký tự, ghi chú tối đa 300 ký tự.'
      )
    }

    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      return setError('')
    }

    // 2. Kiểm tra nguyên vật liệu trùng
    const ids = f.items.map((x) => x.materialId)
    f.items.forEach((item, idx) => {
      if (!item.materialId) errors[`item-${idx}-material`] = 'Vui lòng chọn nguyên vật liệu.'
      else if (ids.filter((id) => id === item.materialId).length > 1) errors[`item-${idx}-material`] = 'Nguyên vật liệu đã có trong phiếu.'
      if (item.qty === '' || !Number.isFinite(Number(item.qty))) errors[`item-${idx}-qty`] = 'Số lượng không được để trống.'
      else if (Number(item.qty) <= 0) errors[`item-${idx}-qty`] = 'Số lượng phải lớn hơn 0.'
      if (item.unitPrice === '' || !Number.isFinite(Number(item.unitPrice))) errors[`item-${idx}-unitPrice`] = 'Đơn giá không được để trống.'
      else if (Number(item.unitPrice) < 0) errors[`item-${idx}-unitPrice`] = 'Đơn giá phải từ 0 trở lên.'
      if (item.expiry && item.expiry < f.date) errors[`item-${idx}-expiry`] = 'Hạn sử dụng không được trước ngày nhập.'
    })

    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      return setError('')
    }

    // 3. Kiểm tra số lượng, đơn giá và hạn sử dụng
    // 4. Kiểm tra tồn kho khi chỉnh sửa phiếu cũ
    if (initial) {
      for (const item of f.items) {
        const oldQty =
          initial.items
            ?.filter((x) => x.materialId === item.materialId)
            .reduce((sum, x) => sum + Number(x.qty), 0) || 0

        const stock =
          s.materials.find((m) => m.id === item.materialId)?.stock || 0

        if (Number(item.qty) > stock + oldQty) {
          const material = s.materials.find(
            (m) => m.id === item.materialId
          )

          return setError(
            `Tồn kho không đủ để lưu thay đổi cho ${material?.name}.`
          )
        }
      }

      const oldTotals = new Map()
      const newTotals = new Map()

      initial.items?.forEach((x) => {
        oldTotals.set(
          x.materialId,
          (oldTotals.get(x.materialId) || 0) + Number(x.qty)
        )
      })

      f.items.forEach((x) => {
        newTotals.set(
          x.materialId,
          (newTotals.get(x.materialId) || 0) + Number(x.qty)
        )
      })

      for (const [id, oldQty] of oldTotals) {
        const stock =
          s.materials.find((m) => m.id === id)?.stock || 0

        if (
          stock + oldQty - (newTotals.get(id) || 0) < -1e-9
        ) {
          const material = s.materials.find((m) => m.id === id)

          return setError(
            `Không thể giảm số lượng đã nhập vì tồn kho ${material?.name} không đủ.`
          )
        }
      }
    }

    // 5. Chuẩn bị dữ liệu gửi lên Store và Backend
    const data = {
      ...f,
      items: f.items.map((x) => ({
        ...x,
        qty: Number(x.qty),
        unitPrice: Number(x.unitPrice)
      }))
    }

    // 6. Gửi dữ liệu và kiểm tra kết quả
    try {
      setSaving(true)

      const result = await onSave(data)

      if (!result?.success) {
        setError(
          result?.message || 'Không thể lưu phiếu nhập kho.'
        )
      }
    } catch (err) {
      setError(err.message || 'Không thể lưu phiếu nhập kho.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      className={`receipt-form-modal ${initial ? 'receipt-edit-form-modal' : ''}`}
      size="lg"
      header={<div className="receipt-form-head"><h3>{initial ? 'Chỉnh sửa phiếu nhập kho' : 'Thêm phiếu nhập kho'}</h3>{!initial && <span>Trường có dấu <b>*</b> là bắt buộc</span>}<button type="button" aria-label="Đóng" onClick={onClose} disabled={saving}><X size={15} /></button></div>}
      onClose={saving ? undefined : onClose}
      footer={<>{initial && <button className="btn" onClick={onBack} disabled={saving}>Quay lại</button>}<button className="btn" onClick={onClose} disabled={saving}>Hủy bỏ</button><button className="btn primary" onClick={save} disabled={saving || !formValid}>{saving ? 'Đang lưu...' : 'Lưu'}</button></>}
    >
      {error && <div className="banner error receipt-form-alert">{error}</div>}
      {s.materialsLoading && <div className="banner receipt-form-alert">Đang tải danh mục nguyên vật liệu từ SQL Server...</div>}
      {s.materialsError && <div className="banner error receipt-form-alert">Không thể tải danh mục nguyên vật liệu: {s.materialsError}</div>}

      {initial ? <section className="receipt-edit-info">
        <h4>Thông tin phiếu nhập kho</h4>
        <div className="receipt-edit-grid">
          <Field label="Mã phiếu"><input className="input" readOnly value={initial.id} /></Field>
          <Field label="Ngày nhập" required error={fieldErrors.date}><input className={`input ${fieldErrors.date ? 'err' : ''}`} type="date" max={todayISO()} value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Nhà cung cấp" required error={fieldErrors.supplier}><select className={`select ${fieldErrors.supplier ? 'err' : ''}`} value={f.supplier} onChange={(e) => set('supplier', e.target.value)}><option value="">Chọn nhà cung cấp</option>{s.suppliers.filter((x) => !x.deleted).map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}</select></Field>
          <Field label="Số hóa đơn"><input className="input" maxLength={100} value={f.invoice} onChange={(e) => set('invoice', e.target.value)} placeholder="Không bắt buộc" /></Field>
          <Field label="Ghi chú" className="receipt-edit-note-field"><textarea className="textarea receipt-note" maxLength={300} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Nhập ghi chú" /><small>Tối đa 300 ký tự.</small></Field>
        </div>
      </section> : <>
        <div className="grid2 receipt-general-grid">
          <Field label="Mã phiếu"><input className="input" readOnly value="Tự động tạo" /></Field>
          <Field label="Ngày nhập" required error={fieldErrors.date}><input className={`input ${fieldErrors.date ? 'err' : ''}`} type="date" max={todayISO()} value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Nhà cung cấp" required error={fieldErrors.supplier}><select className={`select ${fieldErrors.supplier ? 'err' : ''}`} value={f.supplier} onChange={(e) => set('supplier', e.target.value)}><option value="">Chọn nhà cung cấp</option>{s.suppliers.filter((x) => !x.deleted).map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}</select></Field>
          <Field label="Số hóa đơn"><input className="input" maxLength={100} value={f.invoice} onChange={(e) => set('invoice', e.target.value)} placeholder="Không bắt buộc" /></Field>
        </div>
        <Field label="Ghi chú" className="receipt-note-field"><textarea className="textarea receipt-note" maxLength={300} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Nhập ghi chú" /><small>Tối đa 300 ký tự.</small></Field>
      </>}

      <section className="receipt-lines-card">
        <h4>Danh sách nguyên vật liệu nhập</h4>
        <div className="receipt-lines-scroll"><table className="receipt-lines-table">
          <thead><tr><th>Nguyên vật liệu <span>*</span></th><th>ĐVT</th><th>Số lượng <span>*</span></th><th>Đơn giá (VNĐ) <span>*</span></th><th>Thành tiền</th><th>Hạn sử dụng</th><th /></tr></thead>
          <tbody>{f.items.map((item, idx) => {
            const selectedMaterial = activeMaterials.find((material) => material.id === item.materialId)
            const lineTotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0)
            return <tr key={idx}>
              <td><div className="receipt-cell-field">{initial && item.materialId ? <span className="receipt-material-name">{selectedMaterial?.name || item.materialName || item.materialId}</span> : <select className={`select receipt-material-select ${fieldErrors[`item-${idx}-material`] ? 'err' : ''}`} value={item.materialId} disabled={s.materialsLoading || !!s.materialsError || activeMaterials.length === 0} onChange={(e) => setLine(idx, 'materialId', e.target.value)}><option value="">Chọn nguyên vật liệu</option>{activeMaterials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</select>}{fieldErrors[`item-${idx}-material`] && <small>{fieldErrors[`item-${idx}-material`]}</small>}</div></td>
              <td>{selectedMaterial?.unit || '—'}</td>
              <td><div className="receipt-cell-field"><input className={`input ${fieldErrors[`item-${idx}-qty`] ? 'err' : ''}`} type="number" min="0" step="any" placeholder="Số lượng" value={item.qty} onChange={(e) => setLine(idx, 'qty', e.target.value)} />{fieldErrors[`item-${idx}-qty`] && <small>{fieldErrors[`item-${idx}-qty`]}</small>}</div></td>
              <td><div className="receipt-cell-field"><input className={`input ${fieldErrors[`item-${idx}-unitPrice`] ? 'err' : ''}`} type="number" min="0" step="1" placeholder="Đơn giá" value={item.unitPrice} onChange={(e) => setLine(idx, 'unitPrice', e.target.value)} />{fieldErrors[`item-${idx}-unitPrice`] && <small>{fieldErrors[`item-${idx}-unitPrice`]}</small>}</div></td>
              <td>{fmtMoney(lineTotal)} ₫</td>
              <td><div className="receipt-cell-field"><input className={`input ${fieldErrors[`item-${idx}-expiry`] ? 'err' : ''}`} type="date" aria-label="Hạn sử dụng" min={f.date} value={item.expiry || ''} onChange={(e) => setLine(idx, 'expiry', e.target.value)} />{fieldErrors[`item-${idx}-expiry`] && <small>{fieldErrors[`item-${idx}-expiry`]}</small>}</div></td>
              <td><button className="receipt-remove-line" type="button" aria-label="Xóa nguyên vật liệu" onClick={() => set('items', f.items.filter((_, i) => i !== idx))} disabled={saving}><Trash2 size={14} /></button></td>
            </tr>
          })}</tbody>
        </table></div>
        {!f.items.length && <div className="receipt-empty-lines">Phiếu nhập kho phải có ít nhất 1 nguyên vật liệu!</div>}
      </section>

      <div className="receipt-form-summary">
        <button className="btn sm" onClick={() => set('items', [...f.items, blankLine()])} disabled={saving || s.materialsLoading || !!s.materialsError || activeMaterials.length === 0}><Plus size={14} /> Thêm nguyên vật liệu</button>
        <div><b>Tổng tiền</b><strong>{fmtMoney(total)} ₫</strong></div>
      </div>
    </Modal>
  )
}

export default function Receipts() {
  const s = useStore()
  const [modal, setModal] = useState(null)
  const [toast, notify] = useToast()

  const rows = useMemo(
    () =>
      s.receipts
        .filter((r) => !r.deleted)
        .slice()
        .sort((a, b) => compareCodes(a.id, b.id)),
    [s.receipts]
  )

  const close = () => setModal(null)

  // Tải chi tiết phiếu từ Backend trước khi xem hoặc chỉnh sửa
  const openReceipt = async (receipt, kind) => {
    setModal({ kind: 'loading' })

    const result = await s.getReceiptDetail(receipt.id)

    if (!result.success) {
      close()

      notify({
        type: 'error',
        message: result.message || 'Không thể tải chi tiết phiếu nhập!'
      })

      return
    }

    setModal({
      kind,
      receipt: result.data
    })
  }

  const cols = [
    {
      label: 'Mã phiếu',
      render: (r) => <span className="code">{r.id}</span>
    },
    {
      label: 'Ngày nhập',
      render: (r) => fmtDate(r.date)
    },
    {
      label: 'Nhà cung cấp',
      render: (r) => <span className="name">{r.supplier}</span>
    },
    {
      label: 'Số nguyên vật liệu',
      render: (r) => `${r.items?.length || 0} mặt hàng`
    },
    {
      label: 'Tổng tiền (VNĐ)',
      num: true,
      render: (r) => fmtMoney(r.total)
    },
    {
      label: 'Thao tác',
      render: (r) => (
        <RowActions
          onView={() => openReceipt(r, 'view')}
          onEdit={() => openReceipt(r, 'edit')}
          onDelete={() => setModal({ kind: 'delete', receipt: r })}
        />
      )
    }
  ]

  // Đang tải dữ liệu phiếu nhập
  if (modal?.kind === 'loading') {
    return (
      <div className="card" style={{ padding: 24 }}>
        Đang tải thông tin phiếu nhập kho...
      </div>
    )
  }

  // Xem chi tiết phiếu nhập
  if (modal?.kind === 'view') {
    const receipt = modal.receipt
    const items = receipt.items || []

    const total =
      receipt.total ??
      items.reduce(
        (sum, item) => sum + item.qty * item.unitPrice,
        0
      )

    return (
      <>
        <div className="receipt-detail-page">
          <div className="page-head">
            <h2>Chi tiết phiếu nhập kho</h2>
          </div>

          <section className="card receipt-detail-info">
            <h3 className="receipt-detail-section-title">
              Thông tin chung
            </h3>

            <div className="receipt-detail-grid">
              <Field label="Mã phiếu">
                <input
                  className="input"
                  readOnly
                  value={receipt.id}
                />
              </Field>

              <Field label="Ngày nhập">
                <input
                  className="input"
                  readOnly
                  value={fmtDate(receipt.date)}
                />
              </Field>

              <Field label="Nhà cung cấp">
                <input
                  className="input"
                  readOnly
                  value={receipt.supplier}
                />
              </Field>

              <Field label="Số hóa đơn">
                <input
                  className="input"
                  readOnly
                  value={receipt.invoice || '—'}
                />
              </Field>

              <Field label="Ghi chú">
                <input
                  className="input"
                  readOnly
                  value={receipt.note || '—'}
                />
              </Field>
            </div>
          </section>

          <section className="card receipt-detail-items">
            <h3 className="receipt-detail-section-title">
              Danh sách nguyên vật liệu đã nhập
            </h3>

            <div className="receipt-detail-table-wrap">
              <table className="tbl receipt-detail-table">
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Tên nguyên vật liệu</th>
                    <th>ĐVT</th>
                    <th>Số lượng</th>
                    <th>Đơn giá (VNĐ)</th>
                    <th>Thành tiền (VNĐ)</th>
                    <th>Hạn sử dụng</th>
                  </tr>
                </thead>

                <tbody>
                  {items.map((item, index) => {
                    const material = s.materials.find(
                      (m) => m.id === item.materialId
                    )

                    return (
                      <tr key={`${item.materialId}-${index}`}>
                        <td>{index + 1}</td>

                        <td className="name">
                          {material?.name || item.materialName || item.materialId}
                        </td>

                        <td>{material?.unit || '—'}</td>

                        <td>{fmtNum(item.qty)}</td>

                        <td>{fmtMoney(item.unitPrice)}</td>

                        <td>
                          {fmtMoney(item.qty * item.unitPrice)}
                        </td>

                        <td>
                          {item.expiry
                            ? fmtDate(item.expiry)
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="receipt-detail-total">
              <span>Tổng tiền</span>
              <strong>{fmtMoney(total)} đ</strong>
            </div>
          </section>

          <div className="receipt-detail-actions">
            <button className="btn" onClick={close}>
              Quay lại
            </button>
          </div>
        </div>

        {toast}
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <h2>Quản lý phiếu nhập kho</h2>

        <button
          className="btn"
          onClick={() => setModal({ kind: 'add' })}
        >
          <Plus size={18} />
          Thêm phiếu nhập
        </button>
      </div>

      <div className="card">
        {s.receiptsLoading && <div className="banner">Đang tải phiếu nhập từ SQL Server...</div>}
        {s.receiptsError && <div className="banner error">Không thể tải phiếu nhập từ SQL Server: {s.receiptsError}</div>}
        <DataTable
          columns={cols}
          rows={rows}
          emptyText="Chưa có phiếu nhập kho"
        />
      </div>

      {/* Thêm phiếu nhập kho */}
      {modal?.kind === 'add' && (
        <ReceiptForm
          onClose={close}
          onSave={async (v) => {
            const result = await s.addReceipt(v)

            if (!result.success) {
              return result
            }

            close()

            notify({
              type: 'success',
              message: result.message || 'Thêm phiếu nhập kho thành công!'
            })

            return result
          }}
        />
      )}

      {/* Chỉnh sửa phiếu nhập kho */}
      {modal?.kind === 'edit' && (
        <ReceiptForm
          key={modal.receipt.id}
          initial={modal.receipt}
          onBack={() => openReceipt(modal.receipt, 'view')}
          onClose={close}
          onSave={async (v) => {
            const result = await s.updateReceipt(
              modal.receipt.id,
              v
            )

            if (!result.success) {
              return result
            }

            close()

            notify({
              type: 'success',
              message: result.message || 'Cập nhật phiếu nhập kho thành công!'
            })

            return result
          }}
        />
      )}

      {/* Xóa phiếu nhập kho */}
      {modal?.kind === 'delete' && (
        <ConfirmModal
          className="receipt-delete-confirm-modal"
          title="Xóa phiếu nhập kho"
          confirmText="Xác nhận"
          error={modal.error}
          header={<div className="receipt-delete-confirm-head"><span><Trash2 size={16} /></span></div>}
          onClose={close}
          onConfirm={async () => {
            const result = await s.deleteReceipt(
              modal.receipt.id
            )

            if (!result.success) {
              return notify({
                type: 'error',
                message: result.message || 'Không thể xóa phiếu nhập kho!'
              })
            }

            close()

            notify({
              type: 'success',
              message: 'Xóa phiếu nhập kho thành công!'
            })
          }}
        >
          <p className="receipt-delete-question">Bạn có chắc chắn muốn xóa phiếu nhập kho {modal.receipt.id} không?</p>
          <p className="receipt-delete-note">Số lượng nguyên vật liệu trong phiếu sẽ bị trừ khỏi tồn kho.</p>
        </ConfirmModal>
      )}

      {toast}
    </>
  )
}
