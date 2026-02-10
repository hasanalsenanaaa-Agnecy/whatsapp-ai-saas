'use client'
import { useState, useEffect } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Portal } from '@/components/Portal'
import { useAuth } from '@/contexts/AuthContext'
import { Key, Plus, Trash2, Copy, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { APIKey, operationsApi } from '@/lib/api/operations'

export default function APIKeysPage() {
  const { user } = useAuth()
  const [apiKeys, setApiKeys] = useState<APIKey[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)
  const [selectedKey, setSelectedKey] = useState<APIKey | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user?.clientId) return
      try {
        setLoading(true)
        const keys = await operationsApi.listAPIKeys(user.clientId)
        setApiKeys(keys || [])
      } catch (err) {
        setError('تعذر تحميل مفاتيح API')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.clientId])

  const handleCopyKey = (keyId: string, keyValue: string = 'whatsapp_***************') => {
    navigator.clipboard.writeText(keyValue)
    setCopiedKey(keyId)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const handleRevokeKey = (key: APIKey) => {
    setSelectedKey(key)
    setShowRevokeConfirm(true)
  }

  const confirmRevoke = () => {
    if (!selectedKey || !user?.clientId) return
    operationsApi.revokeAPIKey(user.clientId, selectedKey.id)
      .then(() => {
        setApiKeys(apiKeys.map(k =>
          k.id === selectedKey.id ? { ...k, isActive: false } : k
        ))
      })
      .catch(() => setError('تعذر إلغاء المفتاح'))
      .finally(() => {
        setShowRevokeConfirm(false)
        setSelectedKey(null)
      })
  }

  const handleCreateKey = (name: string) => {
    if (!user?.clientId) return
    operationsApi.createAPIKey(user.clientId, name)
      .then((created) => {
        setNewKeyValue(created.key)
        const newKey: APIKey = {
          id: created.id,
          clientId: user.clientId,
          name,
          createdAt: new Date().toISOString(),
          isActive: true
        }
        setApiKeys([newKey, ...apiKeys])
      })
      .catch(() => setError('تعذر إنشاء المفتاح'))
      .finally(() => setShowCreateModal(false))
  }

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
          </div>
        ) : (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800">مفاتيح API</h1>
              <p className="text-slate-500 mt-1">إدارة مفاتيح الوصول إلى API</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-lg font-medium transition"
            >
              <Plus size={20} />
              إنشاء مفتاح جديد
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* New Key Alert */}
          {newKeyValue && (
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <CheckCircle className="text-green-600 flex-shrink-0 mt-1" size={24} />
                <div className="flex-1">
                  <h3 className="font-semibold text-green-800 mb-2">تم إنشاء المفتاح بنجاح!</h3>
                  <p className="text-sm text-green-700 mb-3">
                    احفظ هذا المفتاح الآن. لن تتمكن من رؤيته مرة أخرى.
                  </p>
                  <div className="bg-white border border-green-300 rounded-lg p-4 flex items-center justify-between gap-3">
                    <code className="text-sm font-mono text-slate-800 break-all">{newKeyValue}</code>
                    <button
                      onClick={() => handleCopyKey('new', newKeyValue)}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition flex-shrink-0"
                    >
                      {copiedKey === 'new' ? (
                        <>
                          <CheckCircle size={18} />
                          تم النسخ
                        </>
                      ) : (
                        <>
                          <Copy size={18} />
                          نسخ
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => setNewKeyValue(null)}
                  className="text-green-600 hover:text-green-800"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {/* Warning Box */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">تنبيه أمني:</p>
              <ul className="list-disc list-inside space-y-1 text-yellow-700">
                <li>لا تشارك مفاتيح API مع أحد</li>
                <li>استخدم مفاتيح منفصلة للإنتاج والتطوير</li>
                <li>قم بإلغاء المفاتيح غير المستخدمة فوراً</li>
              </ul>
            </div>
          </div>

          {/* API Keys List */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الاسم</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">المفتاح</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">تاريخ الإنشاء</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">آخر استخدام</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الحالة</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {apiKeys.map((key) => (
                    <tr key={key.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-800">{key.name}</td>
                      <td className="px-6 py-4">
                        <code className="text-sm font-mono text-slate-600">whatsapp_••••••••••••</code>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {new Date(key.createdAt).toLocaleDateString('ar-SA')}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {key.lastUsedAt ? (
                          <div className="flex items-center gap-2">
                            <Clock size={14} />
                            {new Date(key.lastUsedAt).toLocaleDateString('ar-SA')}
                          </div>
                        ) : (
                          <span className="text-slate-400">لم يُستخدم</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {key.isActive ? (
                          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                            نشط
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                            ملغي
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {key.isActive && (
                          <button
                            onClick={() => handleRevokeKey(key)}
                            className="flex items-center gap-2 text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition"
                          >
                            <Trash2 size={16} />
                            إلغاء
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {apiKeys.length === 0 && !loading && (
              <div className="text-center py-12">
                <Key className="mx-auto text-slate-300 mb-4" size={48} />
                <p className="text-slate-500">لا توجد مفاتيح API حالياً</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="mt-4 text-primary hover:text-primary-dark font-medium"
                >
                  إنشاء مفتاح جديد
                </button>
              </div>
            )}
          </div>

          {/* API Usage Guide */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
            <h3 className="font-semibold text-slate-800 mb-4">كيفية استخدام المفتاح</h3>
            <div className="space-y-3 text-sm text-slate-600">
              <p>أضف المفتاح إلى رأس الطلب (Header) عند استدعاء API:</p>
              <div className="bg-slate-800 text-green-400 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <div>Authorization: Bearer YOUR_API_KEY</div>
              </div>
              <p className="text-xs text-slate-500">
                للمزيد من المعلومات، راجع <a href="#" className="text-primary hover:underline">وثائق API</a>
              </p>
            </div>
          </div>
        </div>
        )}

        {/* Create Modal */}
        {showCreateModal && (
          <Portal>
            <CreateKeyModal
              onClose={() => setShowCreateModal(false)}
              onCreate={handleCreateKey}
            />
          </Portal>
        )}

        {/* Revoke Confirm Modal */}
        {showRevokeConfirm && selectedKey && (
          <Portal>
            <RevokeConfirmModal
              keyName={selectedKey.name}
              onConfirm={confirmRevoke}
              onCancel={() => setShowRevokeConfirm(false)}
            />
          </Portal>
        )}
      </DashboardLayout>
    </ProtectedRoute>
  )
}

function CreateKeyModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onCreate(name)
    setName('')
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-slate-800 mb-4">إنشاء مفتاح API جديد</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              اسم المفتاح *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: Production Key"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              اختر اسماً يساعدك على تمييز هذا المفتاح
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-primary hover:bg-primary-dark text-white py-3 rounded-lg font-medium transition"
            >
              إنشاء
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-medium transition"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RevokeConfirmModal({ keyName, onConfirm, onCancel }: { keyName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-4">تأكيد الإلغاء</h2>
        <p className="text-slate-600 mb-6">
          هل أنت متأكد من إلغاء المفتاح <strong>{keyName}</strong>؟ سيتوقف هذا المفتاح عن العمل فوراً ولا يمكن استعادته.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-medium transition"
          >
            إلغاء المفتاح
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-medium transition"
          >
            رجوع
          </button>
        </div>
      </div>
    </div>
  )
}
