import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react'
import { Download, FileDown, ImagePlus, Mail, Monitor, MoveDown, MoveUp, Palette, Plus, RotateCcw, Smartphone, Trash2, Upload, X } from 'lucide-react'
import { createDefaultPortfolio, STORAGE_KEY } from './defaults'
import { createPortfolioHtml, exportFileName, initials, isValidImage, joinTags, readImage, safeColor, safeUrl, splitTags } from './lib/portfolio'
import type { PortfolioData, Project, SocialLink } from './types'

type Notice = { kind: 'success' | 'error'; message: string } | null

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

function loadDraft(): PortfolioData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return createDefaultPortfolio()
    const candidate = JSON.parse(saved) as PortfolioData
    return candidate && typeof candidate.name === 'string' && Array.isArray(candidate.projects) ? candidate : createDefaultPortfolio()
  } catch {
    return createDefaultPortfolio()
  }
}

function downloadWithBrowser(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function saveExport(content: string, filename: string): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) {
    downloadWithBrowser(content, filename)
    return
  }

  try {
    const [{ save }, { invoke }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core')
    ])
    const path = await save({ defaultPath: filename, filters: [{ name: '网页文件', extensions: ['html'] }] })
    if (path) await invoke('save_html_file', { path, content })
  } catch {
    downloadWithBrowser(content, filename)
  }
}

