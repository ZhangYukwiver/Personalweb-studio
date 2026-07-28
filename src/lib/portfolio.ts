import type { PortfolioData, TemplateId } from '../types'

const textEncoder = new TextEncoder()

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] ?? character)
}

export function safeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

export function safeColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#0f766e'
}

export function splitTags(value: string): string[] {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean)
}

export function joinTags(values: string[]): string {
  return values.join('，')
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '我'
}

export function isValidImage(file: File): boolean {
  return file.type.startsWith('image/') && file.size <= 4 * 1024 * 1024
}

export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export function exportFileName(name: string): string {
  const normalized = name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${normalized || 'portfolio'}-index.html`
}

export function byteSize(value: string): number {
  return textEncoder.encode(value).length
}

type PortfolioContent = {
  name: string
  headline: string
  bio: string
  avatar: string
  skills: string
  projects: string
  contactLinks: string
}

function renderPortfolioContent(data: PortfolioData): PortfolioContent {
  const name = escapeHtml(data.name || '我的主页')
  const headline = escapeHtml(data.headline)
  const bio = escapeHtml(data.bio).replace(/\n/g, '<br>')
  const avatar = data.avatar
    ? `<img src="${escapeHtml(data.avatar)}" alt="${name} 的头像">`
    : `<div class="avatar-fallback" aria-label="${name}">${escapeHtml(initials(data.name))}</div>`
  const skills = data.skills.filter(Boolean).map((skill) => `<li>${escapeHtml(skill)}</li>`).join('')
  const projects = data.projects.map((project) => {
    const url = safeUrl(project.url)
    const media = project.image
      ? `<img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)} 项目封面">`
      : `<div class="project-placeholder">${escapeHtml(initials(project.title))}</div>`
    const title = escapeHtml(project.title || '未命名项目')
    const projectTitle = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${title} <span aria-hidden="true">↗</span></a>`
      : title

    return `<article class="project"><div class="project-media">${media}</div><div class="project-body"><p class="eyebrow">精选项目</p><h3>${projectTitle}</h3><p class="project-description">${escapeHtml(project.description)}</p><ul class="tags">${project.tags.filter(Boolean).map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul></div></article>`
  }).join('')
  const socialLinks = data.socials.map((social) => {
    const url = safeUrl(social.url)
    return url && social.label.trim()
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(social.label)}</a>`
      : ''
  }).join('')
  const email = data.email.trim()
  const emailLink = email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ''
  const location = data.location.trim() ? `<span>${escapeHtml(data.location)}</span>` : ''

  return {
    name,
    headline,
    bio,
    avatar,
    skills,
    projects,
    contactLinks: `${emailLink}${location}${socialLinks}`
  }
}

const sharedStyles = `
    :root { --ink: #171c1a; --muted: #626d69; --line: #d9dfdc; --paper: #f7f8f7; --surface: #ffffff; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; color: var(--ink); background: var(--paper); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; line-height: 1.65; }
    a { color: inherit; text-underline-offset: 4px; }
    img { display: block; max-width: 100%; }
    h1, h2, h3, p { margin-top: 0; letter-spacing: 0; }
    .site-header, .hero, .content-section, .site-footer { width: min(1120px, calc(100% - 48px)); margin-inline: auto; }
    .site-header { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
    .identity { font-size: 15px; font-weight: 800; text-decoration: none; }
    .site-nav { display: flex; gap: 20px; color: var(--muted); font-size: 14px; }
    .site-nav a { text-decoration: none; }
    .eyebrow { margin-bottom: 12px; color: var(--accent); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .hero h1 { margin-bottom: 24px; font-size: 72px; line-height: 1.06; }
    .bio { max-width: 680px; margin-bottom: 0; color: var(--muted); font-size: 18px; }
    .portrait { overflow: hidden; aspect-ratio: 1; background: #dfe7e3; }
    .portrait img, .project-media img { width: 100%; height: 100%; object-fit: cover; }
    .avatar-fallback, .project-placeholder { width: 100%; height: 100%; display: grid; place-items: center; color: var(--accent); font-weight: 800; }
    .avatar-fallback { font-size: 72px; }
    .content-section { border-top: 1px solid var(--line); }
    .section-heading h2 { margin-bottom: 0; font-size: 38px; line-height: 1.15; }
    .skills, .tags { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; margin: 0; list-style: none; }
    .skills li, .tags li { border: 1px solid var(--line); padding: 6px 11px; color: var(--muted); font-size: 13px; }
    .projects { display: grid; gap: 28px; }
    .project-media { overflow: hidden; aspect-ratio: 4 / 3; background: #dfe7e3; }
    .project-placeholder { font-size: 36px; }
    .project h3 { margin-bottom: 10px; font-size: 24px; line-height: 1.25; }
    .project-description { margin-bottom: 18px; color: var(--muted); }
    .contact-links { display: flex; flex-wrap: wrap; gap: 10px 22px; color: var(--muted); }
    .empty { color: var(--muted); }
    .site-footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
    @media (max-width: 700px) {
      .site-header, .hero, .content-section, .site-footer { width: min(100% - 32px, 1120px); }
      .site-nav a:first-child { display: none; }
      .hero h1 { font-size: 42px; }
      .bio { font-size: 16px; }
      .section-heading h2 { font-size: 30px; }
    }`

