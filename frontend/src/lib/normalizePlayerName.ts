function toTitleCase(name: string): string {
  let result = ""
  let prevWasLetter = false
  for (const char of name) {
    const isLetter = /\p{L}/u.test(char)
    if (isLetter) {
      result += prevWasLetter ? char.toLowerCase() : char.toUpperCase()
    } else {
      result += char
    }
    prevWasLetter = isLetter
  }
  return result
}

export function normalizePlayerName(name: string): string {
  const letters = [...name].filter((c) => /\p{L}/u.test(c))
  if (letters.length === 0) return name
  const allUpper = letters.every((c) => c.toUpperCase() === c)
  const allLower = letters.every((c) => c.toLowerCase() === c)
  if (allUpper || allLower) return toTitleCase(name)
  return name
}