export default function App() {
  const [data, setData] = useState<PortfolioData>(loadDraft)
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      setNotice({ kind: 'error', message: '本机存储空间不足，暂时无法自动保存。' })
    }
  }, [data])

  const updateData = (patch: Partial<PortfolioData>) => setData((previous) => ({ ...previous, ...patch }))
  const exportHtml = useMemo(() => createPortfolioHtml(data), [data])

  async function handleExport() {
    if (!data.name.trim()) {
      setNotice({ kind: 'error', message: '请先填写姓名后再导出。' })
      return
    }
    await saveExport(exportHtml, exportFileName(data.name))
    setNotice({ kind: 'success', message: '已生成独立 HTML 文件。' })
  }

  function resetDraft() {
    if (window.confirm('恢复示例内容会覆盖当前编辑内容，是否继续？')) {
      setData(createDefaultPortfolio())
      setNotice({ kind: 'success', message: '已恢复示例内容。' })
    }
  }

  async function updateAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isValidImage(file)) {
      setNotice({ kind: 'error', message: '请上传 4MB 以内的图片文件。' })
      return
    }
    updateData({ avatar: await readImage(file) })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><div className="brand-mark">H</div><div><strong>主页工坊</strong><span>个人主页生成器</span></div></div>
        <div className="header-actions">
          <button className="icon-button" type="button" title="恢复示例内容" onClick={resetDraft}><RotateCcw size={18} /></button>
          <button className="primary-button" type="button" onClick={handleExport}><Download size={18} />导出 HTML</button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.message}</span><button className="icon-button" type="button" title="关闭提示" onClick={() => setNotice(null)}><X size={16} /></button></div>}

      <main className="workspace">
        <aside className="editor-panel" aria-label="主页内容编辑器">
          <div className="panel-heading"><div><p className="overline">内容编辑</p><h1>建立你的个人主页</h1></div><span className="save-state">本机自动保存</span></div>

          <EditorSection icon={<Upload size={17} />} title="个人资料">
            <div className="avatar-field">
              {data.avatar ? <img src={data.avatar} alt="当前头像" /> : <div className="avatar-empty">{initials(data.name)}</div>}
              <div className="avatar-actions"><label className="secondary-button"><ImagePlus size={16} />上传头像<input type="file" accept="image/*" onChange={updateAvatar} /></label>{data.avatar && <button className="text-button" type="button" onClick={() => updateData({ avatar: undefined })}>移除</button>}</div>
            </div>
            <Field label="姓名" required><input value={data.name} maxLength={40} onChange={(event) => updateData({ name: event.target.value })} placeholder="例如：林予安" /></Field>
            <Field label="一句话介绍" required><input value={data.headline} maxLength={120} onChange={(event) => updateData({ headline: event.target.value })} placeholder="你希望别人怎样认识你？" /></Field>
            <Field label="个人简介"><textarea rows={4} value={data.bio} maxLength={500} onChange={(event) => updateData({ bio: event.target.value })} placeholder="用几句话介绍你的经历和方向。" /></Field>
          </EditorSection>

          <EditorSection icon={<Palette size={17} />} title="风格与技能">
            <Field label="主题色"><div className="color-input"><input type="color" value={data.accentColor} onChange={(event) => updateData({ accentColor: event.target.value })} /><input value={data.accentColor} pattern="^#[0-9A-Fa-f]{6}$" onChange={(event) => updateData({ accentColor: event.target.value })} aria-label="主题色十六进制值" /></div></Field>
            <Field label="技能标签"><textarea rows={2} value={joinTags(data.skills)} onChange={(event) => updateData({ skills: splitTags(event.target.value) })} placeholder="用逗号分隔，例如：产品策略，交互设计" /></Field>
          </EditorSection>

          <EditorSection icon={<FileDown size={17} />} title="作品项目" action={<button className="small-button" type="button" onClick={() => updateData({ projects: [...data.projects, { id: createId('project'), title: '', description: '', tags: [], url: '' }] })}><Plus size={15} />添加</button>}>
            <div className="collection-list">
              {data.projects.map((project, index) => <ProjectEditor key={project.id} project={project} index={index} total={data.projects.length} onChange={(next) => updateData({ projects: data.projects.map((item) => item.id === project.id ? next : item) })} onDelete={() => updateData({ projects: data.projects.filter((item) => item.id !== project.id) })} onMove={(offset) => moveItem(data.projects, index, offset, (projects) => updateData({ projects }))} onNotice={setNotice} />)}
              {!data.projects.length && <p className="empty-state">还没有作品。添加一个能代表你的项目吧。</p>}
            </div>
          </EditorSection>

          <EditorSection icon={<Mail size={17} />} title="联系与社交">
            <Field label="电子邮箱"><input type="email" value={data.email} onChange={(event) => updateData({ email: event.target.value })} placeholder="hello@example.com" /></Field>
            <Field label="所在地"><input value={data.location} maxLength={80} onChange={(event) => updateData({ location: event.target.value })} placeholder="例如：中国，上海" /></Field>
            <div className="social-list">{data.socials.map((social) => <SocialEditor key={social.id} social={social} onChange={(next) => updateData({ socials: data.socials.map((item) => item.id === social.id ? next : item) })} onDelete={() => updateData({ socials: data.socials.filter((item) => item.id !== social.id) })} />)}</div>
            <button className="secondary-button full-width" type="button" onClick={() => updateData({ socials: [...data.socials, { id: createId('social'), label: '', url: '' }] })}><Plus size={16} />添加社交链接</button>
          </EditorSection>
        </aside>

        <section className="preview-panel" aria-label="主页实时预览">
          <div className="preview-toolbar"><div><p className="overline">实时预览</p><span>导出后与此处一致</span></div><div className="segmented" aria-label="预览尺寸"><button className={previewMode === 'desktop' ? 'active' : ''} type="button" onClick={() => setPreviewMode('desktop')}><Monitor size={16} />桌面</button><button className={previewMode === 'mobile' ? 'active' : ''} type="button" onClick={() => setPreviewMode('mobile')}><Smartphone size={16} />手机</button></div></div>
          <div className="preview-stage"><div className={`preview-frame ${previewMode}`}><PortfolioPreview data={data} /></div></div>
        </section>
      </main>
    </div>
  )
}

function moveItem<T>(items: T[], index: number, offset: number, update: (items: T[]) => void) {
  const nextIndex = index + offset
  if (nextIndex < 0 || nextIndex >= items.length) return
  const next = [...items]
  ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
  update(next)
}