const templateStyles: Record<TemplateId, string> = {
  professional: `
    :root { --ink: #17211f; --muted: #68716e; --line: #d8dedb; --paper: #f8f9f7; }
    .hero { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 48px; align-items: center; padding-block: 72px 90px; }
    .hero h1 { font-size: 58px; }
    .portrait { border-radius: 4px; }
    .content-section { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 56px; padding-block: 82px; }
    .project { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 28px; padding-bottom: 28px; border-bottom: 1px solid var(--line); }
    .project:last-child { padding-bottom: 0; border-bottom: 0; }
    .contact-section { align-items: end; }
    .contact-links { justify-content: flex-end; }
    .site-footer { padding-block: 28px 46px; }
    @media (max-width: 700px) {
      .hero { grid-template-columns: 1fr; gap: 36px; padding-block: 58px 70px; }
      .portrait { width: min(220px, 65%); }
      .content-section, .project { grid-template-columns: 1fr; gap: 24px; padding-block: 58px; }
      .project { padding-bottom: 28px; }
      .project-media { max-width: 420px; }
      .contact-links { justify-content: flex-start; }
    }`,
  creative: `
    :root { --ink: #161917; --muted: #58615d; --line: #cbd2ce; --paper: #eef2ef; --surface: #ffffff; }
    .site-header { min-height: 84px; }
    .identity { display: inline-flex; align-items: center; gap: 9px; }
    .identity::before { width: 14px; height: 14px; content: ""; background: var(--accent); }
    .hero { width: min(1240px, calc(100% - 48px)); min-height: 520px; display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 36px; align-items: end; padding: 48px; color: #f7faf8; background: var(--ink); }
    .hero .eyebrow { color: #aebbb5; }
    .hero h1 { max-width: 820px; font-size: 58px; }
    .hero .bio { color: #c2cbc7; }
    .portrait { border-radius: 2px; background: #303632; }
    .content-section { padding-block: 86px; }
    .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 38px; }
    .section-heading h2 { font-size: 48px; }
    .skills { max-width: 820px; }
    .skills li, .tags li { border-color: #aeb9b3; background: var(--surface); }
    .projects { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; counter-reset: project; }
    .project { min-width: 0; border: 1px solid var(--line); background: var(--surface); counter-increment: project; }
    .project-body { position: relative; padding: 28px; }
    .project-body::after { position: absolute; top: 24px; right: 26px; content: "0" counter(project); color: #9da8a2; font-size: 12px; font-weight: 800; }
    .project h3 { padding-right: 34px; font-size: 28px; }
    .contact-section { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 48px; align-items: end; }
    .contact-links { max-width: 420px; justify-content: flex-end; }
    .site-footer { padding-block: 30px 48px; }
    @media (max-width: 700px) {
      .hero { width: 100%; min-height: 0; grid-template-columns: 1fr; gap: 40px; padding: 54px 24px; }
      .hero h1 { font-size: 46px; }
      .portrait { width: min(260px, 75%); }
      .content-section { padding-block: 60px; }
      .section-heading, .contact-section { display: grid; grid-template-columns: 1fr; gap: 24px; }
      .section-heading h2 { font-size: 34px; }
      .projects { grid-template-columns: 1fr; }
      .contact-links { justify-content: flex-start; }
    }`,
  resume: `
    :root { --ink: #151918; --muted: #5c6662; --line: #d6dcda; --paper: #ffffff; --surface: #f2f5f3; }
    body { border-top: 7px solid var(--accent); }
    .site-header { min-height: 70px; border-bottom: 1px solid var(--line); }
    .hero { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 54px; align-items: start; padding-block: 66px 74px; }
    .portrait { grid-column: 1; grid-row: 1; border-radius: 2px; }
    .hero-copy { grid-column: 2; grid-row: 1; }
    .hero h1 { max-width: 760px; font-size: 58px; }
    .content-section { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 54px; padding-block: 58px; }
    .section-heading h2 { font-size: 28px; }
    .skills { gap: 7px; }
    .skills li, .tags li { border: 0; padding: 5px 9px; background: var(--surface); }
    .projects { gap: 0; }
    .project { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 28px; padding-block: 24px; border-top: 1px solid var(--line); }
    .project:first-child { padding-top: 0; border-top: 0; }
    .project-media { border-radius: 2px; }
    .project .eyebrow { margin-bottom: 7px; }
    .project h3 { margin-bottom: 7px; font-size: 22px; }
    .project-description { margin-bottom: 12px; }
    .contact-section { align-items: start; }
    .contact-links { display: grid; justify-items: start; }
    .site-footer { padding-block: 24px 42px; }
    @media (max-width: 700px) {
      .hero, .content-section { grid-template-columns: 1fr; gap: 28px; padding-block: 50px; }
      .hero-copy, .portrait { grid-column: 1; }
      .hero-copy { grid-row: 1; }
      .portrait { grid-row: 2; width: min(210px, 65%); }
      .hero h1 { font-size: 40px; }
      .project { grid-template-columns: 1fr; gap: 18px; }
      .project-media { max-width: 360px; }
    }`
}

