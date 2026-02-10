'use client'
import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { leadsApi, AdvancedAnalytics } from '@/lib/api/leads'
import { analyticsApi, AnalyticsUploadRecord } from '@/lib/api/analytics'

export default function AdvancedAnalyticsPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AdvancedAnalytics | null>(null)
  const [uploads, setUploads] = useState<AnalyticsUploadRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dataType, setDataType] = useState('general')
  const [notes, setNotes] = useState('')
  const [suggestions, setSuggestions] = useState<string[] | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user?.clientId) return
      try {
        setLoading(true)
        const analytics = await leadsApi.getAdvancedAnalytics(user.clientId)
        setData(analytics)
        const uploadsList = await analyticsApi.listUploads(user.clientId)
        setUploads(uploadsList)
      } catch (err) {
        setError('تعذر تحميل التحليلات المتقدمة')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.clientId])

  const totalAttribution = useMemo(() => {
    return data?.attribution.reduce((sum, item) => sum + item.count, 0) || 0
  }, [data])

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user?.clientId) return
    if (!file) {
      setError('يرجى اختيار ملف للرفع')
      return
    }

    try {
      setUploading(true)
      setError(null)
      const uploaded = await analyticsApi.uploadFile(user.clientId, file, dataType, notes)
      const uploadsList = await analyticsApi.listUploads(user.clientId)
      setUploads(uploadsList)
      const ai = await analyticsApi.getSuggestions(user.clientId, uploaded.id)
      setSuggestions(ai.recommendations)
      setFile(null)
      setNotes('')
    } catch (err) {
      setError('تعذر رفع الملف أو توليد التوصيات')
    } finally {
      setUploading(false)
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
            <h1 className="text-3xl font-bold text-slate-800">تحليلات متقدمة</h1>
            <p className="text-slate-500 mt-1">نظرة أعمق على القنوات والتحويلات وتأثير الذكاء الاصطناعي</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">رفع بيانات التحليلات</h2>
              <p className="text-sm text-slate-500 mt-1">ارفع ملف CSV أو JSON لتحليل البيانات ودمجها مع بيانات النظام.</p>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <input
                    type="file"
                    accept=".csv,application/json,text/csv"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <select
                  value={dataType}
                  onChange={(e) => setDataType(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="general">بيانات عامة</option>
                  <option value="campaigns">حملات تسويقية</option>
                  <option value="sales">مبيعات</option>
                  <option value="support">دعم العملاء</option>
                </select>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="ملاحظات اختيارية عن البيانات"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={uploading}
                  className="bg-primary text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                >
                  {uploading ? 'جارٍ الرفع...' : 'رفع البيانات'}
                </button>
                <span className="text-xs text-slate-500">سيتم إنشاء توصيات تلقائية بعد الرفع.</span>
              </div>
            </form>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-3 lg:col-span-2">
              <h3 className="text-lg font-semibold text-slate-800">الملفات المرفوعة</h3>
              {uploads.length ? (
                <div className="space-y-3">
                  {uploads.map((upload) => (
                    <div key={upload.id} className="border border-slate-200 rounded-lg px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-800">{upload.filename}</div>
                        <span className={`text-xs px-2 py-1 rounded-full ${upload.status === 'ready' ? 'bg-green-100 text-green-700' : upload.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                          {upload.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-2">
                        الصفوف: {upload.rowCount ?? 0} · الأعمدة: {upload.columns?.length || 0}
                      </div>
                      {upload.dataType && (
                        <div className="text-xs text-slate-500 mt-1">نوع البيانات: {upload.dataType}</div>
                      )}
                      {upload.notes && (
                        <div className="text-xs text-slate-500 mt-1">ملاحظات: {upload.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500">لا توجد ملفات مرفوعة بعد.</div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-3">
              <h3 className="text-lg font-semibold text-slate-800">توصيات الذكاء الاصطناعي</h3>
              {suggestions?.length ? (
                <ul className="space-y-2 text-sm text-slate-700">
                  {suggestions.map((item, index) => (
                    <li key={`${item}-${index}`} className="border border-slate-200 rounded-lg px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-slate-500 text-sm">قم برفع ملف للحصول على توصيات.</div>
              )}
            </div>
          </div>

          {data && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="إجمالي التقييمات" value={data.aiImpact.feedbackCount} />
              <StatCard label="متوسط التقييم" value={data.aiImpact.avgRating.toFixed(1)} />
              <StatCard label="نسبة التقييمات الإيجابية" value={`${data.aiImpact.positiveRate}%`} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">توزيع المصادر</h2>
              {data?.attribution.length ? (
                <div className="space-y-3">
                  {data.attribution.map((item) => (
                    <div key={item.source} className="flex items-center justify-between">
                      <div className="text-slate-600">{item.source}</div>
                      <div className="font-semibold text-slate-800">{item.count}</div>
                    </div>
                  ))}
                  <div className="border-t pt-3 text-sm text-slate-500">
                    إجمالي المصادر: {totalAttribution}
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">لا توجد بيانات مصادر بعد.</div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">قمع التحويل</h2>
              {data ? (
                <div className="space-y-2">
                  <FunnelRow label="إجمالي العملاء" value={data.funnel.total} />
                  <FunnelRow label="جديد" value={data.funnel.new} />
                  <FunnelRow label="تم التواصل" value={data.funnel.contacted} />
                  <FunnelRow label="تم البيع" value={data.funnel.converted} />
                  <FunnelRow label="ملغي" value={data.funnel.lost} />
                </div>
              ) : (
                <div className="text-slate-500">لا توجد بيانات بعد.</div>
              )}
            </div>
          </div>

          {data && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">تأثير الذكاء الاصطناعي</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard label="تقييمات إيجابية" value={data.aiImpact.positive} />
                <StatCard label="تقييمات محايدة" value={data.aiImpact.neutral} />
                <StatCard label="تقييمات سلبية" value={data.aiImpact.negative} />
                <StatCard label="عملاء لديهم تقييم" value={data.aiImpact.leadsWithFeedback} />
              </div>
            </div>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-800 mt-2">{value}</div>
    </div>
  )
}

function FunnelRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-slate-600">{label}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  )
}
