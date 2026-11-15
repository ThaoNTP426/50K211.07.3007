import { useMemo, useState } from 'react'
import { Plus, LockKeyhole, Trash2, BookOpen, CircleAlert } from 'lucide-react'
import { normalizeText, useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'
import { DataTable, RowActions, Modal, Field, Select, fmtNum, useToast } from '../components/ui.jsx'

const blank = () => ({ materialId: '', qty: '', note: '' })
const RECIPE_UNITS = ['ly', 'phần', 'cái']
const RECIPE_GROUPS = ['Cà phê', 'Latte', 'Sinh tố', 'Nước ép']
const RECIPE_TYPES = [{ value: 'Món chính', label: 'Món chính' }, { value: 'Extra', label: 'Món thêm' }]
const recipeTypeLabel = (type) => type === 'Extra' ? 'Món thêm' : type

const materialSelectOptions = (materials, used) =>
  materials
    .filter((m) => !m.deleted)
    .map((m) => ({
      value: m.id,
      label: `${m.name}${used.includes(m.id) ? ' · Đã chọn' : ''}`,
      optionLabel: (
        <span className="recipe-material-option-content">
          <span className={used.includes(m.id) ? 'is-used' : ''}>{m.name}</span>
          <span className="recipe-material-option-meta">
            {used.includes(m.id) ? <small>Đã chọn</small> : <small>{m.subUnit || m.unit}</small>}
          </span>
        </span>
      ),
      disabled: used.includes(m.id),
    }))

export default function Recipes() {
  const s = useStore()
  const recipeRows = useMemo(() => s.recipes.slice().sort((a, b) => compareCodes(a.id, b.id)), [s.recipes])
  const [modal, setModal] = useState(null)
  const [toast, notify] = useToast()
  const [f, setF] = useState({ name: '', group: '', type: 'Món chính', unit: 'ly', note: '', items: [blank()] })
  const [err, setErr] = useState('')
  const [showItemErrors, setShowItemErrors] = useState(false)

  const mat = (id) => s.materials.find((m) => m.id === id)

  const setItem = (idx, key, value) =>
    setF((x) => ({
      ...x,
      items: x.items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    }))

  const openAdd = () => {
    setF({ name: '', group: '', type: 'Món chính', unit: '', note: '', items: [] })
    setErr('')
    setShowItemErrors(false)
    setModal({ k: 'add' })
  }

  const openEdit = (r) => {
    setF({
      name: r.name,
      group: r.group,
      type: r.type,
      unit: r.unit || 'ly',
      note: r.note || '',
      items: r.items.map((i, idx) => ({ ...i, note: i.note ?? (idx === 0 ? r.note || '' : '') })),
    })
    setErr('')
    setShowItemErrors(false)
    setModal({ k: 'edit', r })
  }

  const save = async () => {
    const items = f.items

    if (s.materialsLoading) return setErr('Đang tải danh mục nguyên vật liệu từ SQL Server. Vui lòng chờ!')
    if (s.materialsError || s.materials.length === 0) return setErr(s.materialsError || 'Danh mục nguyên vật liệu đang trống.')

    if (!f.name.trim() || !f.group.trim() || !f.type || !f.unit) {
      return setErr('Vui lòng nhập tên món, nhóm món, loại công thức và đơn vị tính.')
    }

    if (!items.length) {
      setShowItemErrors(true)
      setErr('')
      return
    }

    if (f.name.trim().length > 100 || f.note.length > 500) {
      return setErr('Tên món tối đa 100 ký tự; ghi chú pha chế tối đa 500 ký tự.')
    }

    if (s.recipes.some((r) => r.id !== modal?.r?.id && r.type === f.type && normalizeText(r.name) === normalizeText(f.name))) {
      return setErr('Tên món đã tồn tại trong cùng loại công thức.')
    }

    if (items.some((i) => !i.materialId || !Number.isFinite(Number(i.qty)) || Number(i.qty) <= 0)) {
      setShowItemErrors(true)
      setErr('')
      return
    }

    const ids = items.map((i) => i.materialId)
    if (new Set(ids).size !== ids.length) {
      return setErr('Không được chọn trùng nguyên vật liệu trong cùng một công thức.')
    }

    if (items.some((i) => !mat(i.materialId) || mat(i.materialId).deleted)) {
      return setErr('Nguyên vật liệu không còn hoạt động trong danh mục.')
    }

    const value = {
      name: f.name.trim(),
      group: f.group.trim(),
      type: f.type,
      unit: f.unit || 'ly',
      note: modal?.k === 'edit' ? (items[0]?.note || '').trim() : f.note.trim(),
      items: items.map((i) => ({
        materialId: i.materialId,
        qty: Number(i.qty),
        unit: mat(i.materialId).subUnit || mat(i.materialId).unit,
        note: (i.note || '').trim(),
      })),
    }

    const result = modal?.k === 'edit'
      ? await s.updateRecipe(modal.r.id, value)
      : await s.addRecipe(value)
    if (!result.success) return setErr(result.message || 'Không thể lưu công thức món')
    notify(result.message || (modal?.k === 'edit' ? 'Cập nhật công thức món thành công!' : 'Thêm công thức món thành công'))
    setModal(null)
  }

  const cols = [
    { label: 'Mã món', render: (r) => <span className="recipe-code">{r.id}</span> },
    { label: 'Tên món', render: (r) => <span className="name">{r.name}</span> },
    { label: 'Nhóm món', key: 'group' },
    { label: 'Loại công thức', render: (r) => recipeTypeLabel(r.type) },
    { label: 'Số lượng nguyên vật liệu', render: (r) => `${r.items.length} nguyên vật liệu` },
    {
      label: 'Thao tác',
      render: (r) => (
        <RowActions
          viewTooltip="Xem công thức"
          onView={() => setModal({ k: 'view', r })}
          onEdit={() => openEdit(r)}
          onDelete={() => setModal({ k: 'del', r })}
        />
      ),
    },
  ]

  return (
    <>
      <div className="page-head recipes-page-head">
        <h2>Quản lý công thức món</h2>
        <button className="btn" onClick={openAdd}>
          <Plus size={18} /> Thêm công thức món
        </button>
      </div>

      {s.materialsLoading && <div className="banner">Đang tải danh mục nguyên vật liệu từ SQL Server...</div>}
      {s.materialsError && <div className="banner error">Không thể tải danh mục nguyên vật liệu: {s.materialsError}</div>}
      {s.recipesLoading && <div className="banner">Đang tải công thức từ SQL Server...</div>}
      {s.recipesError && <div className="banner error">Không thể tải công thức từ SQL Server: {s.recipesError}</div>}
      <div className="card recipes-card">
        <DataTable columns={cols} rows={recipeRows} />
      </div>

      {modal?.k === 'view' && (
        <Modal
          title="Chi tiết công thức món"
          subtitle={<><LockKeyhole size={12} /> Chỉ xem – không thể chỉnh sửa thông tin tại màn hình này</>}
          size="recipe-detail-modal"
          onClose={() => setModal(null)}
          footer={<button className="btn primary" onClick={() => setModal(null)}>Đóng</button>}
        >
          <div className="recipe-detail-content">
            <h4>Thông tin chung</h4>
            <div className="recipe-detail-grid">
              <Field label="Mã món"><input className="input" readOnly value={modal.r.id} /></Field>
              <Field label="Tên món" full><input className="input" readOnly value={modal.r.name} /></Field>
              <Field label="Nhóm món"><input className="input" readOnly value={modal.r.group} /></Field>
              <Field label="Loại công thức"><input className="input" readOnly value={recipeTypeLabel(modal.r.type)} /></Field>
              <Field label="Đơn vị tính"><input className="input" readOnly value={modal.r.unit || 'ly'} /></Field>
            </div>

            <h4>Nguyên vật liệu thành phần</h4>
            <table className="tbl recipe-detail-table">
              <thead>
                <tr>
                  <th>Tên nguyên vật liệu</th>
                  <th>Định lượng</th>
                  <th>Đơn vị định lượng</th>
                  <th>Ghi chú pha chế</th>
                </tr>
              </thead>
              <tbody>
                {modal.r.items.map((i, idx) => (
                  <tr key={`${i.materialId}-${idx}`}>
                    <td className="name">{mat(i.materialId)?.name || 'Nguyên vật liệu đã xóa'}</td>
                    <td>{fmtNum(i.qty)}</td>
                    <td>{i.unit}</td>
                    <td>{i.note || (idx === 0 ? modal.r.note : '') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {modal?.k === 'edit' && (
        <Modal
          size="recipe-edit-modal"
          header={<div className="recipe-edit-header"><div><h3>Chỉnh sửa công thức món</h3><p>{modal.r.id} · {modal.r.name}</p></div><span>Trường có dấu <b>*</b> là bắt buộc</span></div>}
          onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Hủy bỏ</button><button className="btn primary" onClick={save}>Lưu</button></>}
        >
          {err && f.items.length > 0 && <div className="banner error">{err}</div>}

          <h4 className="recipe-section-title">Thông tin chung</h4>
          <div className="recipe-edit-info-grid">
            <Field label="Mã món"><div className="readonly-with-lock"><input className="input" readOnly value={modal.r.id} /><LockKeyhole size={12} /></div></Field>
            <Field label="Tên món" full><div className="readonly-with-lock"><input className="input" readOnly value={f.name} /><LockKeyhole size={12} /></div></Field>
            <Field label="Nhóm món"><div className="readonly-with-lock"><input className="input" readOnly value={f.group} /><LockKeyhole size={12} /></div></Field>
            <Field label="Loại công thức"><div className="readonly-with-lock"><input className="input" readOnly value={recipeTypeLabel(f.type)} /><LockKeyhole size={12} /></div></Field>
            <Field label="Đơn vị tính"><div className="readonly-with-lock"><input className="input" readOnly value={f.unit} /><LockKeyhole size={12} /></div></Field>
          </div>

          <h4 className="recipe-section-title recipe-ingredients-heading">Nguyên vật liệu thành phần</h4>
          <div className="recipe-edit-table">
            <div className="recipe-edit-table-head"><span>Nguyên vật liệu <b>*</b></span><span>Định lượng <b>*</b></span><span>Đơn vị định lượng</span><span>Ghi chú pha chế</span><span /></div>

            {f.items.map((it, i) => {
              const used = f.items.filter((_, index) => index !== i).map((item) => item.materialId)
              const material = mat(it.materialId)
              const missingMaterial = !it.materialId
              const invalidQty = !Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0

              return (
                <div className="recipe-edit-row-wrap" key={i}>
                  <div className="recipe-edit-row">
                    <Select
                      disabled={s.materialsLoading || !!s.materialsError || s.materials.length === 0}
                      className={showItemErrors && missingMaterial ? 'err' : ''}
                      value={it.materialId}
                      onChange={(value) => setItem(i, 'materialId', value)}
                      placeholder="Chọn nguyên vật liệu"
                      hidePlaceholderOption
                      options={materialSelectOptions(s.materials, used)}
                    />
                    <input
                      className={`input ${showItemErrors && invalidQty ? 'err' : ''}`}
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Nhập số"
                      value={it.qty}
                      onChange={(e) => setItem(i, 'qty', e.target.value)}
                    />
                    <div className="readonly-with-lock"><input className="input" readOnly value={material ? material.subUnit || material.unit : '—'} /><LockKeyhole size={12} /></div>
                    <input className="input" placeholder="Ghi chú (nếu có)" value={it.note || ''} onChange={(e) => setItem(i, 'note', e.target.value)} />
                    <button type="button" className="recipe-row-delete custom-tooltip" data-tooltip="Xóa dòng" aria-label="Xóa dòng" onClick={() => setF((x) => ({ ...x, items: x.items.filter((_, idx) => idx !== i) }))}><Trash2 size={15} /></button>
                  </div>

                  {showItemErrors && (missingMaterial || invalidQty) && (
                    <div className="recipe-item-error">
                      <CircleAlert size={12} />
                      {missingMaterial && invalidQty
                        ? 'Vui lòng chọn nguyên vật liệu và nhập định lượng nguyên vật liệu phải lớn hơn 0!'
                        : missingMaterial
                          ? 'Vui lòng chọn nguyên vật liệu!'
                          : 'Định lượng nguyên vật liệu phải lớn hơn 0!'}
                    </div>
                  )}
                </div>
              )
            })}

            {!f.items.length && (
              <div className="recipe-empty-ingredients">
                <span><BookOpen size={22} /></span>
                <b>Chưa có nguyên vật liệu thành phần</b>
                <small>Nhấn “Thêm nguyên vật liệu” để thiết lập công thức.</small>
              </div>
            )}
          </div>

          {!f.items.length && <div className="banner error recipe-empty-error"><CircleAlert size={14} />Công thức món phải có ít nhất một nguyên vật liệu thành phần!</div>}
          <button type="button" className="btn sm recipe-add-row" disabled={s.materialsLoading || !!s.materialsError || s.materials.length === 0} onClick={() => setF((x) => ({ ...x, items: [...x.items, blank()] }))}><Plus size={14} /> Thêm nguyên vật liệu</button>
        </Modal>
      )}

      {modal?.k === 'add' && (
        <Modal
          size="recipe-add-modal"
          header={<div className="recipe-edit-header"><div><h3>Thêm công thức món</h3><p>Thiết lập định lượng nguyên vật liệu theo món mới</p></div><span>Trường có dấu <b>*</b> là bắt buộc</span></div>}
          onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Hủy</button><button className="btn primary" onClick={save}>Lưu</button></>}
        >
          {err && <div className="banner error">{err}</div>}

          <h4 className="recipe-section-title">Thông tin chung</h4>
          <div className="recipe-edit-info-grid recipe-add-info-grid">
            <Field label="Mã món"><div className="readonly-with-lock"><input className="input" readOnly value="Hệ thống tự sinh" /><LockKeyhole size={12} /></div></Field>
            <Field label="Tên món" required full>
              <div className="recipe-name-input-wrap">
                <input className="input" maxLength={100} value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
                <span>{f.name.length}/100</span>
              </div>
            </Field>
            <Field label="Nhóm món" required><Select value={f.group} onChange={(value) => setF((x) => ({ ...x, group: value }))} options={RECIPE_GROUPS} placeholder="Chọn nhóm món" /></Field>
            <Field label="Loại công thức" required><Select value={f.type} onChange={(value) => setF((x) => ({ ...x, type: value }))} options={RECIPE_TYPES} placeholder="Chọn loại công thức" /></Field>
            <Field label="Đơn vị tính" required><Select value={f.unit} onChange={(value) => setF((x) => ({ ...x, unit: value }))} options={RECIPE_UNITS} placeholder="Chọn đơn vị tính" /></Field>
          </div>

          <h4 className="recipe-section-title recipe-ingredients-heading">Nguyên vật liệu thành phần</h4>
          <div className="recipe-edit-table">
            <div className="recipe-edit-table-head"><span>Nguyên vật liệu <b>*</b></span><span>Định lượng <b>*</b></span><span>Đơn vị định lượng</span><span>Ghi chú pha chế</span><span /></div>

            {f.items.map((it, i) => {
              const used = f.items.filter((_, index) => index !== i).map((item) => item.materialId)
              const material = mat(it.materialId)
              const missingMaterial = !it.materialId
              const invalidQty = !Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0

              return (
                <div className="recipe-edit-row-wrap" key={i}>
                  <div className="recipe-edit-row">
                    <Select
                      disabled={s.materialsLoading || !!s.materialsError || s.materials.length === 0}
                      className={showItemErrors && missingMaterial ? 'err' : ''}
                      value={it.materialId}
                      onChange={(value) => setItem(i, 'materialId', value)}
                      placeholder="Chọn nguyên vật liệu"
                      hidePlaceholderOption
                      options={materialSelectOptions(s.materials, used)}
                    />
                    <input
                      className={`input ${showItemErrors && invalidQty ? 'err' : ''}`}
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Nhập số"
                      value={it.qty}
                      onChange={(e) => setItem(i, 'qty', e.target.value)}
                    />
                    <div className="readonly-with-lock"><input className="input" readOnly value={material ? material.subUnit || material.unit : '—'} /><LockKeyhole size={12} /></div>
                    <input className="input" placeholder="Ghi chú (nếu có)" value={it.note || ''} onChange={(e) => setItem(i, 'note', e.target.value)} />
                    <button type="button" className="recipe-row-delete custom-tooltip" data-tooltip="Xóa dòng" aria-label="Xóa dòng" onClick={() => setF((x) => ({ ...x, items: x.items.filter((_, idx) => idx !== i) }))}><Trash2 size={15} /></button>
                  </div>

                  {showItemErrors && (missingMaterial || invalidQty) && (
                    <div className="recipe-item-error">
                      <CircleAlert size={12} />
                      {missingMaterial && invalidQty
                        ? 'Vui lòng chọn nguyên vật liệu và nhập định lượng nguyên vật liệu phải lớn hơn 0!'
                        : missingMaterial
                          ? 'Vui lòng chọn nguyên vật liệu!'
                          : 'Định lượng nguyên vật liệu phải lớn hơn 0!'}
                    </div>
                  )}
                </div>
              )
            })}

            {!f.items.length && (
              <div className="recipe-empty-ingredients">
                <span><BookOpen size={22} /></span>
                <b>Chưa có nguyên vật liệu thành phần</b>
                <small>Nhấn “Thêm nguyên vật liệu” để thiết lập công thức.</small>
              </div>
            )}
          </div>

          {!f.items.length && showItemErrors && <div className="banner error recipe-empty-error"><CircleAlert size={14} />Công thức món phải có ít nhất một nguyên vật liệu thành phần!</div>}
          <button type="button" className="btn sm recipe-add-row" onClick={() => setF((x) => ({ ...x, items: [...x.items, blank()] }))}><Plus size={14} /> Thêm nguyên vật liệu</button>
        </Modal>
      )}

      {modal?.k === 'del' && (
        <Modal
          size="recipe-delete-confirm"
          header={<div className="recipe-delete-icon"><Trash2 size={22} /></div>}
          onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Hủy bỏ</button><button className="btn primary" onClick={async () => { const result = await s.deleteRecipe(modal.r.id); if (!result.success) return notify(result.message || 'Không thể xóa công thức!'); setModal(null); notify(result.message || 'Xóa công thức thành công!') }}>Xác nhận</button></>}
        >
          <p className="recipe-delete-message">Bạn có chắc chắn muốn xóa công thức món {modal.r.name} không?</p>
        </Modal>
      )}

      {toast}
    </>
  )
}
