'use client'
import { useState, FormEvent } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { authApi } from '@/lib/api/auth'
import { LogIn, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const [loginMode, setLoginMode] = useState<'apiKey' | 'password'>('apiKey')
  const [clientId, setClientId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      let response: any
      if (loginMode === 'apiKey') {
        if (!clientId.trim()) {
          throw new Error('يرجى إدخال معرف العميل')
        }
        if (!apiKey.trim()) {
          throw new Error('يرجى إدخال مفتاح API')
        }
        response = await authApi.login({ clientId, apiKey })
      } else {
        if (!email.trim()) {
          throw new Error('يرجى إدخال البريد الإلكتروني')
        }
        if (!password.trim()) {
          throw new Error('يرجى إدخال كلمة المرور')
        }
        response = await authApi.loginWithPassword({ email, password })
      }

      if (!response?.success) {
        throw new Error('تعذر تسجيل الدخول')
      }

      login(response.token, { clientId: response.clientId, role: response.role })
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
          <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setLoginMode('apiKey')}
              className={`flex-1 py-2 rounded-md text-sm font-medium ${loginMode === 'apiKey' ? 'bg-white shadow text-slate-800' : 'text-slate-600'}`}
            >
              API Key
            </button>
            <button
              type="button"
              onClick={() => setLoginMode('password')}
              className={`flex-1 py-2 rounded-md text-sm font-medium ${loginMode === 'password' ? 'bg-white shadow text-slate-800' : 'text-slate-600'}`}
            >
              بريد إلكتروني
            </button>
          </div>

          {loginMode === 'apiKey' ? (
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
          ) : (
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                البريد الإلكتروني
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition"
                disabled={loading}
                required
              />
            </div>
          )}

          {loginMode === 'apiKey' ? (
            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium text-slate-700 mb-2">
                مفتاح API
              </label>
              <input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="whatsapp_xxxxx"
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition"
                disabled={loading}
                required
              />
            </div>
          ) : (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                كلمة المرور
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition"
                disabled={loading}
                required
              />
            </div>
          )}

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
          <a href="/reset" className="text-sm text-primary hover:text-primary-dark transition">
            نسيت كلمة المرور؟
          </a>
          <p className="text-xs text-slate-400 mt-2">استعادة كلمة المرور عبر البريد الإلكتروني</p>
        </div>

        {/* Demo Instructions */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 font-medium mb-1">للتجربة:</p>
          <p className="text-xs text-blue-600">استخدم معرف العميل ومفتاح API الصادرين من لوحة الإدارة</p>
        </div>
      </div>
    </div>
  )
}
