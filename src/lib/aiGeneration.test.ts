// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { createDefaultPortfolio } from '../defaults'
import type { AiGenerationCandidate, AiSourceDocument, WebDesignSource } from '../types'
import { aiEndpoint, createAiGenerationRequest, createCandidatePortfolio, DEFAULT_AI_PROVIDER } from './aiGeneration'

describe('AI generation request', () => {
  it('sends profile facts without persisted designs or embedded portfolio images', () => {
    const data = createDefaultPortfolio()
    data.avatar = 'data:image/png;base64,avatar-secret'
    data.projects[0].image = 'data:image/png;base64,project-secret'
    const document: AiSourceDocument = {
      id: 'document-1',
      name: 'resume.pdf',
      mimeType: 'application/pdf',
      src: 'data:application/pdf;base64,cGRm',
      bytes: 3,
      links: ['https://example.com'],
      images: [],
      omittedImages: 0
    }
    const designSource: WebDesignSource = {
      id: 'design-1',
      name: '编辑风格',
      description: '网格排版',
      tags: ['网格布局'],
      bodyHtml: '<main><h1>标题</h1></main>',
      previewHtml: '<main><h1>不发送的原文</h1></main>',
      css: 'main{display:grid}',
      importedAt: '2026-08-02T00:00:00Z',
      bytes: 51,
      storageBytes: 92
    }
    const request = createAiGenerationRequest(data, '  调整视觉节奏  ', [{
      id: 'attachment-1',
      name: 'reference.jpg',
      src: 'data:image/jpeg;base64,reference',
      intent: 'reference',
      bytes: 9
    }], [document], [designSource])
    const serialized = JSON.stringify(request)

    expect(request.prompt).toBe('调整视觉节奏')
    expect(request.profile.hasAvatar).toBe(true)
    expect(request.profile.projects[0].hasImage).toBe(true)
    expect(request.attachments).toHaveLength(1)
    expect(request.documents).toEqual([expect.objectContaining({ name: 'resume.pdf', bytes: 3 })])
    expect(request.designSources).toEqual([expect.objectContaining({ id: 'design-1', name: '编辑风格' })])
    expect(serialized).not.toContain('avatar-secret')
    expect(serialized).not.toContain('project-secret')
    expect(serialized).not.toContain('不发送的原文')
    expect(serialized).not.toContain('generatedDesign')
  })

  it('applies profile candidates while preserving local images and stable ids', () => {
    const data = createDefaultPortfolio()
    data.avatar = 'data:image/png;base64,avatar'
    data.projects[0].image = 'data:image/png;base64,cover'
    const candidate: AiGenerationCandidate = {
      sourceDesignId: 'design-1',
      matchReason: '网格布局适合作品展示',
      design: {
        version: 1,
        bodyHtml: '<main></main>',
        css: 'body{}',
        effects: [],
        createdAt: '2026-08-02T00:00:00Z'
      },
      profile: {
        name: ' 新姓名 ',
        headline: '新标题',
        bio: '新简介',
        email: 'new@example.com',
        location: '杭州',
        skills: [' 研究 ', '设计'],
        projects: [{
          title: data.projects[0].title,
          description: '新的项目介绍',
          tags: ['产品'],
          url: 'https://example.com/work'
        }],
        socials: [{ label: '作品集', url: 'javascript:alert(1)' }]
      }
    }

    const applied = createCandidatePortfolio(data, candidate)

    expect(applied.name).toBe('新姓名')
    expect(applied.avatar).toBe(data.avatar)
    expect(applied.projects[0].id).toBe(data.projects[0].id)
    expect(applied.projects[0].image).toBe(data.projects[0].image)
    expect(applied.projects[0].url).toBe('https://example.com/work')
    expect(applied.socials[0].url).toBe('')
    expect(applied.generatedDesign).toBe(candidate.design)
  })

  it('normalizes both compatible endpoint formats and rejects unsafe public HTTP', () => {
    expect(aiEndpoint(DEFAULT_AI_PROVIDER)).toBe('https://ai.input.im/v1/responses')
    expect(aiEndpoint({ baseUrl: 'https://gateway.example.com/openai/v1/', model: 'custom-model', apiFormat: 'responses' }))
      .toBe('https://gateway.example.com/openai/v1/responses')
    expect(aiEndpoint({ baseUrl: 'https://gateway.example.com/openai/v1/responses', model: 'custom-model', apiFormat: 'chatCompletions' }))
      .toBe('https://gateway.example.com/openai/v1/chat/completions')
    expect(aiEndpoint({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model', apiFormat: 'chatCompletions' }))
      .toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(() => aiEndpoint({ baseUrl: 'http://gateway.example.com/v1', model: 'custom-model', apiFormat: 'responses' }))
      .toThrow('必须使用 HTTPS')
    expect(() => aiEndpoint({ baseUrl: 'https://gateway.example.com/v1?token=secret', model: 'custom-model', apiFormat: 'responses' }))
      .toThrow('不能包含账号、查询参数或锚点')
    expect(() => aiEndpoint({ baseUrl: 'https://gateway.example.com/v1', model: ' ', apiFormat: 'responses' }))
      .toThrow('模型名称')
  })
})
