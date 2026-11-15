import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LockKeyhole, Trash2 } from 'lucide-react'
import { useStore } from '../store.jsx'
import { trashInventoryHistory } from '../service/inventoryHistoryApi.js'
import { formatHistoryCode } from '../utils/historyCode.js'
import { DataTable, RowActions, SearchBox, Select, Modal, Field, fmtNum, fmtDateTime, useToast } from '../components/ui.jsx'

const compareHistoryIds = (a, b) => {
  try {
    const left = BigInt(a.id)
    const right = BigInt(b.id)
    return left < right ? -1 : left > right ? 1 : 0
  } catch {
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  }
}

export default function StockHistory() {
  const s = useStore()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [date, setDate] = useState('')
  const [modal, setModal] = useState(null)
  const [highlight, setHighlight] = useState(null)
  const [toast, notify] = useToast()
  const mat = (id) => s.materials.find((m) => m.id === id)
  const types = useMemo(() => [...new Set(s.inventoryHistory.map((t) => t.type).filter(Boolean))], [s.inventoryHistory])
  useEffect(() => {
    const stored = sessionStorage.getItem('stock-history-highlight')
    if (!stored) return
    try { setHighlight(JSON.parse(stored)) } catch { setHighlight(null) }
    sessionStorage.removeItem('stock-history-highlight')
  }, [])
  const detailValues = (t) => {
    const material = mat(t.materialId)
    return {
      material,
      unit: t.materialUnit || material?.unit || '',
      before: Number(t.stockBefore),
      after: Number(t.stockAfter),
      reference: t.reference || '—',
      note: t.note || ''
    }
  }

  const rows = useMemo(() => s.inventoryHistory.filter((t) => {
    if (!t.time) return false
    const searchable = `${formatHistoryCode(t.id)} ${t.id} ${t.materialId} ${t.materialName}`.toLowerCase()
    return (!q || searchable.includes(q.toLowerCase())) && (!type || t.type === type) && (!date || String(t.time).startsWith(date))
  }).slice().sort(compareHistoryIds), [s.inventoryHistory, q, type, date])

  const cols = [
    { label: 'Mã giao dịch', render: (t) => <span className="code">{formatHistoryCode(t.id)}</span> },
    { label: 'Thời gian', render: (t) => fmtDateTime(t.time) },
    { label: 'Tên nguyên vật liệu', render: (t) => <span className="name">{t.materialName || 'Không xác định'}</span> },
    { label: 'Loại giao dịch', render: (t) => t.type },
    { label: 'Số lượng thay đổi', render: (t) => <span className={t.delta >= 0 ? 'green' : 'red'}>{t.delta >= 0 ? '+' : ''}{fmtNum(t.delta)}</span> },
    { label: 'Đơn vị tính', render: (t) => t.materialUnit },
    { label: 'Thao tác', render: (t) => <RowActions onView={() => setModal({ t, kind: 'view' })} onDelete={() => {
      if (t.originalHistoryId) {
        setHighlight({ id: t.id, type: 'error' })
        return notify({ type: 'error', message: 'Không thể xóa bản ghi đảo ngược!' })
      }
      setModal({ t, kind: 'del' })
    }} /> },
  ]
  return (
    <>
      <div className="page-head"><h2>Lịch sử thay đổi tồn kho</h2></div>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm theo mã giao dịch hoặc tên nguyên vật liệu" showClearAlways className="history-search" />
          <Select value={type} onChange={setType} options={types} placeholder="Tất cả loại giao dịch" />
          <input className="input" type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => navigate('/ton-kho/thung-rac')}><Trash2 size={16} /> Thùng rác</button>
        </div>
        {s.inventoryHistoryLoading && <div className="banner">Đang tải lịch sử tồn kho từ SQL Server...</div>}
        {s.inventoryHistoryLoadError && <div className="banner error">Không thể tải lịch sử tồn kho: {s.inventoryHistoryLoadError}</div>}
        <DataTable columns={cols} rows={rows} emptyText={s.inventoryHistoryLoading ? 'Đang tải dữ liệu...' : s.inventoryHistoryLoadError ? 'Không có dữ liệu từ máy chủ' : s.inventoryHistory.length === 0 ? 'Chưa có lần biến động tồn kho nào' : 'Không tìm thấy giao dịch phù hợp'} rowClassName={(t) => t.id === String(highlight?.id) ? `row-${highlight.type}` : undefined} />
      </div>
      {modal?.kind === 'view' && (
        <Modal className="history-detail-modal" title="Chi tiết lịch sử thay đổi tồn kho" subtitle={<><LockKeyhole size={11} /> Chỉ xem – không thể chỉnh sửa thông tin tại màn hình này</>} onClose={() => setModal(null)} footer={<button className="btn primary" onClick={() => setModal(null)}>Đóng</button>}>
          {(() => {
            const d = detailValues(modal.t)
            const fields = [
              ['Mã giao dịch', formatHistoryCode(modal.t.id)], ['Thời gian', fmtDateTime(modal.t.time)],
              ['Tên nguyên vật liệu', modal.t.materialName || 'Không xác định'], ['Loại giao dịch', modal.t.type],
              ['Số lượng thay đổi', `${modal.t.delta >= 0 ? '+' : ''}${fmtNum(modal.t.delta)}`], ['Đơn vị tính', d.unit || '—'],
              ['Tồn kho trước giao dịch', `${fmtNum(d.before)} ${d.unit}`], ['Tồn kho sau giao dịch', `${fmtNum(d.after)} ${d.unit}`],
            ]
            return <>
              <div className="grid2 detail-grid history-detail-grid">
                {fields.map(([label, value]) => <Field key={label} label={label}><input className="input" readOnly value={value} /></Field>)}
                <Field label="Mã tham chiếu" full><input className="input" readOnly value={d.reference} /></Field>
                <Field label="Ghi chú" full><textarea className="textarea detail-note" readOnly value={d.note} /></Field>
              </div>
            </>
          })()}
        </Modal>
      )}
      {modal?.kind === 'del' && (
        <Modal className="history-delete-modal" onClose={() => setModal(null)}
          header={<div className="history-delete-heading"><span className="history-delete-icon"><Trash2 size={17} /></span></div>}
          footer={<><button className="btn" onClick={() => setModal(null)}>Hủy bỏ</button><button className="btn primary" onClick={async () => {
            if (modal.t.reversalOf || modal.t.originalHistoryId) {
              setModal(null)
              setHighlight({ id: modal.t.id, type: 'error' })
              return notify({ type: 'error', message: 'Không thể xóa bản ghi đảo ngược.' })
            }
            try {
              const result = await trashInventoryHistory(modal.t.id)
              await s.refreshInventoryHistory()
              setModal(null)
              setQ(''); setType(''); setDate('')
              const inverseId = result.data?.maLichSuDaoTon
              if (inverseId) setHighlight({ id: inverseId, type: 'success' })
              notify('Đã chuyển giao dịch vào thùng rác.')
            } catch (error) {
              notify({ type: 'error', message: error.message || 'Không thể chuyển giao dịch vào thùng rác.' })
            }
          }}>Xác nhận</button></>}
        >
          <p className="history-delete-question">Bạn có chắc chắn muốn xóa giao dịch {formatHistoryCode(modal.t.id)} không?</p>
        </Modal>
      )}
      {modal?.kind === 'negative' && (() => {
        const material = mat(modal.t.materialId)
        const current = Number(material?.stock || 0)
        const reversal = -Number(modal.t.delta || 0)
        const after = current + reversal
        const quantity = (value) => Number(value).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 3 })
        return <Modal
          size="sm"
          header={<h3 className="negative-stock-title">Không thể xóa! Việc xóa giao dịch này làm tồn kho hiện tại bị âm.</h3>}
          onClose={() => setModal(null)}
          footer={<button className="btn primary" onClick={() => setModal(null)}>Đóng</button>}
        >
          <div className="negative-stock-cards">
            <div className="negative-stock-card"><span>Tồn kho hiện tại</span><b>{quantity(current)} {material?.unit}</b></div>
            <div className="negative-stock-card"><span>Giá trị đảo ngược</span><b className="red">{quantity(reversal)} {material?.unit}</b></div>
            <div className="negative-stock-card"><span>Tồn kho sau giao dịch</span><b className="red">{quantity(after)} {material?.unit}</b></div>
          </div>
        </Modal>
      })()}
      {toast}
    </>
  )
}
