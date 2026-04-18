import { useEffect, useState } from 'react'
import { Mic, Loader2 } from 'lucide-react'
import { UploadCard } from './components/UploadCard'
import { ProgressBar } from './components/ProgressBar'
import { DownloadPanel } from './components/DownloadPanel'

const API = import.meta.env.VITE_API_URL

type AppState = 'loading' | 'idle' | 'processing' | 'complete' | 'error'

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading')
  const [jobId, setJobId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    const pollHealth = async () => {
      try {
        const res = await fetch(`${API}/health`)
        const data = await res.json()
        if (data.status === 'ready') {
          setAppState('idle')
          return
        }
      } catch {
        // server not up yet
      }
      setTimeout(pollHealth, 2000)
    }
    pollHealth()
  }, [])

  const handleSubmit = async (
    file: File,
    outputFormat: 'txt' | 'md',
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
        const message = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((e: { msg: string }) => e.msg).join(', ')
            : 'Upload failed'
        throw new Error(message)
      }
      const data = await res.json()
      setJobId(data.job_id)
      setAppState('processing')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed')
      setAppState('error')
    }
  }

  const handleReset = () => {
    setJobId(null)
    setErrorMsg(null)
    setAppState('idle')
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

        {appState === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <Loader2 size={28} className="animate-spin text-violet-500" />
            <p className="text-sm">Loading models — this may take a minute...</p>
          </div>
        )}

        {appState === 'idle' && (
          <UploadCard onSubmit={handleSubmit} disabled={false} />
        )}

        {appState === 'error' && (
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

        {appState === 'processing' && jobId && (
          <ProgressBar
            jobId={jobId}
            onComplete={() => setAppState('complete')}
            onError={(msg) => { setErrorMsg(msg); setAppState('error') }}
          />
        )}

        {appState === 'complete' && jobId && (
          <DownloadPanel jobId={jobId} onReset={handleReset} />
        )}

      </div>
    </div>
  )
}