function EditorSection({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="editor-section"><div className="section-title"><div><span className="section-icon">{icon}</span><h2>{title}</h2></div>{action}</div>{children}</section>
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="field"><span>{label}{required && <b aria-label="必填">*</b>}</span>{children}</label>
}

function ProjectEditor({ project, index, total, onChange, onDelete, onMove, onNotice }: { project: Project; index: number; total: number; onChange: (project: Project) => void; onDelete: () => void; onMove: (offset: number) => void; onNotice: (notice: Notice) => void }) {
  async function uploadCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isValidImage(file)) { onNotice({ kind: 'error', message: '请上传 4MB 以内的图片文件。' }); return }
    onChange({ ...project, image: await readImage(file) })
  }
  return <article className="project-editor"><div className="item-header"><strong>项目 {index + 1}</strong><div><button className="icon-button compact" type="button" title="上移项目" disabled={index === 0} onClick={() => onMove(-1)}><MoveUp size={15} /></button><button className="icon-button compact" type="button" title="下移项目" disabled={index === total - 1} onClick={() => onMove(1)}><MoveDown size={15} /></button><button className="icon-button compact danger" type="button" title="删除项目" onClick={onDelete}><Trash2 size={15} /></button></div></div>
    <div className="cover-input">{project.image ? <img src={project.image} alt="项目封面" /> : <div>项目封面</div>}<label className="secondary-button"><ImagePlus size={15} />{project.image ? '更换' : '上传'}<input type="file" accept="image/*" onChange={uploadCover} /></label>{project.image && <button className="text-button" type="button" onClick={() => onChange({ ...project, image: undefined })}>移除</button>}</div>
    <Field label="项目名称"><input value={project.title} maxLength={80} onChange={(event) => onChange({ ...project, title: event.target.value })} placeholder="项目名称" /></Field>
    <Field label="项目介绍"><textarea rows={2} value={project.description} maxLength={300} onChange={(event) => onChange({ ...project, description: event.target.value })} placeholder="项目解决了什么问题？" /></Field>
    <Field label="项目标签"><input value={joinTags(project.tags)} onChange={(event) => onChange({ ...project, tags: splitTags(event.target.value) })} placeholder="例如：Web 应用，产品设计" /></Field>
    <Field label="项目链接"><input type="url" value={project.url} onChange={(event) => onChange({ ...project, url: event.target.value })} placeholder="https://example.com" /></Field>
  </article>
}

function SocialEditor({ social, onChange, onDelete }: { social: SocialLink; onChange: (social: SocialLink) => void; onDelete: () => void }) {
  return <div className="social-row"><input value={social.label} maxLength={30} onChange={(event) => onChange({ ...social, label: event.target.value })} placeholder="名称" aria-label="社交平台名称" /><input type="url" value={social.url} onChange={(event) => onChange({ ...social, url: event.target.value })} placeholder="https://" aria-label="社交平台链接" /><button className="icon-button compact danger" type="button" title="删除社交链接" onClick={onDelete}><Trash2 size={15} /></button></div>
}

function PortfolioPreview({ data }: { data: PortfolioData }) {
  return <div className="portfolio-preview" style={{ '--accent': safeColor(data.accentColor) } as CSSProperties}>
    <header><strong>{data.name || '你的名字'}</strong><a href="#preview-contact">联系我</a></header>
    <section className="preview-intro"><div><p>个人主页</p><h2>{data.headline || '一句有力量的自我介绍。'}</h2><div className="preview-bio">{data.bio || '在这里介绍你的经历、能力和想做的事。'}</div></div>{data.avatar ? <img className="preview-avatar" src={data.avatar} alt="头像预览" /> : <div className="preview-avatar preview-fallback">{initials(data.name)}</div>}</section>
    <section className="preview-split"><h3>我擅长的事</h3><ul className="preview-pills">{data.skills.length ? data.skills.map((skill, index) => <li key={`${skill}-${index}`}>{skill}</li>) : <li>你的技能</li>}</ul></section>
    <section className="preview-split"><h3>项目作品</h3><div className="preview-projects">{data.projects.length ? data.projects.map((project) => <article key={project.id}><div className="preview-cover">{project.image ? <img src={project.image} alt="项目封面" /> : <span>{initials(project.title)}</span>}</div><div><p>精选项目</p><h4>{project.title || '未命名项目'}{safeUrl(project.url) && <span aria-label="有项目链接"> ↗</span>}</h4><div className="preview-description">{project.description || '补充这个项目的背景、过程与成果。'}</div><ul className="preview-pills">{project.tags.map((tag, index) => <li key={`${tag}-${index}`}>{tag}</li>)}</ul></div></article>) : <div className="preview-empty">在左侧添加项目后，会显示在这里。</div>}</div></section>
    <section id="preview-contact" className="preview-contact"><div><p>保持联系</p><h3>有想法，欢迎来信。</h3></div><div>{data.email && <span>{data.email}</span>}{data.location && <span>{data.location}</span>}{data.socials.filter((social) => social.label && safeUrl(social.url)).map((social) => <span key={social.id}>{social.label}</span>)}</div></section>
    <footer>© {new Date().getFullYear()} {data.name || '你的名字'}</footer>
  </div>
}
