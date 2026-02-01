'use client'
import { useEffect, useState } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { automationApi, AutomationSequence, AutomationStep } from '@/lib/api/automation'

export default function AutomationPage() {
  const { user } = useAuth()
  const [sequences, setSequences] = useState<AutomationSequence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<AutomationStep[]>([{ delayMinutes: 0, message: '' }])
  const [enrollLeadId, setEnrollLeadId] = useState('')
  const [enrollSequenceId, setEnrollSequenceId] = useState('')

  const loadSequences = async () => {
    if (!user?.clientId) return
    try {
      setLoading(true)
      const items = await automationApi.listSequences(user.clientId)
      setSequences(items)
    } catch (err) {
      setError('تعذر تحميل التسلسلات')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSequences()
  }, [user?.clientId])

  const handleAddStep = () => {
    setSteps((prev) => [...prev, { delayMinutes: 0, message: '' }])
  }

  const handleUpdateStep = (index: number, field: keyof AutomationStep, value: string) => {
    setSteps((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              [field]: field === 'delayMinutes' ? Number(value) : value
            }
          : item
      )
    )
  }

  const handleRemoveStep = (index: number) => {
    setSteps((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleCreate = async () => {
    if (!user?.clientId) return
    if (!name.trim()) {
      setError('يرجى إدخال اسم التسلسل')
      return
    }
    if (steps.some((step) => !step.message.trim())) {
      setError('يرجى تعبئة نص الرسالة لكل خطوة')
      return
    }

    try {
      setError(null)
      setSuccess(null)
      await automationApi.createSequence(user.clientId, { name, steps })
      setName('')
      setSteps([{ delayMinutes: 0, message: '' }])
      setSuccess('تم إنشاء التسلسل بنجاح')
      await loadSequences()
    } catch (err) {
      setError('تعذر إنشاء التسلسل')
    }
  }

  const handleToggle = async (sequence: AutomationSequence) => {
    if (!user?.clientId) return
    await automationApi.updateSequence(user.clientId, sequence.id, { isActive: !sequence.isActive })
    await loadSequences()
  }

  const handleDelete = async (sequenceId: string) => {
    if (!user?.clientId) return
    await automationApi.deleteSequence(user.clientId, sequenceId)
    await loadSequences()
  }

  const handleEnroll = async () => {
    if (!user?.clientId) return
    if (!enrollLeadId || !enrollSequenceId) {
      setError('يرجى اختيار العميل والتسلسل')
      return
    }
    try {
      setError(null)
      setSuccess(null)
      await automationApi.enrollLead(user.clientId, Number(enrollLeadId), enrollSequenceId)
      setEnrollLeadId('')
      setEnrollSequenceId('')
      setSuccess('تم تسجيل العميل في التسلسل')
    } catch (err) {
      setError('تعذر تسجيل العميل في التسلسل')
    }
  }

  const handleRunNow = async () => {
    if (!user?.clientId) return
    try {
      setError(null)
      const result = await automationApi.runNow(user.clientId)
      setSuccess(`تم تنفيذ ${result.processed} رسالة مجدولة`)
    } catch (err) {
      setError('تعذر تشغيل الجدولة')
    }
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <DashboardLayout>
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <DashboardLayout>
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">الأتمتة</h1>
            <p className="text-slate-500 mt-1">صمم تسلسلات متابعة ورسائل تلقائية</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3">
              {success}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">إنشاء تسلسل جديد</h2>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border rounded-lg px-3 py-2 text-sm w-full"
              placeholder="اسم التسلسل"
            />

            <div className="space-y-3">
              {steps.map((step, index) => (
                <div key={index} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={step.delayMinutes}
                      onChange={(event) => handleUpdateStep(index, 'delayMinutes', event.target.value)}
                      className="border rounded-lg px-3 py-2 text-sm w-28"
                      placeholder="دقائق"
                    />
                    <span className="text-sm text-slate-500">دقيقة بعد التسجيل</span>
                    {steps.length > 1 && (
                      <button
                        onClick={() => handleRemoveStep(index)}
                        className="text-sm text-red-600"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                  <textarea
                    value={step.message}
                    onChange={(event) => handleUpdateStep(index, 'message', event.target.value)}
                    rows={2}
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="نص الرسالة"
                  />
                </div>
              ))}
              <button
                onClick={handleAddStep}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700"
              >
                إضافة خطوة
              </button>
            </div>

            <button
              onClick={handleCreate}
              className="px-4 py-2 rounded-lg bg-primary text-white"
            >
              إنشاء التسلسل
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">التسلسلات الحالية</h2>
              <button
                onClick={handleRunNow}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white"
              >
                تشغيل الآن
              </button>
            </div>

            {sequences.length === 0 ? (
              <div className="text-slate-500">لا توجد تسلسلات بعد.</div>
            ) : (
              <div className="space-y-3">
                {sequences.map((sequence) => (
                  <div key={sequence.id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-800">{sequence.name}</div>
                        <div className="text-sm text-slate-500">خطوات: {sequence.steps.length}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggle(sequence)}
                          className="text-sm px-3 py-1 rounded-lg border"
                        >
                          {sequence.isActive ? 'إيقاف' : 'تفعيل'}
                        </button>
                        <button
                          onClick={() => handleDelete(sequence.id)}
                          className="text-sm text-red-600"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">تسجيل عميل في تسلسل</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={enrollLeadId}
                onChange={(event) => setEnrollLeadId(event.target.value)}
                className="border rounded-lg px-3 py-2 text-sm"
                placeholder="رقم العميل (Lead ID)"
              />
              <select
                value={enrollSequenceId}
                onChange={(event) => setEnrollSequenceId(event.target.value)}
                className="border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">اختر التسلسل</option>
                {sequences.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>
                    {sequence.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleEnroll}
                className="px-4 py-2 rounded-lg bg-primary text-white"
              >
                تسجيل
              </button>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  )
}
