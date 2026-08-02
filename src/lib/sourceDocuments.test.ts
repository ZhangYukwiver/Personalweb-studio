// @vitest-environment jsdom

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  extractLinksFromText,
  formatBytes,
  prepareAiSourceDocument,
  sourceDocumentError
} from './sourceDocuments'

describe('AI source documents', () => {
  it('accepts the supported formats and enforces the file limit', () => {
    expect(sourceDocumentError(new File(['resume'], 'resume.txt', { type: 'text/plain' }))).toBeNull()
    expect(sourceDocumentError(new File(['legacy'], 'resume.doc', { type: 'application/msword' }))).toContain('PDF、DOCX 和 TXT')
    expect(sourceDocumentError(new File([], 'empty.pdf', { type: 'application/pdf' }))).toContain('不能为空')
    expect(sourceDocumentError(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }))).toContain('10MB')
  })

  it('extracts and normalizes links from text', () => {
    expect(extractLinksFromText('作品：https://example.com/work。邮箱 mailto:hello@example.com')).toEqual([
      'https://example.com/work',
      'mailto:hello@example.com'
    ])
    expect(extractLinksFromText('javascript:alert(1)')).toEqual([])
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('keeps DOCX links and supported embedded images in memory', async () => {
    const zip = new JSZip()
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/portfolio" TargetMode="External" />
      </Relationships>`)
    zip.file('word/media/photo.png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))
    const content = await zip.generateAsync({ type: 'uint8array' })
    const contentBuffer = new ArrayBuffer(content.byteLength)
    new Uint8Array(contentBuffer).set(content)
    const file = new File([contentBuffer], 'resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    const document = await prepareAiSourceDocument(file, 'document-1')

    expect(document.mimeType).toContain('wordprocessingml')
    expect(document.src).toMatch(/^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/)
    expect(document.links).toEqual(['https://example.com/portfolio'])
    expect(document.images).toHaveLength(1)
    expect(document.images[0].src).toMatch(/^data:image\/png;base64,/)
    expect(document.omittedImages).toBe(0)
  })
})
