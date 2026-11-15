import { useMemo, useState } from 'react'
import { ArrowLeft, Info } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'
import { DataTable, fmtDateTime, fmtNum, SearchBox, Select, useToast } from '../components/ui.jsx'
import { restoreInventoryHistory } from '../service/inventoryHistoryApi.js'
import { formatHistoryCode } from '../utils/historyCode.js'

export default function Trash() {
  const s = useStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [deletedBy, setDeletedBy] = useState('')
  const [deletedDate, setDeletedDate] = useState('')
  const [toast, notify] = useToast()
  const material = (id) => s.materials.find((m) => m.id === id)
  const rows = useMemo(() => s.trash.filter((t) => {
    if (!s.inventoryHistoryAvailable) return false
    const name = material(t.materialId)?.name || ''
    return (!query || `${formatHistoryCode(t.id)} ${t.id} ${name}`.toLowerCase().includes(query.toLowerCase())) &&
      (!deletedBy || (t.deletedBy || '') === deletedBy) &&
      (!deletedDate || (t.deletedAt || t.time || '').startsWith(deletedDate))
  }).slice().sort((a, b) => compareCodes(a.id, b.id)), [s.trash, s.materials, s.inventoryHistoryAvailable, query, deletedBy, deletedDate])

  const restore = async (t) => {
    try {
      const result = await restoreInventoryHistory(t.id)
      await s.refreshInventoryHistory()
      const restoredId = result.data?.maLichSuKhoiPhuc
      if (restoredId) sessionStorage.setItem('stock-history-highlight', JSON.stringify({ id: restoredId, type: 'success' }))
      navigate('/ton-kho/lich-su')
      notify('Khôi phục giao dịch thành công!')
    } catch (error) {
      notify({ type: 'error', message: error.message || 'Không thể khôi phục giao dịch.' })
    }
  }

  const columns = [
    { label: 'Mã giao dịch', render: (t) => <span className="code deleted-code">{formatHistoryCode(t.id)}</span> },
    { label: 'Thời gian', render: (t) => fmtDateTime(t.time) },
    { label: 'Tên nguyên vật liệu', render: (t) => <span className="name">{material(t.materialId)?.name || 'Nguyên vật liệu đã xóa'}</span> },
    { label: 'Loại giao dịch', key: 'type' },
    { label: 'Số lượng thay đổi', render: (t) => <span className={t.delta >= 0 ? 'green' : 'red'}>{t.delta >= 0 ? '+' : ''}{fmtNum(t.delta)} {material(t.materialId)?.unit}</span> },
    { label: 'Người xóa', render: (t) => t.deletedBy || 'Trần Bảo Khuê' },
    { label: 'Thời điểm xóa', render: (t) => fmtDateTime(t.deletedAt || t.time) },
    { label: 'Bản ghi đảo ngược', render: (t) => { const inverse = s.transactions.find((x) => String(x.reversalOf) === String(t.id)); return <span className="code">{inverse ? formatHistoryCode(inverse.id) : '—'}</span> } },
    { label: 'Trạng thái', render: (t) => <button className="trash-status" title="Nhấn để khôi phục giao dịch" onClick={() => restore(t)}>Đã xóa</button> },
  ]

  return <>
    <div className="page-head">
      <h2>Thùng rác</h2>
      <button className="btn" onClick={() => navigate('/ton-kho/lich-su')}><ArrowLeft size={16} /> Quay lại lịch sử</button>
    </div>
    <div className="card trash-card">
      <div className="trash-info"><Info size={16} /><span>Các giao dịch đã xóa được lưu trữ vĩnh viễn để đảm bảo tính minh bạch dữ liệu. Mỗi giao dịch gốc gắn với một bản ghi đảo ngược.</span></div>
      {s.materialsLoading && <div className="banner">Đang tải danh mục nguyên vật liệu từ SQL Server...</div>}
      {s.materialsError && <div className="banner error">Không thể tải danh mục nguyên vật liệu: {s.materialsError}</div>}
      {!s.inventoryHistoryAvailable && <div className="banner error">{s.inventoryHistoryError}</div>}
      <div className="toolbar trash-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Tìm theo mã giao dịch hoặc tên NVL" />
        <Select value={deletedBy} onChange={setDeletedBy} options={[...new Set(s.trash.map((t) => t.deletedBy).filter(Boolean))]} placeholder="Người xóa" />
        <label className="trash-date"><span>Thời điểm xóa</span><input className="input" type="date" value={deletedDate} onChange={(e) => setDeletedDate(e.target.value)} /></label>
      </div>
      <DataTable columns={columns} rows={rows} emptyText="Thùng rác hiện chưa có giao dịch nào." />
    </div>
    {toast}
  </>
}
