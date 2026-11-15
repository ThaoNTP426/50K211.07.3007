
import { useMemo, useState } from 'react'
import { Plus, Lock, Trash2 } from 'lucide-react'
import { normalizeText, useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'
import {
  DataTable,
  RowActions,
  SearchBox,
  Modal,
  Field,
  useToast
} from '../components/ui.jsx'

function SupplierForm({ initial, suppliers, onSave, onClose }) {
  const [f, setF] = useState(
    initial ?? {
      name: '',
      phone: '',
      address: '',
      email: ''
    }
  )

  const [e, setE] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (k) => (ev) =>
    setF({ ...f, [k]: ev.target.value })

  const submit = async () => {
    const er = {}

    if (!f.name.trim()) {
      er.name = 'Trường bắt buộc, không được để trống'
    } else if (
      suppliers.some(
        (s) =>
          !s.deleted &&
          s.id !== initial?.id &&
          normalizeText(s.name) === normalizeText(f.name)
      )
    ) {
      er.name = 'Tên nhà cung cấp đã tồn tại'
    }

    if (!f.phone.trim()) {
      er.phone = 'Trường bắt buộc, không được để trống'
    } else if (!/^0\d{9}$/.test(f.phone.trim())) {
      er.phone = 'Số điện thoại gồm 10 chữ số và bắt đầu bằng 0'
    }

    if (!f.address.trim()) {
      er.address = 'Trường bắt buộc, không được để trống'
    }

    if (
      f.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())
    ) {
      er.email = 'Email không đúng định dạng'
    }

    setE(er)

    if (Object.keys(er).length) return

    setSaving(true)

    try {
      await onSave({
        ...f,
        name: f.name.trim(),
        phone: f.phone.trim(),
        address: f.address.trim(),
        email: f.email.trim()
      })
    } finally {
      setSaving(false)
    }
  }

  const inp = (k, ph) => (
    <input
      className={`input ${e[k] ? 'err' : ''}`}
      value={f[k]}
      onChange={set(k)}
      placeholder={ph}
    />
  )

  return (
    <Modal
      title={
        initial
          ? 'Chỉnh sửa thông tin nhà cung cấp'
          : 'Thêm nhà cung cấp'
      }
      subtitle={
        initial
          ? 'Cập nhật thông tin nhà cung cấp'
          : 'Nhập thông tin nhà cung cấp mới'
      }
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            onClick={onClose}
            disabled={saving}
          >
            Hủy bỏ
          </button>

          <button
            className="btn primary"
            onClick={submit}
            disabled={saving}
          >
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Field
          label="Mã nhà cung cấp"
          hint="Mã do hệ thống tự động tạo (NCC + 4 chữ số), không thể chỉnh sửa"
        >
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              readOnly
              value={initial?.id ?? 'Tự động tạo'}
            />

            <Lock
              size={14}
              style={{
                position: 'absolute',
                right: 12,
                top: 13,
                color: '#9ca3af'
              }}
            />
          </div>
        </Field>

        <Field label="Tên nhà cung cấp" required error={e.name}>
          {inp('name', 'Nhập tên nhà cung cấp')}
        </Field>

        <Field label="Số điện thoại" required error={e.phone}>
          {inp(
            'phone',
            'Nhập số điện thoại (10 chữ số, bắt đầu bằng 0)'
          )}
        </Field>

        <Field label="Địa chỉ" required error={e.address}>
          {inp('address', 'Nhập địa chỉ nhà cung cấp')}
        </Field>

        <Field label="Email" error={e.email}>
          {inp('email', 'Nhập email (không bắt buộc)')}
        </Field>
      </div>
    </Modal>
  )
}

