export const formatHistoryCode = (id) => {
  const value = String(id ?? '').trim()
  if (!value) return ''
  const digits = value.replace(/^GD/i, '')
  return `GD${digits.padStart(5, '0')}`
}
