import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { btn, input } from '../components/ui'
import { useApp } from '../lib/AppContext'

export default function Scan() {
  const video = useRef<HTMLVideoElement>(null)
  const nav = useNavigate()
  const { items } = useApp()
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [manual, setManual] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const go = (code: string) => {
    const c = code.trim()
    if (!c) return
    const hit = itemsRef.current.find((i) => i.barcode === c)
    nav(hit ? `/item/${hit.id}` : `/new/${encodeURIComponent(c)}`)
  }

  useEffect(() => {
    let controls: IScannerControls | undefined
    let done = false
    const reader = new BrowserMultiFormatReader()
    reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current!, (res) => {
      if (res && !done) { done = true; controls?.stop(); go(res.getText()) }
    }).then((c) => { controls = c; if (done) c.stop() })
      .catch((e) => setErr(`Camera unavailable: ${e?.message ?? e}`))
    return () => { done = true; controls?.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen">
      <Header title="Scan" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <p className="text-sm text-slate-400">Point your camera at a barcode or QR code</p>
        <video ref={video} className="aspect-[3/4] w-full rounded-xl bg-black object-cover" muted playsInline />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <form onSubmit={(e) => { e.preventDefault(); go(manual) }} className="space-y-2">
          <label className="text-sm text-slate-300">Or enter manually</label>
          <input className={input} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Barcode" />
          <button className={`${btn} w-full`}>Continue</button>
        </form>
      </main>
    </div>
  )
}
