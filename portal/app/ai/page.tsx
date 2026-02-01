'use client'
import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { aiApi, KnowledgeItem } from '@/lib/api/ai'

interface LeadScoreInput {
  budget: string
  askedAboutPrice: boolean
  messageCount: number
}

export default function AIPage() {
  const { user } = useAuth()
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatMessage, setChatMessage] = useState('')
  const [chatResponse, setChatResponse] = useState<string | null>(null)
  const [scoreInput, setScoreInput] = useState<LeadScoreInput>({
    budget: '',
    askedAboutPrice: false,
    messageCount: 1
  })
  const [scoreResult, setScoreResult] = useState<string | null>(null)

  const canLoad = !!user?.clientId

  useEffect(() => {
    const load = async () => {
      if (!user?.clientId) return
      try {
        setLoading(true)
        const data = await aiApi.getKnowledgeBase(user.clientId)
        setKnowledgeBase(data || [])
      } catch (err) {
        setError('تعذر تحميل قاعدة المعرفة')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.clientId])

  const handleAddItem = () => {
    setKnowledgeBase((prev) => [...prev, { category: '', question: '', answer: '' }])
  }

  const handleUpdateItem = (index: number, field: keyof KnowledgeItem, value: string) => {
    setKnowledgeBase((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    )
  }

  const handleRemoveItem = (index: number) => {
    setKnowledgeBase((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleSave = async () => {
    if (!user?.clientId) return
    try {
      setSaving(true)
      setError(null)
      await aiApi.updateKnowledgeBase(user.clientId, knowledgeBase)
    } catch (err) {
      setError('تعذر حفظ قاعدة المعرفة')
    } finally {
      setSaving(false)
    }
  }

  const handleChat = async () => {
    if (!user?.clientId || !chatMessage.trim()) return
    try {
      setError(null)
      const response = await aiApi.chat(user.clientId, chatMessage, {
        name: user.name
      })
      setChatResponse(response.answer)
    } catch (err) {
      setError('تعذر تشغيل رد الذكاء الاصطناعي')
    }
  }

  const handleScore = async () => {
    if (!user?.clientId) return
    try {
      setError(null)
      const result = await aiApi.scoreLead(user.clientId, {
        budget: scoreInput.budget,
        askedAboutPrice: scoreInput.askedAboutPrice,
        messageCount: scoreInput.messageCount
      })
      setScoreResult(`${result.score} (${result.rationale || ''})`)
    } catch (err) {
      setError('تعذر تقييم العميل')
    }
  }

  const isEmpty = useMemo(() => knowledgeBase.length === 0, [knowledgeBase.length])

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
            <h1 className="text-3xl font-bold text-slate-800">الذكاء الاصطناعي</h1>
            <p className="text-slate-500 mt-1">إدارة قاعدة المعرفة وتجربة الردود</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">قاعدة المعرفة</h2>
              <div className="flex gap-2">
                <button
                  onClick={handleAddItem}
                  className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  إضافة سؤال
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
                </button>
              </div>
            </div>

            {isEmpty && (
              <div className="text-slate-500">لا توجد عناصر بعد. أضف أول سؤال.</div>
            )}

            <div className="space-y-4">
              {knowledgeBase.map((item, index) => (
                <div key={index} className="border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      value={item.category}
                      onChange={(event) => handleUpdateItem(index, 'category', event.target.value)}
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="التصنيف"
                    />
                    <input
                      value={item.question}
                      onChange={(event) => handleUpdateItem(index, 'question', event.target.value)}
                      className="border rounded-lg px-3 py-2 text-sm md:col-span-2"
                      placeholder="السؤال"
                    />
                  </div>
                  <textarea
                    value={item.answer}
                    onChange={(event) => handleUpdateItem(index, 'answer', event.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    rows={2}
                    placeholder="الإجابة"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleRemoveItem(index)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">تجربة الرد</h2>
              <textarea
                value={chatMessage}
                onChange={(event) => setChatMessage(event.target.value)}
                rows={3}
                className="border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="أدخل سؤال العميل هنا"
              />
              <button
                onClick={handleChat}
                disabled={!chatMessage.trim() || !canLoad}
                className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
              >
                تشغيل
              </button>
              {chatResponse && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-700">
                  {chatResponse}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">تقييم العميل</h2>
              <input
                value={scoreInput.budget}
                onChange={(event) => setScoreInput((prev) => ({ ...prev, budget: event.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="الميزانية"
              />
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={scoreInput.askedAboutPrice}
                  onChange={(event) =>
                    setScoreInput((prev) => ({ ...prev, askedAboutPrice: event.target.checked }))
                  }
                />
                <span className="text-sm text-slate-600">سأل عن السعر</span>
              </div>
              <input
                type="number"
                min={1}
                value={scoreInput.messageCount}
                onChange={(event) =>
                  setScoreInput((prev) => ({ ...prev, messageCount: Number(event.target.value) }))
                }
                className="border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="عدد الرسائل"
              />
              <button
                onClick={handleScore}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900"
              >
                تقييم
              </button>
              {scoreResult && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-700">
                  {scoreResult}
                </div>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  )
}
