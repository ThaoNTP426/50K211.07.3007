import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FileText } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { apiFetch, API_URL } from '../service/apiClient.js'
import { fmtDate, fmtDateTime, fmtNum } from '../components/ui.jsx'

const dateValue = (value) => {
  if (!value) return '—'
  const date = String(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? fmtDate(date) : date
}

export default function LossSlipDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const store = useStore()
  const [slip, setSlip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    apiFetch(`${API_URL}/losses/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok || !result?.success || !result?.data) throw new Error(result?.message || 'Không thể tải chi tiết phiếu hao hụt.')
        if (active) setSlip(result.data)
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'Không thể tải chi tiết phiếu hao hụt.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  const inventoryRows = useMemo(() => store.inventoryHistory
    .filter((entry) => String(entry.reference || '').trim() === String(id).trim())
    .slice()
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()), [store.inventoryHistory, id])

  const auditRows = useMemo(() => (slip?.lichSuChinhSua || []).map((entry) => {
    const quantityMatch = String(entry.truongDuocSua || '').match(/^Số lượng NVL\s+(.+)$/)
    const materialId = quantityMatch?.[1]?.trim()
    const material = materialId ? store.materials.find((item) => item.id === materialId) : null
    const label = material ? `Số lượng – ${material.name}` : (entry.truongDuocSua || 'Thông tin phiếu')
    const oldValue = material ? `${fmtNum(Number(entry.giaTriCu))} ${material.unit}` : dateValue(entry.giaTriCu)
    const newValue = material ? `${fmtNum(Number(entry.giaTriMoi))} ${material.unit}` : dateValue(entry.giaTriMoi)
    return { ...entry, label, oldValue, newValue }
  }), [slip, store.materials])

  if (loading) return <div className="loss-detail-state">Đang tải chi tiết phiếu hao hụt...</div>
  if (error || !slip) return <div className="loss-detail-state"><div className="banner error">{error || 'Không tìm thấy phiếu hao hụt.'}</div><button className="btn" onClick={() => navigate('/hao-hut')}><ArrowLeft size={15} /> Quay lại</button></div>

  return <div className="loss-detail-page">
    <div className="loss-detail-heading">
      <button className="btn loss-back-btn" onClick={() => navigate('/hao-hut')}><ArrowLeft size={15} /> Quay lại</button>
      <h2>Chi tiết phiếu hao hụt</h2>
    </div>

    <section className="card loss-detail-card">
      <h3>Thông tin chung</h3>
      <div className="loss-general-grid">
        <div><label>Mã phiếu</label><strong className="code">{slip.maPhieuHaoHut}</strong></div>
        <div><label>Ngày lập</label><span>{dateValue(slip.ngayLap)}</span></div>
        <div><label>Ngày hao hụt</label><span>{dateValue(slip.ngayHaoHut)}</span></div>
        <div><label>Lý do hao hụt</label><span>{slip.lyDo || '—'}</span></div>
        <div><label>Trạng thái phiếu</label><span className={`pill ${slip.trangThai === 'Đã hủy' ? 'red' : 'green'}`}>{slip.trangThai || '—'}</span></div>
        <div><label>Ghi chú</label><span>{slip.ghiChu || '—'}</span></div>
      </div>
    </section>

    <section className="card loss-detail-card loss-detail-table-card">
      <h3>Danh sách nguyên vật liệu hao hụt</h3>
      <div className="loss-detail-table-wrap"><table className="tbl loss-detail-table">
        <thead><tr><th>STT</th><th>Tên nguyên vật liệu</th><th>Đơn vị tính</th><th>Số lượng hao hụt</th></tr></thead>
        <tbody>{(slip.chiTiet || []).map((item, index) => <tr key={`${item.maNVL}-${index}`}><td>{index + 1}</td><td>{item.tenNVL || item.maNVL}</td><td>{item.donViTinh || '—'}</td><td><b>{fmtNum(item.soLuong)}</b></td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="card loss-detail-card loss-detail-table-card">
      <h3>Lịch sử chỉnh sửa phiếu</h3>
      {auditRows.length ? <div className="loss-detail-table-wrap"><table className="tbl loss-detail-table">
        <thead><tr><th>Thời điểm sửa</th><th>Người sửa</th><th>Nội dung thay đổi</th><th>Giá trị cũ</th><th>Giá trị mới</th></tr></thead>
        <tbody>{auditRows.map((entry, index) => <tr key={`${entry.thoiGianSua}-${index}`}><td>{fmtDateTime(entry.thoiGianSua)}</td><td>{entry.nguoiSua || '—'}</td><td>{entry.label}</td><td>{entry.oldValue}</td><td className="loss-detail-new-value">{entry.newValue}</td></tr>)}</tbody>
      </table></div> : <div className="loss-detail-empty"><FileText size={15} /> Phiếu hao hụt chưa có lịch sử chỉnh sửa</div>}
    </section>

    <section className="card loss-detail-card loss-detail-table-card">
      <h3>Lịch sử thay đổi tồn kho liên quan</h3>
      {inventoryRows.length ? <div className="loss-detail-table-wrap"><table className="tbl loss-detail-table">
        <thead><tr><th>Thời gian</th><th>Tên nguyên vật liệu</th><th>Số lượng thay đổi</th><th>Tồn trước</th><th>Tồn sau</th><th>Nguồn tác động</th></tr></thead>
        <tbody>{inventoryRows.map((entry) => {
          const edited = /cập nhật phiếu hao hụt/i.test(entry.note || '')
          return <tr key={entry.id}><td>{fmtDateTime(entry.time)}</td><td>{entry.materialName || entry.materialId}</td><td className={entry.delta < 0 ? 'red' : 'green'}>{entry.delta > 0 ? '+' : ''}{fmtNum(entry.delta)} {entry.materialUnit}</td><td>{fmtNum(entry.stockBefore)} {entry.materialUnit}</td><td><b>{fmtNum(entry.stockAfter)} {entry.materialUnit}</b></td><td>{edited ? 'Sửa phiếu hao hụt' : 'Tạo phiếu hao hụt'}</td></tr>
        })}</tbody>
      </table></div> : <div className="loss-detail-empty"><FileText size={15} /> Phiếu hao hụt chưa có lịch sử thay đổi tồn kho</div>}
    </section>
  </div>
}
