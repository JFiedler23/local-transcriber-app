import { useState } from 'react'
import { Download, CheckCircle, RotateCcw } from 'lucide-react'

const API = import.meta.env.VITE_API_URL

interface Props {
  jobId: string
  onReset: () => void
}

export function DownloadPanel({ jobId, onReset }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch(`${API}/download/${jobId}`)
      if (!res.ok) throw new Error('Download failed')

      const disposition = res.headers.get('content-disposition') ?? ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] ?? 'output.txt'

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      setDownloaded(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-5">
      <div className="flex items-center gap-2 text-emerald-600">
        <CheckCircle size={20} />
        <span className="font-semibold">Processing complete</span>
      </div>

      {!downloaded ? (
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm
            hover:bg-emerald-700 active:bg-emerald-800 transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={16} />
          {downloading ? 'Downloading...' : 'Download'}
        </button>
      ) : (
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-100 text-zinc-700 font-semibold text-sm
            hover:bg-zinc-200 transition-colors"
        >
          <RotateCcw size={16} />
          Start over
        </button>
      )}
    </div>
  )
}
