import { useCallback, useRef, useState } from 'react'
import { FileAudio, Upload } from 'lucide-react'

interface Props {
  onSubmit: (file: File, outputFormat: 'txt' | 'md', summarize: boolean) => void
  disabled: boolean
}

export function UploadCard({ onSubmit, disabled }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [outputFormat, setOutputFormat] = useState<'txt' | 'md'>('txt')
  const [summarize, setSummarize] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => setFile(f)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [])

  const handleSubmit = () => {
    if (file) onSubmit(file, outputFormat, summarize)
  }

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-6">
      <div
        className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors
          ${dragging ? 'border-violet-500 bg-violet-50' : 'border-zinc-300 hover:border-violet-400 bg-zinc-50'}
          ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {file ? (
          <>
            <FileAudio className="text-violet-500" size={36} />
            <p className="text-sm font-medium text-zinc-700">{file.name}</p>
            <p className="text-xs text-zinc-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </>
        ) : (
          <>
            <Upload className="text-zinc-400" size={36} />
            <p className="text-sm text-zinc-500">Drop audio file here or click to browse</p>
            <p className="text-xs text-zinc-400">MP3, WAV, M4A, OGG, FLAC, WebM</p>
          </>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Mode</label>
          <div className="flex rounded-xl border border-zinc-200 overflow-hidden">
            {(['Transcription only', 'Transcription + Summary'] as const).map((label, i) => (
              <button
                key={label}
                onClick={() => setSummarize(i === 1)}
                className={`flex-1 py-2 text-sm font-medium transition-colors
                  ${summarize === (i === 1)
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Format</label>
          <div className="flex rounded-xl border border-zinc-200 overflow-hidden">
            {(['txt', 'md'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setOutputFormat(fmt)}
                className={`px-4 py-2 text-sm font-medium transition-colors
                  ${outputFormat === fmt
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
              >
                {fmt === 'txt' ? 'TXT' : 'Markdown'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!file || disabled}
        className="w-full py-3 rounded-xl bg-violet-600 text-white font-semibold text-sm
          hover:bg-violet-700 active:bg-violet-800 transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Start Processing
      </button>
    </div>
  )
}
