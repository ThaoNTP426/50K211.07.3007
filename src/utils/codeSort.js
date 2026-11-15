const parseCode = (value) => String(value ?? '').trim().match(/^(\D*)(\d+)$/)

export const compareCodes = (leftValue, rightValue) => {
  const left = parseCode(leftValue)
  const right = parseCode(rightValue)

  if (!left || !right) {
    return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, { numeric: true })
  }

  const prefixOrder = left[1].localeCompare(right[1])
  if (prefixOrder !== 0) return prefixOrder

  const leftNumber = BigInt(left[2])
  const rightNumber = BigInt(right[2])
  return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0
}