export default function Suppliers() {
  const s = useStore()

  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null)
  const [toast, notify] = useToast()
  const [deleting, setDeleting] = useState(false)

  const rows = useMemo(
    () =>
      s.suppliers.filter(
        (x) =>
          !x.deleted &&
          (!q ||
            normalizeText(x.id + x.name).includes(normalizeText(q)))
      ).slice().sort((a, b) => compareCodes(a.id, b.id)),
    [s.suppliers, q]
  )

  const close = () => {
    setModal(null)
    setDeleting(false)
  }

  // Thêm nhà cung cấp
  const handleAdd = async (v) => {
    const result = await s.addSupplier(v)

    if (!result.success) {
      notify({
        type: 'error',
        message: result.message
      })
      return
    }

    close()
    notify('Thêm nhà cung cấp thành công')
  }

  // Cập nhật nhà cung cấp
  const handleEdit = async (v) => {
    const result = await s.updateSupplier(modal.x.id, v)

    if (!result.success) {
      notify({
        type: 'error',
        message: result.message
      })
      return
    }

    close()
    notify('Chỉnh sửa thông tin nhà cung cấp thành công')
  }

  // Xóa nhà cung cấp
  const handleDelete = async () => {
    if (deleting) return

    if (s.isSupplierUsed(modal.x.name)) {
      close()

      notify({
        type: 'error',
        message: 'Nhà cung cấp đang được sử dụng, không thể xóa.'
      })

      return
    }

    setDeleting(true)

    const result = await s.deleteSupplier(modal.x.id)

    if (!result.success) {
      setDeleting(false)

      notify({
        type: 'error',
        message: result.message
      })

      return
    }

    close()
    notify('Xóa nhà cung cấp thành công')
  }

  const cols = [
    {
      label: 'Mã NCC',
      render: (x) => <span className="code">{x.id}</span>
    },
    {
      label: 'Tên nhà cung cấp',
      render: (x) => <span className="name">{x.name}</span>
    },
    {
      label: 'Số điện thoại',
      render: (x) => <span className="muted">{x.phone}</span>
    },
    {
      label: 'Địa chỉ',
      render: (x) => <span className="muted">{x.address}</span>
    },
    {
      label: 'Email',
      render: (x) => (
        <span className="muted">{x.email || '—'}</span>
      )
    },
    {
      label: 'Thao tác',
      render: (x) => (
        <RowActions
          onView={() => setModal({ k: 'view', x })}
          onEdit={() => setModal({ k: 'edit', x })}
          onDelete={() => setModal({ k: 'del', x })}
        />
      )
    }
  ]

  return (
    <>
      <div className="page-head">
        <h2>Quản lý nhà cung cấp</h2>

        <button
          className="btn"
          onClick={() => setModal({ k: 'add' })}
        >
          <Plus size={18} />
          Thêm nhà cung cấp
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Tìm theo mã hoặc tên nhà cung cấp"
          />
        </div>

        <DataTable
          columns={cols}
          rows={rows}
          emptyText="Không tìm thấy nhà cung cấp phù hợp"
        />
      </div>

      {/* Thêm nhà cung cấp */}
      {modal?.k === 'add' && (
        <SupplierForm
          suppliers={s.suppliers}
          onClose={close}
          onSave={handleAdd}
        />
      )}

      {/* Chỉnh sửa nhà cung cấp */}
      {modal?.k === 'edit' && (
        <SupplierForm
          initial={modal.x}
          suppliers={s.suppliers}
          onClose={close}
          onSave={handleEdit}
        />
      )}

      {/* Xem chi tiết nhà cung cấp */}
      {modal?.k === 'view' && (
        <Modal
          title="Chi tiết nhà cung cấp"
          onClose={close}
          footer={
            <button className="btn primary" onClick={close}>
              Đóng
            </button>
          }
        >
          <div style={{ display: 'grid', gap: 14 }}>
            {[
              ['Mã nhà cung cấp', modal.x.id],
              ['Tên nhà cung cấp', modal.x.name],
              ['Số điện thoại', modal.x.phone],
              ['Địa chỉ', modal.x.address],
              ['Email', modal.x.email || '—']
            ].map(([l, v]) => (
              <Field key={l} label={l}>
                <input
                  className="input"
                  readOnly
                  value={v}
                />
              </Field>
            ))}
          </div>
        </Modal>
      )}

      {/* Xác nhận xóa nhà cung cấp */}
      {modal?.k === 'del' && (
        <Modal
          size="supplier-delete-confirm"
          header={
            <div className="supplier-delete-header">
              <div className="supplier-delete-icon">
                <Trash2 size={20} />
              </div>

              <h3>Xác nhận xóa nhà cung cấp</h3>
            </div>
          }
          onClose={close}
          footer={
            <>
              <button
                className="btn"
                onClick={close}
                disabled={deleting}
              >
                Hủy bỏ
              </button>

              <button
                className="btn primary"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Đang xóa...' : 'Xác nhận'}
              </button>
            </>
          }
        >
          <p className="supplier-delete-message">
            Bạn có chắc chắn muốn xóa nhà cung cấp{' '}
            <strong>{modal.x.name}</strong> không?
          </p>
        </Modal>
      )}

      {toast}
    </>
  )
}
