import { describe, expect, it } from 'vitest'
import { createDefaultPortfolio } from '../defaults'
import { createPortfolioHtml, exportFileName, safeColor, safeUrl, splitTags } from './portfolio'

describe('portfolio export', () => {
  it('creates a standalone document with escaped user content', () => {
    const data = createDefaultPortfolio()
    data.name = '<script>alert(1)</script>'
    data.projects[0].image = 'data:image/png;base64,abc'
    const html = createPortfolioHtml(data)

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('data:image/png;base64,abc')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('allows only safe external URLs', () => {
    expect(safeUrl('https://example.com/hello')).toBe('https://example.com/hello')
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('not a url')).toBe('')
  })

  it('falls back when the accent color is not a hex color', () => {
    expect(safeColor('#2F766E')).toBe('#2F766E')
    expect(safeColor('red; } body { display: none')).toBe('#0f766e')
  })

  it('formats tags and exported file names', () => {
    expect(splitTags('产品设计，交互设计,用户研究')).toEqual(['产品设计', '交互设计', '用户研究'])
    expect(exportFileName(' 林 予安 ')).toBe('林-予安-index.html')
  })
})