function renderPortfolioBody(content: PortfolioContent): string {
  return `<header class="site-header">
    <a class="identity" href="#top">${content.name}</a>
    <nav class="site-nav" aria-label="主页导航"><a href="#skills">技能</a><a href="#projects">作品</a><a href="#contact">联系</a></nav>
  </header>
  <main>
    <section id="top" class="hero">
      <div class="hero-copy"><p class="eyebrow">个人主页</p><h1>${content.headline}</h1><p class="bio">${content.bio}</p></div>
      <div class="portrait">${content.avatar}</div>
    </section>
    <section id="skills" class="content-section skills-section">
      <div class="section-heading"><div><p class="eyebrow">核心能力</p><h2>我擅长的事</h2></div></div>
      <div>${content.skills ? `<ul class="skills">${content.skills}</ul>` : '<p class="empty">技能待补充。</p>'}</div>
    </section>
    <section id="projects" class="content-section projects-section">
      <div class="section-heading"><div><p class="eyebrow">精选案例</p><h2>项目作品</h2></div></div>
      <div class="projects">${content.projects || '<p class="empty">项目即将发布。</p>'}</div>
    </section>
    <section id="contact" class="content-section contact-section">
      <div class="section-heading"><div><p class="eyebrow">保持联系</p><h2>有想法，欢迎来信。</h2></div></div>
      <div class="contact-links">${content.contactLinks}</div>
    </section>
  </main>
  <footer class="site-footer">© ${new Date().getFullYear()} ${content.name}</footer>`
}

export function createPortfolioHtml(data: PortfolioData, options: { preview?: boolean } = {}): string {
  const templateId: TemplateId = Object.prototype.hasOwnProperty.call(templateStyles, data.templateId)
    ? data.templateId
    : 'professional'
  const content = renderPortfolioContent(data)

  return `<!doctype html>
<html lang="zh-CN" data-template="${templateId}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${options.preview ? '<base href="about:srcdoc">' : ''}
  <meta name="description" content="${content.name} 的个人主页">
  <title>${content.name} | 个人主页</title>
  <style>
    :root { --accent: ${safeColor(data.accentColor)}; }
    ${sharedStyles}
    ${templateStyles[templateId]}
  </style>
</head>
<body>${renderPortfolioBody(content)}</body>
</html>`
}
