import './globals.css'
import { AuthProvider } from '../contexts/AuthContext'

export const metadata = {
  title: 'WhatsApp AI Dashboard',
  description: 'Manage your WhatsApp AI receptionist'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-slate-50 text-slate-850">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
