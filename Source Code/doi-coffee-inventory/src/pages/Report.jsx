import { useMemo, useState } from 'react'
import { Download, BarChart3, ChevronDown } from 'lucide-react'
import { useStore } from '../store.jsx'
import { compareCodes } from '../utils/codeSort.js'
import { DataTable, fmtNum, fmtMoney, todayISO, useToast } from '../components/ui.jsx'

const toDate = (d) => new Date(`${d}T00:00:00`)
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const capEnd = (end, today) => end > today ? today : end
const monthRange = (value, today) => { const [y, m] = value.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return [`${value}-01`, capEnd(`${value}-${String(last).padStart(2, '0')}`, today)] }
const yearRange = (value, today) => [`${value}-01-01`, capEnd(`${value}-12-31`, today)]
const weekRange = (value, today) => { const d = toDate(value); const weekday = (d.getDay() + 6) % 7; d.setDate(d.getDate() - weekday); const start = localISO(d); d.setDate(d.getDate() + 6); return [start, capEnd(localISO(d), today)] }
const fmtRangeDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

export default function Report() {
  const s = useStore()
  const today = todayISO()
  const [kind, setKind] = useState('Tháng')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [year, setYear] = useState(today.slice(0, 4))
  const [day, setDay] = useState(today)
  const [shown, setShown] = useState(null)
  const [menu, setMenu] = useState(false)
  const [toast, notify] = useToast()

  const view = () => {
    if (!s.inventoryHistoryAvailable) {
      return notify({ type: 'error', message: s.inventoryHistoryError })
    }
    let range
    if (kind === 'Tháng') range = month ? monthRange(month, today) : null
    else if (kind === 'Năm') range = /^\d{4}$/.test(year) ? yearRange(year, today) : null
    else if (day) range = kind === 'Tuần' ? weekRange(day, today) : [day, day]
    if (!range) return notify({ type: 'error', message: 'Vui lòng chọn kỳ báo cáo hợp lệ.' })
    if (range[0] > today || range[1] < range[0]) return notify({ type: 'error', message: 'Kỳ báo cáo không hợp lệ hoặc nằm sau ngày hiện tại.' })
    const label = kind === 'Tháng' ? `tháng ${month.slice(5)}/${month.slice(0, 4)}` : kind === 'Năm' ? `năm ${year}` : kind === 'Tuần' ? `tuần ${fmtRangeDate(range[0])} – ${fmtRangeDate(range[1])}` : `ngày ${fmtRangeDate(day)}`
    setShown({ label, start: range[0], end: range[1], range: range[0] === range[1] ? fmtRangeDate(range[0]) : `${fmtRangeDate(range[0])} – ${fmtRangeDate(range[1])}` })
  }

  const rows = useMemo(() => {
    if (!shown) return []
    const activeTx = s.transactions.filter((t) => !t.deleted && t.time && t.time.slice(0, 10) <= today)
    const inRange = (d) => d >= shown.start && d <= shown.end
    const later = (d) => d > shown.end
    const activeReceipts = s.receipts.filter((r) => !r.deleted && inRange(r.date))
    const receiptQty = new Map()
    const costs = new Map()
    activeReceipts.forEach((r) => (r.items || []).forEach((i) => {
      receiptQty.set(i.materialId, (receiptQty.get(i.materialId) || 0) + i.qty)
      costs.set(i.materialId, (costs.get(i.materialId) || 0) + i.qty * i.unitPrice)
    }))
    return s.materials.filter((m) => !m.deleted).flatMap((m) => {
      const tx = activeTx.filter((t) => t.materialId === m.id)
      const period = tx.filter((t) => inRange(t.time.slice(0, 10)))
      const future = tx.filter((t) => later(t.time.slice(0, 10)))
      const bought = receiptQty.get(m.id) || 0
      if (!period.length && bought === 0) return []
      const adjustmentIn = period.filter((t) => t.type === 'Điều chỉnh' && t.delta > 0).reduce((a, t) => a + t.delta, 0)
      const incoming = bought + adjustmentIn
      const outgoing = period.filter((t) => t.delta < 0).reduce((a, t) => a - t.delta, 0)
      const ending = m.stock - future.reduce((a, t) => a + t.delta, 0)
      const opening = ending - period.reduce((a, t) => a + t.delta, 0)
      const balanced = opening >= -1e-9 && ending >= -1e-9
      return [{ id: m.id, code: m.id, name: m.name, unit: m.unit, open: balanced ? Math.max(0, opening) : null, in: incoming, out: outgoing, close: balanced ? Math.max(0, ending) : null, cost: costs.get(m.id) || 0 }]
    }).sort((a, b) => compareCodes(a.id, b.id))
  }, [s.transactions, s.receipts, s.materials, shown, today])
  const total = rows.reduce((a, r) => a + r.cost, 0)

  const exportCsv = () => {
    setMenu(false)
    if (!shown || !rows.length) return notify({ type: 'error', message: 'Không có dữ liệu trong kỳ đã chọn để xuất.' })
    const head = ['Mã NVL', 'Tên NVL', 'Đơn vị tính', 'Tồn đầu kỳ', 'Nhập trong kỳ', 'Xuất trong kỳ', 'Tồn cuối kỳ', 'Chi phí nhập (VNĐ)']
    const body = rows.map((r) => [r.code, r.name, r.unit, r.open, r.in, r.out, r.close, r.cost])
    const quote = (v) => `"${String(v).replaceAll('"', '""')}"`
    const csv = '\uFEFF' + [head, ...body].map((line) => line.map(quote).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `bao-cao-nhap-xuat-ton-${shown.label.replace(/[ /]/g, '-')}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify('Xuất file thành công')
  }

  const cols = [
    { label: 'Mã NVL', render: (r) => <span className="code">{r.code}</span> },
    { label: 'Tên NVL', render: (r) => <span className="name">{r.name}</span> },
    { label: 'Đơn vị tính', key: 'unit' },
    { label: 'Tồn đầu kỳ', num: true, render: (r) => r.open == null ? '—' : fmtNum(r.open) },
    { label: 'Nhập trong kỳ', num: true, render: (r) => fmtNum(r.in) },
    { label: 'Xuất trong kỳ', num: true, render: (r) => fmtNum(r.out) },
    { label: 'Tồn cuối kỳ', num: true, render: (r) => <b>{r.close == null ? '—' : fmtNum(r.close)}</b> },
    { label: 'Chi phí nhập (VNĐ)', num: true, render: (r) => <b>{fmtMoney(r.cost)}</b> },
  ]
  return <>
    <div className="page-head"><h2>Báo cáo Nhập - Xuất - Tồn &amp; Chi phí</h2><div style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setMenu(!menu)}><Download size={18} /> Xuất file <ChevronDown size={16} /></button>
      {menu && <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 190, zIndex: 5, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}><button className="btn" style={{ width: '100%', border: 0, borderRadius: 0 }} onClick={exportCsv}>Excel / CSV (.csv)</button></div>}
    </div></div>
    {s.materialsLoading && <div className="banner">Đang tải danh mục nguyên vật liệu từ SQL Server...</div>}
    {s.materialsError && <div className="banner error">Không thể tải danh mục nguyên vật liệu: {s.materialsError}</div>}
    {!s.inventoryHistoryAvailable && <div className="banner error">{s.inventoryHistoryError}</div>}
    <div className="card" style={{ padding: 18, marginBottom: 18, display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="field"><label>Loại kỳ</label><div className="seg">{['Ngày', 'Tuần', 'Tháng', 'Năm'].map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k}</button>)}</div></div>
      <div className="field"><label>Kỳ cần xem</label>
        {kind === 'Tháng' && <input className="input" type="month" max={today.slice(0, 7)} style={{ width: 240 }} value={month} onChange={(e) => setMonth(e.target.value)} />}
        {kind === 'Năm' && <input className="input" type="number" min="2000" max={today.slice(0, 4)} style={{ width: 240 }} value={year} onChange={(e) => setYear(e.target.value)} />}
        {(kind === 'Ngày' || kind === 'Tuần') && <input className="input" type="date" max={today} style={{ width: 240 }} value={day} onChange={(e) => setDay(e.target.value)} />}
      </div>
      <button className="btn primary" onClick={view}><BarChart3 size={18} /> Xem báo cáo</button>
    </div>
    {shown && <div className="card"><div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div><h3 style={{ margin: 0 }}>Kết quả báo cáo {shown.label}</h3><span className="muted" style={{ fontSize: 13 }}>Kỳ báo cáo: {shown.range}</span></div>
      <span className="pill" style={{ background: '#eaf3fc', color: 'var(--primary)' }}>Tồn cuối kỳ = Tồn đầu kỳ + Nhập trong kỳ − Xuất trong kỳ</span>
    </div><DataTable columns={cols} rows={rows} emptyText="Không có dữ liệu trong kỳ" footer={rows.length > 0 ? <div className="report-total"><span>Tổng chi phí nhập <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>({rows.filter((r) => r.cost > 0).length} nguyên vật liệu)</span></span><span className="v">{fmtMoney(total)} VNĐ</span></div> : null} /></div>}
    {shown && rows.some((r) => r.open == null || r.close == null) && <div className="banner" style={{ background: '#fff7e6', color: '#92400e', marginTop: 12 }}>Một số tồn đầu kỳ hoặc tồn cuối kỳ được hiển thị “—” vì lịch sử mẫu chưa đủ để đối soát. Hệ thống không tự suy đoán số liệu.</div>}
    {toast}
  </>
}
