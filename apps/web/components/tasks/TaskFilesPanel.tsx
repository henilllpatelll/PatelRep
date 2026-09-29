'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Camera, File as FileIcon, Paperclip } from 'lucide-react'
import { evidenceApi, type EvidenceRecord } from '@/lib/api/evidence'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

function recordName(record: EvidenceRecord, t: ReturnType<typeof useTranslation>['t']): string {
  return record.collector_profile?.preferred_name ?? record.collector_profile?.full_name ?? t('tasks.detail.unknownAuthor')
}

/** Files/Evidence tab — reuses the existing evidence_records system (label + optional
 * file, tenant-scoped signed URLs) scoped to this task via related_entity_type='task'.
 * No parallel attachment system. */
export function TaskFilesPanel({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingKind, setUploadingKind] = useState<'photo' | 'file' | null>(null)

  const queryKey = ['task-evidence', taskId]
  const { data: records = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => evidenceApi.listRecords({ related_entity_type: 'task', related_entity_id: taskId }),
    select: (res) => res.data ?? [],
  })

  const { mutate: uploadEvidence } = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: 'photo' | 'file' }) => {
      const { data: record } = await evidenceApi.createRecord({
        label: file.name,
        evidence_type: kind,
        related_entity_type: 'task',
        related_entity_id: taskId,
      })
      return evidenceApi.uploadRecordFile(record.id, file)
    },
    onSuccess: () => { toast.success(t('tasks.detail.files.uploaded')); queryClient.invalidateQueries({ queryKey }) },
    onError: () => toast.error(t('tasks.detail.files.uploadFailed')),
    onSettled: () => setUploadingKind(null),
  })

  function handleFileSelected(kind: 'photo' | 'file', event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingKind(kind)
    uploadEvidence({ file, kind })
  }

  async function openRecord(record: EvidenceRecord) {
    try {
      const { data } = await evidenceApi.getRecordFileUrl(record.id)
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error(t('tasks.detail.files.openFailed'))
    }
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex gap-2">
        <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFileSelected('photo', e)} />
        <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => handleFileSelected('file', e)} />
        <Button variant="outline" size="sm" loading={uploadingKind === 'photo'} onClick={() => photoInputRef.current?.click()} className="gap-1.5">
          <Camera size={14} />{t('tasks.detail.files.addPhoto')}
        </Button>
        <Button variant="outline" size="sm" loading={uploadingKind === 'file'} onClick={() => fileInputRef.current?.click()} className="gap-1.5">
          <Paperclip size={14} />{t('tasks.detail.files.addFile')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-ink3">{t('common.loading')}</p>
      ) : records.length === 0 ? (
        <p className="text-xs italic text-ink3">{t('tasks.detail.files.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {records.map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => openRecord(record)}
              aria-label={t('tasks.detail.files.openAria', { name: record.file_name ?? record.label })}
              className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--line)] bg-surface-2 px-3 py-2 text-left text-sm hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <span className="shrink-0 text-ink3">{record.evidence_type === 'photo' ? <Camera size={15} /> : <FileIcon size={15} />}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{record.file_name ?? record.label}</span>
              <span className="shrink-0 text-xs text-ink3">
                {record.collected_at && new Date(record.collected_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {record.collected_by ? ` · ${recordName(record, t)}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
