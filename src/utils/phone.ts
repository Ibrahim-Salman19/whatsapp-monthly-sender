/**
 * Robust phone number normalization and formatting.
 * Handles Pakistan local format (03XX XXXXXXX -> 923XXXXXXXXX),
 * leading +, double zeros (00), spaces, dashes, and parentheses.
 */

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return ''
  // Strip whitespace, hyphens, brackets, dots
  let cleaned = String(input).replace(/[\s\-\(\)\.]/g, '')

  // Remove leading '+'
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1)
  }

  // Remove leading '00' (international dialing prefix)
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2)
  }

  // Pakistani numbers: starts with 03 and has 11 digits (e.g. 03001234567) -> convert to 923001234567
  if (/^03\d{9}$/.test(cleaned)) {
    cleaned = '92' + cleaned.slice(1)
  }

  return cleaned
}

export function isValidPhone(input: string | null | undefined): boolean {
  const norm = normalizePhone(input)
  // International E.164 phone numbers typically between 10 and 15 digits
  return /^\d{10,15}$/.test(norm)
}

export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return ''
  const norm = normalizePhone(phone)
  // Format Pakistan numbers: 92 300 1234567
  if (norm.startsWith('92') && norm.length === 12) {
    return `+${norm.slice(0, 2)} ${norm.slice(2, 5)} ${norm.slice(5)}`
  }
  return `+${norm}`
}
