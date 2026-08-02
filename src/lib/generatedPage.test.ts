// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { createDefaultPortfolio, normalizePortfolio } from '../defaults'
import type { GeneratedPageDesign } from '../types'
import { createImmersiveGeneratedDesign, renderGeneratedBody, sanitizeGeneratedCss, sanitizeGeneratedDesign } from './generatedPage'
import { createPortfolioHtml } from './portfolio'

describe('generated page design', () => {
  it('removes executable markup and unsafe attributes', () => {
    const candidate = createImmersiveGeneratedDesign()
    candidate.bodyHtml = candidate.bodyHtml.replace(
      '<main>',
      '<script>alert(1)</script><iframe src="https://example.com"></iframe><main onclick="alert(1)" style="color:red">'
    )

    const result = sanitizeGeneratedDesign(candidate)

    expect(result.design.bodyHtml).not.toContain('<script')
    expect(result.design.bodyHtml).not.toContain('<iframe')
    expect(result.design.bodyHtml).not.toContain('onclick')
    expect(result.design.bodyHtml).not.toContain('style=')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('rejects external CSS resources and unsafe at-rules', () => {
    expect(() => sanitizeGeneratedCss('.hero { background: url(https://example.com/a.png) }')).toThrow('不允许加载外部资源')
    expect(() => sanitizeGeneratedCss('@import "https://example.com/style.css";')).toThrow('不允许使用 @import')
    expect(() => sanitizeGeneratedCss('@font-face { font-family: x; src: local(x) }')).toThrow('不允许使用 @font-face')
  })

  it('requires the real-data slots and ignores unmatched effects', () => {
    const missingSlot = createImmersiveGeneratedDesign()
    missingSlot.bodyHtml = missingSlot.bodyHtml.replace('data-slot="contact"', '')
    expect(() => sanitizeGeneratedDesign(missingSlot)).toThrow('contact')

    const candidate = createImmersiveGeneratedDesign()
    candidate.effects.push({ targetId: 'not-on-page', type: 'reveal' })
    const result = sanitizeGeneratedDesign(candidate)
    expect(result.design.effects.some((effect) => effect.targetId === 'not-on-page')).toBe(false)
  })

  it('caps expensive generated effects while keeping the first valid declarations', () => {
    const candidate = createImmersiveGeneratedDesign()
    candidate.effects.push(
      { targetId: 'pf-skills', type: 'particle-field', intensity: .5 },
      { targetId: 'pf-contact', type: 'particle-field', intensity: .5 }
    )

    const result = sanitizeGeneratedDesign(candidate)

    expect(result.design.effects.filter((effect) => effect.type === 'particle-field')).toHaveLength(2)
    expect(result.warnings.some((warning) => warning.includes('particle-field'))).toBe(true)
  })

  it('renders escaped portfolio facts into the generated layout', () => {
    const data = createDefaultPortfolio()
    data.name = '<img src=x onerror=alert(1)>'
    data.projects[0].title = '<script>alert(1)</script>'
    data.projects[0].image = 'data:image/png;base64,abc'

    const rendered = renderGeneratedBody(data, createImmersiveGeneratedDesign())

    expect(rendered.body).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(rendered.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(rendered.body).toContain('<img src="data:image/png;base64,abc"')
    expect(rendered.body).not.toContain('<script>alert(1)</script>')
  })

  it('exports a standalone generated document with a locked-down CSP', () => {
    const data = createDefaultPortfolio()
    data.templateId = 'generated'
    data.generatedDesign = createImmersiveGeneratedDesign()

    const html = createPortfolioHtml(data)

    expect(html).toContain('data-template="generated"')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain('data-pf-effect="particle-field"')
    expect(html).toContain('data-pf-effect="scene-pin"')
    expect(html).toContain('data-pf-effect="media-swap"')
    expect(html).toContain("createElement('canvas')")
    expect(html).toContain('pf-scroll-scene')
    expect(html).toContain(data.headline)
    expect(html).not.toContain('<base href="about:srcdoc">')
  })

  it('keeps an accepted design and falls back when generated data is incomplete', () => {
    const accepted = createDefaultPortfolio()
    accepted.templateId = 'generated'
    accepted.generatedDesign = createImmersiveGeneratedDesign()
    expect(normalizePortfolio(accepted).templateId).toBe('generated')

    const incomplete = { ...accepted, generatedDesign: undefined } as unknown as { generatedDesign?: GeneratedPageDesign }
    expect(normalizePortfolio(incomplete).templateId).toBe('professional')
  })
})
