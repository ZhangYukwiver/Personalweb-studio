// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { createDefaultPortfolio } from '../defaults'
import { aiEndpoint, createAiGenerationRequest, DEFAULT_AI_PROVIDER } from './aiGeneration'

describe('AI generation request', () => {
  it('sends profile facts without persisted designs or embedded portfolio images', () => {
    const data = createDefaultPortfolio()
    data.avatar = 'data:image/png;base64,avatar-secret'
    data.projects[0].image = 'data:image/png;base64,project-secret'
    const request = createAiGenerationRequest(data, '  调整视觉节奏  ', [{
      id: 'attachment-1',
      name: 'reference.jpg',
      src: 'data:image/jpeg;base64,reference',
      intent: 'reference',
      bytes: 9
    }])
    const serialized = JSON.stringify(request)

    expect(request.prompt).toBe('调整视觉节奏')
    expect(request.profile.hasAvatar).toBe(true)
    expect(request.profile.projects[0].hasImage).toBe(true)
    expect(request.attachments).toHaveLength(1)
    expect(serialized).not.toContain('avatar-secret')
    expect(serialized).not.toContain('project-secret')
    expect(serialized).not.toContain('generatedDesign')
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
