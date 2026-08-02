export type SocialLink = {
  id: string
  label: string
  url: string
}

export type Project = {
  id: string
  title: string
  description: string
  tags: string[]
  image?: string
  url: string
}

export type GeneratedEffectType =
  | 'reveal'
  | 'parallax'
  | 'sticky'
  | 'marquee'
  | 'section-snap'
  | 'media-swap'
  | 'scene-pin'
  | 'particle-field'

export type GeneratedEffect = {
  targetId: string
  type: GeneratedEffectType
  intensity?: number
}

export type GeneratedPageDesign = {
  version: 1
  bodyHtml: string
  css: string
  effects: GeneratedEffect[]
  createdAt: string
}

export type AiAttachment = {
  id: string
  name: string
  src: string
  intent: 'reference' | 'target'
  bytes: number
}

export type AiProfileSnapshot = {
  name: string
  headline: string
  bio: string
  email: string
  location: string
  accentColor: string
  hasAvatar: boolean
  skills: string[]
  projects: Array<{
    title: string
    description: string
    tags: string[]
    hasImage: boolean
  }>
  socials: Array<{
    label: string
    url: string
  }>
}

export type GeneratePageDesignRequest = {
  prompt: string
  profile: AiProfileSnapshot
  attachments: Array<Pick<AiAttachment, 'name' | 'src' | 'intent' | 'bytes'>>
}

export type AiApiFormat = 'responses' | 'chatCompletions'

export type AiProviderConfig = {
  baseUrl: string
  model: string
  apiFormat: AiApiFormat
}

export type TemplateId = 'professional' | 'creative' | 'resume' | 'generated'

export type PortfolioData = {
  name: string
  headline: string
  bio: string
  avatar?: string
  email: string
  location: string
  skills: string[]
  projects: Project[]
  socials: SocialLink[]
  accentColor: string
  templateId: TemplateId
  generatedDesign?: GeneratedPageDesign
}
