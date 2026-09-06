/**
 * Spintax (Spin Syntax) processing engine for WhatsApp message variations.
 * Eliminates duplicate message hashes to prevent automated spam detection.
 */

/**
 * Recursively parses and resolves Spintax strings: {option1|option2|{sub1|sub2}}
 */
export function processSpintax(text: string): string {
  if (!text) return ''
  const regex = /\{([^{}]+)\}/g
  let prev = text
  let iterations = 0
  const maxIterations = 30 // Guard against nested overflow

  while (regex.test(prev) && iterations < maxIterations) {
    prev = prev.replace(regex, (_, choices: string) => {
      const options = choices.split('|')
      const picked = options[Math.floor(Math.random() * options.length)]
      return picked
    })
    iterations++
  }

  return prev
}

/**
 * Validates spintax syntax for balanced curly braces.
 */
export function validateSpintax(text: string): { valid: boolean; error?: string } {
  let open = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') open++
    else if (text[i] === '}') {
      open--
      if (open < 0) return { valid: false, error: 'Unmatched closing brace "}" detected' }
    }
  }
  if (open > 0) return { valid: false, error: 'Unmatched opening brace "{" detected' }
  return { valid: true }
}

/**
 * Generates up to N distinct variations of a template.
 */
export function generateSpintaxVariations(template: string, count = 5): string[] {
  const variations = new Set<string>()
  const maxTries = count * 6
  let tries = 0

  while (variations.size < count && tries < maxTries) {
    variations.add(processSpintax(template))
    tries++
  }

  return Array.from(variations)
}
