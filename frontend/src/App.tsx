import { useEffect, useState } from 'react'
import { Mic, Loader2 } from 'lucide-react'
import { UploadCard } from './components/UploadCard'
import type { OutputFormat } from './types'
import { ProgressBar } from './components/ProgressBar'
import { DownloadPanel } from './components/DownloadPanel'

const API = import.meta.env.VITE_API_URL

const AppState = {
  Loading: 'loading',
  Idle: 'idle',
  Processing: 'processing',
  Complete: 'complete',
  Error: 'error',
} as const

type AppStateType = typeof AppState[keyof typeof AppState]

export default function App() {
  const [appState, setAppState] = useState<AppStateType>(AppState.Loading)
  const [jobId, setJobId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let timer: number
    let cancelled = false

    const pollHealth = async () => {
      try {
        const res = await fetch(`${API}/health`)
        const data = await res.json()
        if (data.status === 'ready' && !cancelled) {
          setAppState(AppState.Idle)
          return
        }
      } catch {
        // server not up yet
      }
      if (!cancelled) timer = setTimeout(pollHealth, 2000)
    }
    pollHealth()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const handleSubmit = async (
    file: File,
    outputFormat: OutputFormat,
    summarize: boolean,
  ) => {
    setErrorMsg(null)
    const form = new FormData()
    form.append('audio', file)
    form.append('output_format', outputFormat)
    form.append('summarize', String(summarize))

    try {
      const res = await fetch(`${API}/transcribe`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json()
        const detail = err.detail
        let message = 'Upload failed'
        
        if (typeof detail === 'string') message = detail
        else if (Array.isArray(detail)) message = detail.map((e: { msg: string }) => e.msg).join(', ')

        throw new Error(message)
      }
      const data = await res.json()
      setJobId(data.job_id)
      setAppState(AppState.Processing)
    } catch (e: any) {
      setErrorMsg(e?.message || 'Upload failed')
      setAppState(AppState.Error)
    }
  }

  const handleReset = () => {
    setJobId(null)
    setErrorMsg(null)
    setAppState(AppState.Idle)
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl flex flex-col items-center gap-8">

        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-12 h-12 rounded-2xl bg-violet-600 flex items-center justify-center shadow-lg">
            <Mic size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Local Transcriber</h1>
          <p className="text-sm text-zinc-500">Private, on-device audio transcription. Nothing leaves your machine.</p>
        </div>

        {appState === AppState.Loading && (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <Loader2 size={28} className="animate-spin text-violet-500" />
            <p className="text-sm">Loading models — this may take a minute...</p>
          </div>
        )}

        {appState === AppState.Idle && (
          <UploadCard onSubmit={handleSubmit} disabled={false} />
        )}

        {appState === AppState.Error && (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 w-full text-center">
              {errorMsg}
            </div>
            <button
              onClick={handleReset}
              className="text-sm text-zinc-500 hover:text-zinc-700 underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}

        {appState === AppState.Processing && jobId && (
          <ProgressBar
            jobId={jobId}
            onComplete={() => setAppState(AppState.Complete)}
            onError={(msg) => { setErrorMsg(msg); setAppState(AppState.Error) }}
          />
        )}

        {appState === AppState.Complete && jobId && (
          <DownloadPanel jobId={jobId} onReset={handleReset} />
        )}

      </div>
    </div>
  )
}
