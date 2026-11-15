import { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'
import { DataTable, RowActions, SearchBox, Select, Modal, Field, fmtNum, fmtDateTime } from '../components/ui.jsx'
import { stockStatus } from '../components/helpers.js'

export default function StockCheck() {
  const { materials, transactions, materialGroups, materialsLoading, materialsError, inventoryHistoryAvailable, inventoryHistoryError } = useStore()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [stat, setStat] = useState('')
  const [view, setView] = useState(null)
  const rows = useMemo(() => materials.filter((m) =>
    (!q || (m.id + m.name).toLowerCase().includes(q.toLowerCase())) && (!group || m.group === group) && (!stat || stockStatus(m) === stat)
  ).slice().sort((a, b) => compareCodes(a.id, b.id)), [materials, q, group, stat])

  const cols = [
    { label: 'Mã NVL', render: (m) => <span className="code">{m.id}</span> },
    { label: 'Tên nguyên vật liệu', render: (m) => <span className="name">{m.name}</span> },
    { label: 'Nhóm', key: 'group' },
    { label: 'Đơn vị tính', key: 'unit' },
    { label: 'Tồn kho hiện tại', render: (m) => fmtNum(m.stock) },
    { label: 'Mức tồn tối thiểu', render: (m) => fmtNum(m.min) },
    { label: 'Trạng thái', render: (m) => { const t = stockStatus(m); return <span className={['Sắp hết', 'Hết hàng'].includes(t) ? 'stock-status-danger' : ''}>{t}</span> } },
    { label: 'Chi tiết', render: (m) => <RowActions onView={() => setView(m)} /> },
  ]
  return (
    <>
      <div className="page-head"><h2>Kiểm tra tồn kho</h2></div>
      <div className="card stock-check-card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm theo mã hoặc tên nguyên vật liệu" showClearAlways />
          <Select value={group} onChange={setGroup} options={materialGroups} placeholder="Tất cả nhóm" />
          <Select value={stat} onChange={setStat} options={['Còn hàng', 'Sắp hết', 'Hết hàng']} placeholder="Tất cả trạng thái" />
          <button className="btn" onClick={() => { setQ(''); setGroup(''); setStat('') }}>Xóa bộ lọc</button>
        </div>
        {materialsLoading && <div className="banner">Đang tải danh mục nguyên vật liệu từ SQL Server...</div>}
        {materialsError && <div className="banner error">Không thể tải danh mục nguyên vật liệu: {materialsError}</div>}
        {rows.length ? <DataTable columns={cols} rows={rows} /> : <>
          <table className="tbl"><thead><tr>{cols.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead></table>
          <div className="stock-empty-space"><div className="stock-empty-state"><span><svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2.2" /><path d="M15.5 15.5 24 24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg></span><b>Không tìm thấy nguyên vật liệu phù hợp!</b></div></div>
        </>}
      </div>
      {view && (
        <Modal title="Chi tiết nguyên vật liệu" size="material-detail-modal" onClose={() => setView(null)} footer={<button className="btn primary" onClick={() => setView(null)}>Đóng</button>}>
          <div className="material-detail-name">{view.name}</div>
          <div className="grid2 material-detail-grid">
            {[
              ['Mã nguyên vật liệu', view.id], ['Trạng thái', stockStatus(view)],
              ['Tồn kho hiện tại', `${fmtNum(view.stock)} ${view.unit}`], ['Mức tồn tối thiểu', `${fmtNum(view.min)} ${view.unit}`],
              ['Nhóm nguyên vật liệu', view.group], ['Đơn vị tính', view.unit],
            ].map(([label, value]) => <Field key={label} label={label}><input className="input" readOnly value={value} /></Field>)}
          </div>
          <h4 className="recent-transaction-title">Giao dịch thay đổi tồn kho gần nhất</h4>
          {!inventoryHistoryAvailable ? <div className="banner error">{inventoryHistoryError}</div> : <table className="tbl recent-transactions">
            <thead><tr><th>Thời gian</th><th>Loại giao dịch</th><th className="num">Số lượng</th></tr></thead>
            <tbody>
              {transactions.filter((t) => t.materialId === view.id && !t.deleted).slice().sort((a, b) => compareCodes(a.id, b.id)).slice(-4).map((t) => (
                <tr key={t.id}>
                  <td>{fmtDateTime(t.time)}</td>
                  <td>{t.reversalOf ? (t.source === 'Khôi phục' ? 'Khôi phục' : 'Điều chỉnh') : t.type}</td>
                  <td className="num"><span className={t.delta >= 0 ? 'green' : 'red'}>{t.delta >= 0 ? '+' : ''}{fmtNum(t.delta)} {view.unit}</span></td>
                </tr>
              ))}
              {!transactions.some((t) => t.materialId === view.id && !t.deleted) && <tr><td className="empty" colSpan={3}>Chưa có giao dịch tồn kho</td></tr>}
            </tbody>
          </table>}
        </Modal>
      )}
    </>
  )
}
