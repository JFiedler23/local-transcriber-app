import { useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'

const API = import.meta.env.VITE_API_URL

type JobStatus = 'queued' | 'transcribing' | 'summarizing' | 'complete' | 'error'

interface StatusResponse {
  job_id: string
  status: JobStatus
  progress: number
  error: string | null
}

interface Props {
  jobId: string
  onComplete: () => void
  onError: (msg: string) => void
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Queued — waiting for previous job to finish...',
  transcribing: 'Transcribing audio...',
  summarizing: 'Summarizing transcript...',
  complete: 'Complete',
  error: 'Error',
}

export function ProgressBar({ jobId, onComplete, onError }: Props) {
  const [status, setStatus] = useState<JobStatus>('queued')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`${API}/status/${jobId}`)
        if (cancelled) return
        if (!res.ok) {
          onError('Job not found')
          return
        }
        const data: StatusResponse = await res.json()
        if (cancelled) return
        setStatus(data.status)
        setProgress(data.progress)

        if (data.status === 'complete') {
          onComplete()
          return
        }
        if (data.status === 'error') {
          setErrorMsg(data.error ?? 'Unknown error')
          onError(data.error ?? 'Unknown error')
          return
        }

        timer = setTimeout(poll, 2000)
      } catch {
        if (!cancelled) timer = setTimeout(poll, 3000)
      }
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [jobId])

  if (status === 'error') {
    return (
      <div className="flex items-center gap-3 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
        <AlertCircle size={18} />
        <span className="text-sm font-medium">{errorMsg}</span>
      </div>
    )
  }

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-3">
      <div className="flex items-center gap-2 text-zinc-600">
        <Loader2 size={16} className="animate-spin text-violet-500" />
        <span className="text-sm font-medium">{STATUS_LABELS[status]}</span>
        {progress > 0 && (
          <span className="ml-auto text-sm text-zinc-400">{progress}%</span>
        )}
      </div>
      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
        {progress === 0 && (status === 'transcribing' || status === 'summarizing') ? (
          <div className="h-full w-1/3 bg-violet-400 rounded-full animate-pulse origin-left" />
        ) : (
          <div
            className="h-full bg-violet-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        )}
      </div>
    </div>
  )
}
