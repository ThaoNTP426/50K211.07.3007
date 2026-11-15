export const stockStatus = (m) => (m.stock <= 0 ? 'Hết hàng' : m.stock <= m.min ? 'Sắp hết' : 'Còn hàng')

export const expiryStatus = (iso, stock) => {
  if (!iso || stock === 0) return 'Không áp dụng'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const expiry = new Date(`${iso}T00:00:00`)
  const diff = (expiry - today) / 86400000
  if (diff < 0) return 'Đã hết hạn'
  if (diff <= 7) return 'Sắp hết hạn'
  return 'Còn hạn'
}
