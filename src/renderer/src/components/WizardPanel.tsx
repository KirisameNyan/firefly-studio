/** First-time wizard: SiteIdentity in three steps, then wizard.apply with a written result card. */
import { useState } from 'react'
import type { SiteIdentity, SocialLink, WriteResult } from '@shared/contract'
import type { StudioApi } from '../../../preload/api'
import { errorMessage, normalizeWriteResult } from '../data/normalize'
import type { DataSource } from '../data/source'
import DiffView from './DiffView'

const LANGS = ['zh_CN', 'zh_TW', 'en', 'ja', 'ru', 'ko']
const PLATFORMS = ['github', 'x', 'mastodon', 'bilibili', 'email', 'rss', 'telegram', 'website']

export type WizardPanelProps = {
  api: StudioApi
  source: DataSource
}

export default function WizardPanel({ api, source }: WizardPanelProps) {
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [lang, setLang] = useState('zh_CN')
  const [siteUrl, setSiteUrl] = useState('')
  const [startDate, setStartDate] = useState('')
  const [author, setAuthor] = useState('')
  const [bio, setBio] = useState('')
  const [avatar, setAvatar] = useState('')
  const [social, setSocial] = useState<SocialLink[]>([{ platform: 'github', url: '' }])
  const [themeHue, setThemeHue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WriteResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const identity: SiteIdentity = { title: title.trim(), author: author.trim() }
  if (subtitle.trim()) identity.subtitle = subtitle.trim()
  if (lang) identity.lang = lang
  if (siteUrl.trim()) identity.siteUrl = siteUrl.trim()
  if (bio.trim()) identity.bio = bio.trim()
  if (avatar.trim()) identity.avatar = avatar.trim()
  if (startDate) identity.startDate = startDate
  const links = social.filter((link) => link.platform && link.url.trim())
  if (links.length) identity.social = links.map((link) => ({ platform: link.platform, url: link.url.trim() }))
  if (themeHue.trim() && Number.isFinite(Number(themeHue))) identity.themeHue = Number(themeHue)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      setResult(normalizeWriteResult(await api.wizard.apply(source.root, identity)))
    } catch (error) {
      setFailure(errorMessage(error))
      setResult({ ok: false, changed: [], diffs: [], errors: [{ path: '', message: errorMessage(error) }] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel wizard" data-testid="wizard-panel" data-wizard-step={step}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">首次站点向导</h2>
          <p className="panel-sub">三屏填完站点身份信息；所有项都可以留空，留空即使用占位提示而不写入。</p>
        </div>
        <div className="steps" data-testid="wizard-steps">
          {['站点信息', '作者与社交', '主题与提交'].map((label, index) => (
            <button
              key={label}
              type="button"
              className={'step' + (index === step ? ' is-active' : '') + (index < step ? ' is-done' : '')}
              data-step-index={index}
              onClick={() => setStep(index)}
            >
              {index + 1}. {label}
            </button>
          ))}
        </div>
      </header>

      {step === 0 && (
        <div className="wizard-body" data-testid="wizard-step-0">
          <label className="wz-field">
            <span>站点名称</span>
            <input className="control" placeholder="例如：Firefly" value={title} data-testid="wz-title" onChange={(event) => setTitle(event.target.value)} />
            <small>写入 siteConfig.title</small>
          </label>
          <label className="wz-field">
            <span>副标题</span>
            <input className="control" placeholder="例如：Demo site" value={subtitle} data-testid="wz-subtitle" onChange={(event) => setSubtitle(event.target.value)} />
            <small>写入 siteConfig.subtitle</small>
          </label>
          <label className="wz-field">
            <span>站点语言</span>
            <select className="control" value={lang} data-testid="wz-lang" onChange={(event) => setLang(event.target.value)}>
              {LANGS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <small>写入 SITE_LANG（const 字面量）</small>
          </label>
          <label className="wz-field">
            <span>站点 URL</span>
            <input className="control" placeholder="https://example.com" value={siteUrl} data-testid="wz-site-url" onChange={(event) => setSiteUrl(event.target.value)} />
            <small>写入 siteConfig.site_url</small>
          </label>
          <label className="wz-field">
            <span>建站日期</span>
            <input type="date" className="control" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <small>用于页脚版权年份区间</small>
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-body" data-testid="wizard-step-1">
          <label className="wz-field">
            <span>作者名</span>
            <input className="control" placeholder="例如：Neko" value={author} data-testid="wz-author" onChange={(event) => setAuthor(event.target.value)} />
            <small>写入 profileConfig.name</small>
          </label>
          <label className="wz-field">
            <span>个人简介</span>
            <textarea className="control" rows={3} placeholder="一两句话介绍自己" value={bio} data-testid="wz-bio" onChange={(event) => setBio(event.target.value)} />
            <small>写入 profileConfig.bio</small>
          </label>
          <label className="wz-field">
            <span>头像路径</span>
            <input className="control" placeholder="/images/avatar.webp" value={avatar} onChange={(event) => setAvatar(event.target.value)} />
            <small>public/ 下的相对路径</small>
          </label>
          <div className="wz-field">
            <span>社交链接</span>
            {social.map((link, index) => (
              <div className="social-row" key={index}>
                <select
                  className="control"
                  value={link.platform}
                  data-testid={'wz-social-platform-' + index}
                  onChange={(event) =>
                    setSocial((current) =>
                      current.map((item, position) => (position === index ? { ...item, platform: event.target.value } : item)),
                    )
                  }
                >
                  {PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform}
                    </option>
                  ))}
                </select>
                <input
                  className="control"
                  placeholder="https://github.com/yourname"
                  value={link.url}
                  data-testid={'wz-social-url-' + index}
                  onChange={(event) =>
                    setSocial((current) =>
                      current.map((item, position) => (position === index ? { ...item, url: event.target.value } : item)),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="wz-social-remove"
                  onClick={() => setSocial((current) => current.filter((_item, position) => position !== index))}
                >
                  删除
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost" data-testid="wz-social-add" onClick={() => setSocial((current) => [...current, { platform: 'github', url: '' }])}>
              + 添加社交链接
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-body" data-testid="wizard-step-2">
          <label className="wz-field">
            <span>主题色相（0-360）</span>
            <input
              className="control"
              placeholder="留空则不修改（Firefly 默认 165）"
              value={themeHue}
              data-testid="wz-theme-hue"
              onChange={(event) => setThemeHue(event.target.value)}
            />
            <small>写入 siteConfig.themeColor.hue</small>
          </label>
          {themeHue.trim() && Number.isFinite(Number(themeHue)) && (
            <div className="hue-preview" data-testid="wz-hue-preview">
              <span className="hue-swatch" style={{ background: 'hsl(' + Number(themeHue) + ' 70% 50%)' }} />
              <span>hsl({Number(themeHue)} 70% 50%)</span>
            </div>
          )}
          <div className="wz-summary">
            <h3 className="section-title">将提交的 SiteIdentity</h3>
            <pre data-testid="wizard-identity-json">{JSON.stringify(identity, null, 2)}</pre>
            <p className="muted">具体写哪些文件由 core 的 wizard.apply 决定；下方结果区会给出 changed 与 diff。</p>
          </div>
          <button type="button" className="btn btn-primary" data-testid="wizard-apply" disabled={busy} onClick={() => void submit()}>
            {busy ? '提交中…' : '完成并写入'}
          </button>
        </div>
      )}

      <footer className="wizard-foot">
        <button type="button" className="btn btn-ghost" data-testid="wizard-prev" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>
          上一步
        </button>
        <button type="button" className="btn" data-testid="wizard-next" disabled={step === 2} onClick={() => setStep((current) => Math.min(2, current + 1))}>
          下一步
        </button>
      </footer>

      {result && (
        <div className="wizard-result" data-testid="wizard-result" data-ok={String(result.ok)}>
          {result.ok ? (
            <p className="notice notice-ok">
              <strong>向导写入成功</strong>：{result.changed.length} 个文件
              {result.changed.length > 0 && <span className="muted">（{result.changed.join('、')}）</span>}
            </p>
          ) : (
            <p className="notice notice-error">
              <strong>向导写入失败</strong>（ok:false，未修改任何文件）
              <ul data-testid="wizard-errors">
                {result.errors.map((error, index) => (
                  <li key={index}>
                    <code>{error.path || '(未提供路径)'}</code> — {error.message}
                  </li>
                ))}
              </ul>
            </p>
          )}
          {result.diffs.length > 0 && <DiffView diffs={result.diffs} view="backend" />}
        </div>
      )}
      {failure && <p className="notice notice-error">{failure}</p>}
    </section>
  )
}
