import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { Check, ClipboardPaste, Download, FileDown, ImagePlus, KeyRound, Mail, Monitor, MoveDown, MoveUp, Palette, Plus, RefreshCw, RotateCcw, Send, Settings2, Sparkles, Smartphone, Trash2, Upload, X } from 'lucide-react'
import { createDefaultPortfolio, normalizePortfolio, STORAGE_KEY } from './defaults'
import { aiEndpoint, compressAiImage, createAiGenerationRequest, DEFAULT_AI_PROVIDER, generatePageDesign } from './lib/aiGeneration'
import { createImmersiveGeneratedDesign, sanitizeGeneratedDesign } from './lib/generatedPage'
import { createPortfolioHtml, exportFileName, initials, isValidImage, joinTags, readImage, splitTags } from './lib/portfolio'
import type { AiAttachment, AiProviderConfig, GeneratedPageDesign, PortfolioData, Project, SocialLink, TemplateId } from './types'

type Notice = { kind: 'success' | 'error'; message: string } | null
type ImageIntent = 'reference' | 'target'
type GenerationStage = 'idle' | 'sending' | 'validating'
const TEMPLATE_OPTIONS: { id: Exclude<TemplateId, 'generated'>; label: string }[] = [
  { id: 'professional', label: '清爽专业' },
  { id: 'creative', label: '创意作品集' },
  { id: 'resume', label: '极简履历' }
]

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

