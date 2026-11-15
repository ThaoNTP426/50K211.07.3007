import { apiFetch, API_URL as BASE_API_URL } from './apiClient.js'
const API_URL = `${BASE_API_URL}/inventory-adjustments`

export const createInventoryAdjustment = async ({
  maNVL,
  tonMoi,
  lyDo,
  ghiChu
}) => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const requestId = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20)

  const response = await apiFetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maNVL, tonMoi, lyDo, ghiChu, requestId })
  })

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('Backend trả về dữ liệu điều chỉnh tồn không hợp lệ!')
  }

  if (!response.ok || !result?.success) {
    throw new Error(result?.message || 'Không thể điều chỉnh tồn kho trên SQL Server!')
  }

  return result
}
