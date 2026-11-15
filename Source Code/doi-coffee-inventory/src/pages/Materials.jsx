import { useMemo, useState } from 'react'
import { Plus, Search, RefreshCw, CircleAlert, LockKeyhole } from 'lucide-react'
import { normalizeText, useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'
import {
  DataTable,
  RowActions,
  SearchBox,
  Select,
  Modal,
  Field,
  fmtNum,
  fmtDate,
  useToast
} from '../components/ui.jsx'
import { stockStatus, expiryStatus } from '../components/helpers.js'
import { addMaterial, updateMaterial, deleteMaterial } from '../service/materialApi.js'

const empty = {
  name: '',
  group: '',
  unit: '',
  stock: 0,
  min: '',
  expiry: '',
  ratio: '',
  subUnit: '',
  supplier: ''
}

const UNITS = ['kg', 'g', 'ml', 'lít', 'cái', 'lon', 'chai', 'hộp', 'túi']

// Chuyển tên trường của giao diện sang đúng cột mà Backend yêu cầu.
const toApiPayload = (item) => ({
  tenNVL: String(item.name ?? '').trim(),
  nhomNVL: String(item.group ?? '').trim(),
  maNCC: String(item.supplier ?? '').trim(),
  donViTinh: String(item.unit ?? '').trim(),
  donViQuyDoi: String(item.subUnit ?? '').trim() || null,
  tyLeQuyDoi: item.ratio === '' || item.ratio == null ? null : Number(item.ratio),
  mucTonToiThieu: Number(item.min)
})

function MaterialForm({ initial, materials, groups, onSave, onClose, title }) {
  const [f, setF] = useState(
    initial
      ? {
          ...initial,
          ratio: initial.ratio ?? '',
          subUnit: initial.subUnit ?? '',
          expiry: initial.expiry ?? ''
        }
      : { ...empty }
  )
  const [errs, setErrs] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (key) => (event) => {
    setF((prev) => ({ ...prev, [key]: event.target.value }))
  }

  const submit = async () => {
    if (saving) return
    const errors = {}
    const requiredLabels = {
      name: 'Tên nguyên vật liệu',
      group: 'Nhóm nguyên vật liệu',
      unit: 'Đơn vị tính',
      supplier: 'Nhà cung cấp'
    }

    Object.entries(requiredLabels).forEach(([key, label]) => {
      if (!String(f[key] ?? '').trim()) {
        errors[key] = `${label} không được để trống`
      }
    })

    if (f.min === '') {
      errors.min = 'Định mức tồn tối thiểu không được để trống'
    } else if (!Number.isFinite(Number(f.min)) || Number(f.min) <= 0) {
      errors.min = 'Giá trị phải lớn hơn 0'
    } else if (!Number.isInteger(Number(f.min))) {
      errors.min = 'Định mức phải là số nguyên'
    }

    if (String(f.subUnit ?? '').trim() && !String(f.ratio ?? '').trim()) {
      errors.ratio = 'Vui lòng nhập đồng thời Đơn vị quy đổi và Tỷ lệ quy đổi'
    } else if (String(f.ratio ?? '').trim() && !String(f.subUnit ?? '').trim()) {
      errors.subUnit = 'Vui lòng nhập đồng thời Đơn vị quy đổi và Tỷ lệ quy đổi'
    }

    const ratioText = String(f.ratio ?? '').trim().replace(',', '.')
    if (ratioText && (!Number.isFinite(Number(ratioText)) || Number(ratioText) <= 0)) {
      errors.ratio = 'Giá trị phải lớn hơn 0'
    }

    // Mã NCC được SQL Server xác thực qua API; Store cũ có thể khác CSDL thật.
    if (String(f.supplier ?? '').trim() && !/^NCC\d{4}$/i.test(String(f.supplier).trim())) {
      errors.supplier = 'Nhập mã nhà cung cấp, ví dụ NCC0004'
    }

    if (materials.some((material) =>
      !material.deleted &&
      material.id !== initial?.id &&
      normalizeText(material.name) === normalizeText(f.name)
    )) {
      errors.name = 'Tên nguyên vật liệu đã tồn tại'
    }

    setErrs(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      await onSave({
        ...f,
        stock: initial ? initial.stock : 0,
        min: Number(f.min),
        ratio: ratioText === '' ? null : Number(ratioText),
        subUnit: f.subUnit || ''
      })
    } finally {
      setSaving(false)
    }
  }

  const inp = (key, props = {}) => (
    <input
      className={`input ${errs[key] ? 'err' : ''}`}
      value={f[key] ?? ''}
      onChange={set(key)}
      {...props}
    />
  )

  const locked = (value, className = '') => (
    <div className={`readonly-with-lock ${className}`}>
      <input className="input" readOnly value={value ?? ''} />
      <LockKeyhole size={12} />
    </div>
  )

  return (
    <Modal
      size={initial ? 'material-form-modal' : 'material-add-modal'}
      header={
        <div className="material-form-header">
          <div>
            <h3>{title}</h3>
            {initial && <p>{initial.id} · {initial.name}</p>}
          </div>
          <span>Trường có dấu <b>*</b> là bắt buộc</span>
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Hủy bỏ</button>
          <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</button>
        </>
      }
    >
      <div className="grid2 material-edit-grid">
        {initial ? (
          <>
            <Field label="Mã nguyên vật liệu">{locked(initial.id)}</Field>
            <Field label="Tỷ lệ quy đổi" error={errs.ratio} hint="Tùy chọn; phải lớn hơn 0">
              {inp('ratio', { type: 'text', inputMode: 'decimal' })}
            </Field>
            <Field label="Tên nguyên vật liệu" required error={errs.name} plainError>
              {inp('name')}
            </Field>
            <Field label="Số lượng tồn kho">
              {locked(`${fmtNum(initial.stock)} ${f.unit}`, 'white-readonly')}
            </Field>
            <Field label="Nhóm nguyên vật liệu" required error={errs.group} plainError>
              <Select
                className={`material-group-select ${errs.group ? 'err' : ''}`}
                value={f.group}
                onChange={(value) => setF((prev) => ({ ...prev, group: value }))}
                options={groups}
                placeholder="Chọn nhóm"
              />
            </Field>
            <Field label="Định mức tồn tối thiểu" required error={errs.min} plainError>
              <div className="unit-input-wrap">
                {inp('min', { type: 'number', min: 0, step: 1 })}
                <span>{f.unit}</span>
              </div>
            </Field>
            <Field label="Đơn vị tính" required error={errs.unit} plainError>
              <Select
                className={errs.unit ? 'err' : ''}
                value={f.unit}
                onChange={(value) => setF((prev) => ({ ...prev, unit: value }))}
                options={UNITS}
                placeholder="Chọn đơn vị"
              />
            </Field>
            <Field label="Hạn sử dụng">
              {locked(initial.expiry ? fmtDate(initial.expiry) : 'Không áp dụng')}
            </Field>
            <Field label="Đơn vị quy đổi" error={errs.subUnit} hint="Tùy chọn; phải nhập cùng tỷ lệ quy đổi">
              <Select
                className={errs.subUnit ? 'err' : ''}
                value={f.subUnit}
                onChange={(value) => setF((prev) => ({ ...prev, subUnit: value }))}
                options={UNITS}
                placeholder="Chọn đơn vị"
              />
            </Field>
            <Field label="Nhà cung cấp" required error={errs.supplier} plainError>
              {inp('supplier', { placeholder: 'Ví dụ: NCC0004' })}
            </Field>
          </>
        ) : (
          <>
            <Field label="Mã nguyên vật liệu">{locked('Hệ thống tự sinh')}</Field>
            <Field label="Đơn vị quy đổi" error={errs.subUnit}>
              <Select
                className={errs.subUnit ? 'err' : ''}
                value={f.subUnit}
                onChange={(value) => setF((prev) => ({ ...prev, subUnit: value }))}
                options={UNITS}
                placeholder="Chọn đơn vị quy đổi"
              />
            </Field>
            <Field label="Tên nguyên vật liệu" required error={errs.name} plainError>
              {inp('name', { placeholder: 'Nhập tên nguyên vật liệu' })}
            </Field>
            <Field label="Tỷ lệ quy đổi" error={errs.ratio}>
              {inp('ratio', { type: 'text', inputMode: 'decimal', placeholder: 'Ví dụ: 1000' })}
            </Field>
            <Field label="Nhóm nguyên vật liệu" required error={errs.group} plainError>
              <Select
                className={`material-group-select ${errs.group ? 'err' : ''}`}
                value={f.group}
                onChange={(value) => setF((prev) => ({ ...prev, group: value }))}
                options={groups}
                placeholder="Chọn nhóm nguyên vật liệu"
              />
            </Field>
            <Field label="Định mức tồn tối thiểu" required error={errs.min} plainError>
              {inp('min', { type: 'number', min: 0, step: 1, placeholder: 'Nhập định mức tồn tối thiểu' })}
            </Field>
            <Field label="Đơn vị tính" required error={errs.unit} plainError>
              <Select
                className={errs.unit ? 'err' : ''}
                value={f.unit}
                onChange={(value) => setF((prev) => ({ ...prev, unit: value }))}
                options={UNITS}
                placeholder="Chọn đơn vị tính"
              />
            </Field>
            <Field label="Nhà cung cấp" required error={errs.supplier} plainError>
              {inp('supplier', { placeholder: 'Ví dụ: NCC0004' })}
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}

export default function Materials() {
  const s = useStore()
  const materials = s.materials
  const groups = s.materialGroups
  const loading = s.materialsLoading
  const apiError = s.materialsError
  const [deleting, setDeleting] = useState(false)

  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [stat, setStat] = useState('')
  const [exp, setExp] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ q: '', group: '', stat: '', exp: '' })
  const [modal, setModal] = useState(null)
  const [toast, notify] = useToast()

  const rows = useMemo(() => materials.filter((m) =>
    !m.deleted &&
    (!appliedFilters.q || normalizeText(m.id + m.name).includes(normalizeText(appliedFilters.q))) &&
    (!appliedFilters.group || m.group === appliedFilters.group) &&
    (!appliedFilters.stat || stockStatus(m) === appliedFilters.stat) &&
    (!appliedFilters.exp || expiryStatus(m.expiry, m.stock) === appliedFilters.exp)
  ).slice().sort((a, b) => compareCodes(a.id, b.id)), [materials, appliedFilters])

  const search = () => setAppliedFilters({ q, group, stat, exp })

  const reset = () => {
    setQ('')
    setGroup('')
    setStat('')
    setExp('')
    setAppliedFilters({ q: '', group: '', stat: '', exp: '' })
    s.refreshMaterials()
  }

  const close = () => setModal(null)

  const cols = [
    { label: 'Mã NVL', render: (m) => <span className="code">{m.id}</span> },
    { label: 'Tên nguyên vật liệu', render: (m) => <span className="name">{m.name}</span> },
    { label: 'Nhóm NVL', key: 'group' },
    { label: 'Đơn vị tính', key: 'unit' },
    {
      label: 'Số lượng tồn kho',
      render: (m) => <span className={m.stock <= m.min ? 'red' : ''}>{fmtNum(m.stock)}</span>
    },
    {
      label: 'Hạn sử dụng',
      render: (m) => (
        <span className={['Đã hết hạn', 'Sắp hết hạn'].includes(expiryStatus(m.expiry, m.stock)) ? 'red' : ''}>
          {expiryStatus(m.expiry, m.stock) === 'Không áp dụng'
            ? 'Không áp dụng'
            : (m.expiry ? fmtDate(m.expiry) : 'Không áp dụng')}
        </span>
      )
    },
    {
      label: 'Thao tác',
      render: (m) => (
        <RowActions
          onView={() => setModal({ type: 'view', item: m })}
          onEdit={() => setModal({ type: 'edit', item: m })}
          onDelete={() => setModal({ type: 'del', item: m })}
        />
      )
    }
  ]

  return (
    <>
      <div className="page-head">
        <h2>Quản lý nguyên vật liệu</h2>
        <button className="btn" onClick={() => setModal({ type: 'add' })}>
          <Plus size={18} /> Thêm nguyên vật liệu
        </button>
      </div>

      <div className="card materials-card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm theo mã hoặc tên nguyên vật liệu" />
          <Select value={group} onChange={setGroup} options={groups} placeholder="Tất cả nhóm NVL" />
          <Select value={stat} onChange={setStat} options={['Còn hàng', 'Sắp hết', 'Hết hàng']} placeholder="Trạng thái tồn kho" />
          <Select
            value={exp}
            onChange={setExp}
            options={['Còn hạn', 'Sắp hết hạn', 'Đã hết hạn', 'Không áp dụng']}
            placeholder="Trạng thái hạn sử dụng"
          />
          <button className="btn primary square custom-tooltip" data-tooltip="Tìm kiếm" aria-label="Tìm kiếm" onClick={search}>
            <Search size={18} />
          </button>
          <button className="btn square" title="Làm mới" onClick={reset}>
            <RefreshCw size={18} />
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <RefreshCw size={28} style={{ marginBottom: '12px' }} />
            <p>Đang tải dữ liệu từ SQL Server...</p>
          </div>
        ) : apiError ? (
          <div style={{ padding: '30px', textAlign: 'center', color: 'red' }}>
            <CircleAlert size={30} />
            <p>Không thể tải danh sách nguyên vật liệu!</p>
            <p>{apiError}</p>
          </div>
        ) : (
          <DataTable
            columns={cols}
            rows={rows}
            emptyContent={
              <div className="material-empty-state">
                <Search size={42} strokeWidth={1.8} />
                <b>Không tìm thấy nguyên vật liệu phù hợp!</b>
              </div>
            }
            hideEmptyPager
          />
        )}
      </div>

      {modal?.type === 'view' && (
        <Modal
          className="material-detail-modal"
          title="Chi tiết nguyên vật liệu"
          subtitle="Chỉ xem – không thể chỉnh sửa thông tin tại màn hình này"
          size="lg"
          onClose={close}
          footer={<button className="btn primary" onClick={close}>Đóng</button>}
        >
          <div className="grid2 material-detail-grid">
            {[
              ['Mã nguyên vật liệu', modal.item.id],
              ['Tỷ lệ quy đổi', modal.item.ratio],
              ['Tên nguyên vật liệu', modal.item.name],
              ['Số lượng tồn kho', `${fmtNum(modal.item.stock)} ${modal.item.unit}`],
              ['Nhóm nguyên vật liệu', modal.item.group],
              ['Định mức tồn tối thiểu', `${fmtNum(modal.item.min)} ${modal.item.unit}`],
              ['Đơn vị tính', modal.item.unit],
              ['Hạn sử dụng', modal.item.expiry ? fmtDate(modal.item.expiry) : 'Không áp dụng'],
              ['Đơn vị quy đổi', modal.item.subUnit],
              ['Nhà cung cấp', s.suppliers.find((supplier) => supplier.id === modal.item.supplier || supplier.name === modal.item.supplier)?.name || modal.item.supplier]
            ].map(([label, value]) => (
              <Field key={label} label={label}>
                <input className="input" readOnly value={value ?? ''} />
              </Field>
            ))}
          </div>
        </Modal>
      )}

      {modal?.type === 'add' && (
        <MaterialForm
          title="Thêm nguyên vật liệu"
          materials={materials}
          groups={groups}
          onClose={close}
          onSave={async (value) => {
            try {
              await addMaterial(toApiPayload(value))
              close()
              await s.refreshMaterials()
              notify('Thêm nguyên vật liệu thành công!')
            } catch (error) {
              notify({ type: 'error', message: error.message || 'Không thể thêm nguyên vật liệu!' })
            }
          }}
        />
      )}

      {modal?.type === 'edit' && (
        <MaterialForm
          title="Chỉnh sửa nguyên vật liệu"
          initial={modal.item}
          materials={materials}
          groups={groups}
          onClose={close}
          onSave={async (value) => {
            try {
              await updateMaterial(modal.item.id, toApiPayload(value))
              close()
              await s.refreshMaterials()
              notify('Cập nhật nguyên vật liệu thành công!')
            } catch (error) {
              notify({ type: 'error', message: error.message || 'Không thể cập nhật nguyên vật liệu!' })
            }
          }}
        />
      )}

      {modal?.type === 'del' && (
        <Modal
          size="material-delete-confirm"
          header={<div className="material-delete-icon"><CircleAlert size={22} /></div>}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>Hủy bỏ</button>
              <button
                className="btn primary"
                disabled={deleting}
                onClick={async () => {
                  if (deleting) return
                  if (modal.item.stock > 0) {
                    return notify({ type: 'error', message: 'Không thể xóa nguyên vật liệu còn tồn kho.' })
                  }
                  // Kiểm tra này từ Store hiện tại; Backend cũng cần tự kiểm tra dữ liệu tham chiếu.
                  if (s.isMaterialUsed?.(modal.item.id)) {
                    return notify({ type: 'error', message: 'Nguyên vật liệu đang được tham chiếu bởi công thức hoặc phiếu.' })
                  }
                  setDeleting(true)
                  try {
                    await deleteMaterial(modal.item.id)
                    close()
                    await s.refreshMaterials()
                    notify('Xóa nguyên vật liệu thành công')
                  } catch (error) {
                    notify({ type: 'error', message: error.message || 'Không thể xóa nguyên vật liệu!' })
                  } finally {
                    setDeleting(false)
                  }
                }}
              >
                {deleting ? 'Đang xóa...' : 'Xác nhận'}
              </button>
            </>
          }
        >
          <p className="material-delete-message">
            Bạn có chắc muốn xóa nguyên vật liệu {modal.item.name} không?
          </p>
        </Modal>
      )}

      {toast}
    </>
  )
}
