'use client'
import { useState, FormEvent } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { LogIn, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const [clientId, setClientId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Mock login for demo - replace with actual API call
      if (!clientId.trim()) {
        throw new Error('يرجى إدخال معرف العميل')
      }

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Mock successful login
      const mockToken = 'mock_jwt_token_' + Date.now()
      const mockUser = {
        clientId: clientId,
        role: 'admin'
      }

      login(mockToken, mockUser)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ في تسجيل الدخول')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary-dark p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <LogIn className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-2">لوحة التحكم</h1>
          <p className="text-slate-500">WhatsApp AI SaaS</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="text-red-500 flex-shrink-0" size={20} />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="clientId" className="block text-sm font-medium text-slate-700 mb-2">
              معرف العميل
            </label>
            <input
              id="clientId"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="client_xxxxx"
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition"
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>جاري تسجيل الدخول...</span>
              </>
            ) : (
              <>
                <LogIn size={20} />
                <span>تسجيل الدخول</span>
              </>
            )}
          </button>
        </form>

        {/* Password Reset Placeholder */}
        <div className="mt-6 text-center">
          <button className="text-sm text-primary hover:text-primary-dark transition">
            نسيت كلمة المرور؟
          </button>
          <p className="text-xs text-slate-400 mt-2">(سيتم إضافة هذه الميزة قريباً)</p>
        </div>

        {/* Demo Instructions */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 font-medium mb-1">للتجربة:</p>
          <p className="text-xs text-blue-600">استخدم أي معرف عميل للدخول (مثال: client_demo)</p>
        </div>
      </div>
    </div>
  )
}