function loadDraft(): PortfolioData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return createDefaultPortfolio()
    return normalizePortfolio(JSON.parse(saved))
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
  const [aiPrompt, setAiPrompt] = useState('')
  const [attachments, setAttachments] = useState<AiAttachment[]>([])
  const [imageIntent, setImageIntent] = useState<ImageIntent>('reference')
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const [candidateDesign, setCandidateDesign] = useState<GeneratedPageDesign | null>(null)
  const [candidateView, setCandidateView] = useState<'current' | 'candidate'>('current')
  const [isGenerating, setIsGenerating] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [aiProvider, setAiProvider] = useState<AiProviderConfig>(() => ({ ...DEFAULT_AI_PROVIDER }))
  const [aiProviderDraft, setAiProviderDraft] = useState<AiProviderConfig>(() => ({ ...DEFAULT_AI_PROVIDER }))
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [showAiConfirmation, setShowAiConfirmation] = useState(false)
  const [generationStage, setGenerationStage] = useState<GenerationStage>('idle')
  const previewStageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      setNotice({ kind: 'error', message: '本机存储空间不足，暂时无法自动保存。' })
    }
  }, [data])

  const updateData = (patch: Partial<PortfolioData>) => setData((previous) => ({ ...previous, ...patch }))
  const previewData = useMemo<PortfolioData>(() => candidateDesign && candidateView === 'candidate'
    ? { ...data, templateId: 'generated', generatedDesign: candidateDesign }
    : data, [candidateDesign, candidateView, data])
  const generatedPreview = previewData.templateId === 'generated'
  const exportHtml = useMemo(() => createPortfolioHtml(data), [data])
  const previewHtml = useMemo(() => createPortfolioHtml(previewData, { preview: true }), [previewData])

  useEffect(() => {
    if (generatedPreview && previewMode === 'mobile') setPreviewMode('desktop')
  }, [generatedPreview, previewMode])

  useEffect(() => {
    if (previewStageRef.current) {
      previewStageRef.current.scrollTop = 0
      previewStageRef.current.scrollLeft = 0
    }
  }, [candidateDesign?.createdAt, candidateView, data.templateId, previewMode])

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

  async function updateAttachments(files: File[]) {
    const remaining = 3 - attachments.length
    if (remaining <= 0) {
      setNotice({ kind: 'error', message: '最多添加 3 张截图。' })
      return
    }
    const selected = files.slice(0, remaining)
    if (selected.some((file) => !isValidImage(file))) {
      setNotice({ kind: 'error', message: '请上传单张 4MB 以内的图片文件。' })
      return
    }
    try {
      const compressed = await Promise.all(selected.map(compressAiImage))
      const currentBytes = attachments.reduce((total, item) => total + item.bytes, 0)
      if (currentBytes + compressed.reduce((total, item) => total + item.bytes, 0) > 8 * 1024 * 1024) {
        setNotice({ kind: 'error', message: '截图压缩后的总大小不能超过 8MB。' })
        return
      }
      const next = selected.map((file, index) => ({
        id: createId('attachment'),
        name: file.name,
        src: compressed[index].src,
        intent: imageIntent,
        bytes: compressed[index].bytes
      } satisfies AiAttachment))
      setAttachments((previous) => [...previous, ...next])
    } catch {
      setNotice({ kind: 'error', message: '截图压缩失败，请重新选择图片。' })
    }
  }

  async function handleImageInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await updateAttachments(files)
  }

  async function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingImage(false)
    await updateAttachments(Array.from(event.dataTransfer.files))
  }

  function handleGenerateCandidate() {
    if (!aiPrompt.trim() && !attachments.length) {
      setNotice({ kind: 'error', message: '请添加参考截图或填写修改要求。' })
      return
    }
    if (isGenerating) return
    if (apiKey.trim()) {
      try {
        aiEndpoint(aiProvider)
      } catch (error) {
        setNotice({ kind: 'error', message: errorMessage(error) })
        return
      }
      setShowAiConfirmation(true)
      return
    }
    generateLocalCandidate()
  }

  function generateLocalCandidate() {
    setIsGenerating(true)
    try {
      const result = sanitizeGeneratedDesign(createImmersiveGeneratedDesign())
      setCandidateDesign(result.design)
      setCandidateView('candidate')
      setPreviewMode('desktop')
      setNotice({ kind: 'success', message: '已生成本地候选，确认应用前不会修改当前主页。' })
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : '候选页面生成失败。' })
    } finally {
      setIsGenerating(false)
    }
  }

  async function confirmAiGeneration() {
    setShowAiConfirmation(false)
    setIsGenerating(true)
    setGenerationStage('sending')
    try {
      const request = createAiGenerationRequest(data, aiPrompt, attachments)
      const response = await generatePageDesign(request, apiKey.trim(), aiProvider)
      setGenerationStage('validating')
      const result = sanitizeGeneratedDesign(response)
      setCandidateDesign(result.design)
      setCandidateView('candidate')
      setPreviewMode('desktop')
      setNotice({
        kind: 'success',
        message: result.warnings.length
          ? `AI 候选已生成，并安全清理了 ${result.warnings.length} 处不受支持内容。`
          : 'AI 候选已生成，确认应用前不会修改当前主页。'
      })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setGenerationStage('idle')
      setIsGenerating(false)
    }
  }

  function openAiSettings() {
    setAiProviderDraft({ ...aiProvider })
    setShowAiSettings(true)
  }

  async function pasteApiKey() {
    try {
      const clipboardText = await navigator.clipboard.readText()
      const nextKey = clipboardText.trim()
      if (!nextKey) {
        setNotice({ kind: 'error', message: '剪贴板中没有可用的 API Key。' })
        return
      }
      setApiKey(nextKey)
    } catch {
      setNotice({ kind: 'error', message: '无法读取系统剪贴板，请点击输入框后使用 Command+V。' })
    }
  }

  function saveAiSettings() {
    try {
      aiEndpoint(aiProviderDraft)
      setAiProvider({ ...aiProviderDraft, baseUrl: aiProviderDraft.baseUrl.trim(), model: aiProviderDraft.model.trim() })
      setShowAiSettings(false)
      setNotice({ kind: 'success', message: 'AI 接口设置已更新，仅在当前运行中有效。' })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    }
  }

  function applyCandidate() {
    if (!candidateDesign) return
    updateData({ generatedDesign: candidateDesign, templateId: 'generated' })
    setCandidateDesign(null)
    setCandidateView('current')
    setPreviewMode('desktop')
    setNotice({ kind: 'success', message: 'AI 候选已应用，可继续编辑资料或导出。' })
  }

  function discardCandidate() {
    setCandidateDesign(null)
    setCandidateView('current')
    setNotice({ kind: 'success', message: '已放弃候选，当前主页没有变化。' })
  }

  function selectTemplate(templateId: TemplateId) {
    updateData({ templateId })
    if (templateId === 'generated') setPreviewMode('desktop')
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
      {showAiSettings && <div className="modal-backdrop" role="presentation">
        <section className="ai-confirmation ai-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
          <div className="ai-confirmation-header"><div><p className="overline">会话设置</p><h2 id="ai-settings-title">OpenAI 兼容接口</h2></div><button className="icon-button compact" type="button" title="关闭接口设置" onClick={() => setShowAiSettings(false)}><X size={16} /></button></div>
          <div className="ai-settings-fields">
            <div className="ai-setting-field"><span>接口格式</span><div className="segmented ai-api-format" aria-label="接口格式"><button className={aiProviderDraft.apiFormat === 'responses' ? 'active' : ''} type="button" onClick={() => setAiProviderDraft((previous) => ({ ...previous, apiFormat: 'responses' }))}>Responses</button><button className={aiProviderDraft.apiFormat === 'chatCompletions' ? 'active' : ''} type="button" onClick={() => setAiProviderDraft((previous) => ({ ...previous, apiFormat: 'chatCompletions' }))}>Chat Completions</button></div></div>
            <label className="ai-setting-field"><span>API Base URL</span><input value={aiProviderDraft.baseUrl} onChange={(event) => setAiProviderDraft((previous) => ({ ...previous, baseUrl: event.target.value }))} aria-label="API Base URL" autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1" /><small>可填写 Base URL 或所选格式的完整接口地址</small></label>
            <label className="ai-setting-field"><span>模型名称</span><input value={aiProviderDraft.model} onChange={(event) => setAiProviderDraft((previous) => ({ ...previous, model: event.target.value }))} aria-label="模型名称" autoComplete="off" spellCheck={false} placeholder="gpt-5.6-sol" /></label>
          </div>
          <p className="ai-confirmation-note">支持 Responses 与 Chat Completions。公网地址必须使用 HTTPS；HTTP 只允许连接本机服务。设置和 API Key 都不会写入草稿。</p>
          <div className="ai-confirmation-actions"><button className="text-button ai-default-provider" type="button" onClick={() => setAiProviderDraft({ ...DEFAULT_AI_PROVIDER })}>恢复项目默认</button><span /><button className="secondary-button" type="button" onClick={() => setShowAiSettings(false)}>取消</button><button className="primary-button" type="button" onClick={saveAiSettings}><Check size={16} />保存设置</button></div>
        </section>
      </div>}
      {showAiConfirmation && <div className="modal-backdrop" role="presentation">
        <section className="ai-confirmation" role="dialog" aria-modal="true" aria-labelledby="ai-confirmation-title">
          <div className="ai-confirmation-header"><div><p className="overline">发送前确认</p><h2 id="ai-confirmation-title">确认交给 AI 服务的内容</h2></div><button className="icon-button compact" type="button" title="取消发送" onClick={() => setShowAiConfirmation(false)}><X size={16} /></button></div>
          <div className="ai-confirmation-list">
            <div><strong>接口格式</strong><span>{aiProvider.apiFormat === 'responses' ? 'Responses API' : 'Chat Completions'}</span></div>
            <div><strong>接口地址</strong><span>{aiEndpoint(aiProvider)}</span></div>
            <div><strong>模型</strong><span>{aiProvider.model}</span></div>
            <div><strong>个人资料</strong><span>姓名、标题、简介、技能、邮箱、所在地、社交链接和项目文字</span></div>
            <div><strong>图片状态</strong><span>仅发送头像和项目是否有图片，不发送头像或项目原图</span></div>
            <div><strong>参考截图</strong><span>{attachments.length ? attachments.map((item) => `${item.name}（${item.intent === 'reference' ? '参考样例' : '待修改页面'}）`).join('、') : '未添加'}</span></div>
            <div><strong>修改要求</strong><span>{aiPrompt.trim() || '未填写，将仅依据截图生成'}</span></div>
          </div>
          <p className="ai-confirmation-note">API Key 只会发送到上方接口，并仅在当前运行内存中使用，不写入草稿、日志或生成文件。Responses 请求使用 store: false。</p>
          <div className="ai-confirmation-actions"><button className="secondary-button" type="button" onClick={() => setShowAiConfirmation(false)}>取消</button><button className="primary-button" type="button" onClick={confirmAiGeneration}><Send size={16} />确认并发送</button></div>
        </section>
      </div>}

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
          <div className="preview-toolbar">
            <div><p className="overline">{candidateDesign ? '候选预览' : '实时预览'}</p><span>{candidateDesign ? '应用前不会修改当前主页' : '导出后与此处一致'}</span></div>
            <div className="preview-controls">
              {candidateDesign && <div className="candidate-actions">
                <div className="segmented" aria-label="候选对比"><button className={candidateView === 'current' ? 'active' : ''} type="button" onClick={() => setCandidateView('current')}>当前</button><button className={candidateView === 'candidate' ? 'active' : ''} type="button" onClick={() => setCandidateView('candidate')}>候选</button></div>
                <button className="small-button" type="button" onClick={applyCandidate}><Check size={15} />应用</button>
                <button className="icon-button compact" type="button" title="重新生成候选" onClick={handleGenerateCandidate}><RefreshCw size={15} /></button>
                <button className="icon-button compact danger" type="button" title="放弃候选" onClick={discardCandidate}><X size={15} /></button>
              </div>}
              <div className="segmented template-switch" aria-label="网页样式">
                {TEMPLATE_OPTIONS.map((template) => <button className={!candidateDesign && data.templateId === template.id ? 'active' : ''} type="button" key={template.id} onClick={() => selectTemplate(template.id)}>{template.label}</button>)}
                {data.generatedDesign && <button className={!candidateDesign && data.templateId === 'generated' ? 'active' : ''} type="button" onClick={() => selectTemplate('generated')}>AI 生成</button>}
              </div>
              <div className="segmented" aria-label="预览尺寸"><button className={previewMode === 'desktop' ? 'active' : ''} type="button" title="桌面预览" onClick={() => setPreviewMode('desktop')}><Monitor size={16} /><span>桌面</span></button><button className={previewMode === 'mobile' ? 'active' : ''} type="button" title={generatedPreview ? 'AI 生成页面首版仅支持桌面预览' : '手机预览'} disabled={generatedPreview} onClick={() => setPreviewMode('mobile')}><Smartphone size={16} /><span>手机</span></button></div>
            </div>
          </div>
          <div className="preview-stage" ref={previewStageRef}><iframe key={`${previewMode}-${candidateView}-${previewData.templateId}`} className={`preview-frame ${previewMode}`} title={`${previewData.templateId === 'generated' ? 'AI 生成' : TEMPLATE_OPTIONS.find((template) => template.id === previewData.templateId)?.label ?? '主页'}预览`} srcDoc={previewHtml} sandbox="allow-scripts allow-popups" /></div>
        </section>
      </main>

      <section className="ai-panel" aria-label="AI 对话">
        <div className="ai-panel-heading">
          <div className="ai-panel-title"><span><Sparkles size={18} /></span><div><strong>AI 对话</strong><small>截图与修改要求</small></div></div>
          <span className={`ai-connection-state ${apiKey.trim() ? 'ready' : 'local'}`}>{isGenerating ? (generationStage === 'validating' ? '安全检查' : '生成中') : apiKey.trim() ? 'AI 接口就绪' : '本地验收'}</span>
        </div>
        <div className="ai-panel-body">
          <div className="ai-image-input">
            <div className="segmented ai-image-intent" aria-label="图片用途">
              <button className={imageIntent === 'reference' ? 'active' : ''} type="button" onClick={() => setImageIntent('reference')}>参考样例</button>
              <button className={imageIntent === 'target' ? 'active' : ''} type="button" onClick={() => setImageIntent('target')}>待修改页面</button>
            </div>
            <div className={`ai-screenshot ${isDraggingImage ? 'dragging' : ''}`} onDragEnter={() => setIsDraggingImage(true)} onDragLeave={() => setIsDraggingImage(false)} onDragOver={(event) => event.preventDefault()} onDrop={handleImageDrop}>
              {attachments.length ? <div className="ai-attachments">{attachments.map((attachment) => <div className="ai-attachment" key={attachment.id}>
                <img src={attachment.src} alt="上传图片预览" />
                <div className="ai-screenshot-meta"><strong title={attachment.name}>{attachment.name}</strong><span>{attachment.intent === 'reference' ? '参考样例' : '待修改页面'}</span></div>
                <button className="icon-button compact danger" type="button" title="移除图片" onClick={() => setAttachments((previous) => previous.filter((item) => item.id !== attachment.id))}><Trash2 size={15} /></button>
              </div>)}</div> : <div className="ai-screenshot-empty"><ImagePlus size={20} /><div><strong>添加图片</strong><span>选择或拖入图片</span></div></div>}
              {attachments.length < 3 && <label className="icon-button compact ai-add-image" title="继续添加图片"><Plus size={15} /><input type="file" accept="image/*" multiple onChange={handleImageInput} /></label>}
              {!attachments.length && <label className="ai-screenshot-hitarea"><input type="file" accept="image/*" multiple onChange={handleImageInput} /></label>}
            </div>
          </div>
          <div className="ai-composer">
            <textarea value={aiPrompt} maxLength={2000} onChange={(event) => setAiPrompt(event.target.value)} aria-label="修改要求" placeholder="描述希望调整的版式、颜色、章节节奏或视觉重点" />
            <div className="ai-composer-footer">
              <div className="ai-composer-meta">
                <label className="ai-key-field" title="仅保存在当前运行内存"><KeyRound size={14} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onPaste={(event) => { event.preventDefault(); setApiKey(event.clipboardData.getData('text').trim()) }} aria-label="OpenAI API Key" autoComplete="off" spellCheck={false} placeholder="API Key（本次运行）" /></label>
                <button className="icon-button compact ai-paste-key" type="button" title="从剪贴板粘贴 API Key" aria-label="从剪贴板粘贴 API Key" onClick={pasteApiKey}><ClipboardPaste size={15} /></button>
                <button className="icon-button compact ai-settings-button" type="button" title="配置 OpenAI 兼容接口" onClick={openAiSettings}><Settings2 size={15} /></button>
                <span>{aiPrompt.length}/2000 · {attachments.length}/3 张</span>
              </div>
              <button className="primary-button" type="button" disabled={isGenerating || (!aiPrompt.trim() && !attachments.length)} onClick={handleGenerateCandidate}><Send size={16} />{isGenerating ? generationStage === 'validating' ? '检查中' : '生成中' : apiKey.trim() ? '生成候选' : '本地候选'}</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '候选页面生成失败。'
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
