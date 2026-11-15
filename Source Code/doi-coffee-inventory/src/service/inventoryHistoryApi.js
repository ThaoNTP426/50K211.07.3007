import { apiFetch, API_URL as BASE_API_URL } from './apiClient.js'
const API_URL = `${BASE_API_URL}/inventory-history`

const mapHistoryEntry = (item) => ({
  id: String(item.maLichSu),
  materialId: String(item.maNVL || '').trim(),
  materialName: item.tenNVL || '',
  materialUnit: item.donViTinh || '',
  type: item.loaiBienDong || '',
  source: item.nguonTacDong || '',
  delta: Number(item.soLuongThayDoi),
  stockBefore: Number(item.tonTruoc),
  stockAfter: Number(item.tonSau),
  time: item.thoiGian,
  reference: item.maThamChieu || '',
  note: item.ghiChu || '',
  status: item.trangThai || '',
  deletedAt: item.thoiGianXoa || null,
  deletedBy: item.nguoiXoa || null,
  originalHistoryId: item.maLichSuGoc ?? null,
  deleted: Boolean(item.thoiGianXoa || item.deleted)
})

export const getInventoryHistory = async (includeDeleted = false) => {
  const response = await apiFetch(`${API_URL}${includeDeleted ? '?includeDeleted=true' : ''}`)
  let result

  try {
    result = await response.json()
  } catch {
    throw new Error('Backend trả về dữ liệu lịch sử tồn kho không hợp lệ!')
  }

  if (!response.ok || !result?.success) {
    throw new Error(
      result?.message || result?.error || 'Không thể tải lịch sử tồn kho từ SQL Server!'
    )
  }

  if (!Array.isArray(result.data)) {
    throw new Error('Backend trả về danh sách lịch sử tồn kho không hợp lệ!')
  }

  return result.data.map(mapHistoryEntry)
}

const mutateHistory = async (id, path, method) => {
  const response = await apiFetch(`${API_URL}/${encodeURIComponent(id)}${path}`, { method })
  let result
  try { result = await response.json() } catch { throw new Error('Backend trả về dữ liệu lịch sử không hợp lệ.') }
  if (!response.ok || !result?.success) throw new Error(result?.message || 'Không thể cập nhật lịch sử tồn kho.')
  return result
}

export const trashInventoryHistory = (id) => mutateHistory(id, '', 'DELETE')
export const restoreInventoryHistory = (id) => mutateHistory(id, '/restore', 'PATCH')
