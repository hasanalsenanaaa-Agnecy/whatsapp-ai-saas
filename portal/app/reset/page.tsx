'use client'
import { useState } from 'react'
import { authApi } from '@/lib/api/auth'

export default function ResetRequestPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setToken(null)

    try {
      setLoading(true)
      const response = await authApi.requestPasswordReset(email)
      if (!response?.success) {
        throw new Error('تعذر إرسال رابط الاستعادة')
      }
      setMessage('تم إرسال طلب الاستعادة. تحقق من بريدك الإلكتروني.')
      if (response.resetToken) {
        setToken(response.resetToken)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">استعادة كلمة المرور</h1>
        <p className="text-slate-500 mb-6">أدخل بريدك الإلكتروني لإرسال رابط الاستعادة.</p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {message && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-4">
            {message}
          </div>
        )}

        {token && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 mb-4">
            <div className="text-sm">رمز الاستعادة (للتجربة):</div>
            <div className="mt-2 font-mono text-xs break-all">{token}</div>
            <a className="text-sm text-primary mt-2 inline-block" href={`/reset/confirm?token=${token}`}>
              الانتقال لتعيين كلمة المرور
            </a>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">البريد الإلكتروني</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              required
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'جار الإرسال...' : 'إرسال رابط الاستعادة'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <a href="/login" className="text-sm text-primary hover:text-primary-dark">
            العودة لتسجيل الدخول
          </a>
        </div>
      </div>
    </div>
  )
}
