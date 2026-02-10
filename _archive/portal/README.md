# WhatsApp SaaS Portal

## Tech Stack
- Next.js 14 (App Router)
- TypeScript
- TailwindCSS
- Recharts
- Axios
- Lucide React
- React Context API

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
cd portal
npm install

### Configuration
cp .env.local.example .env.local
# Recommended dev values:
# PORT=3001
# NEXT_PUBLIC_API_URL=http://localhost:3000
# NEXT_PUBLIC_USE_MOCK_DATA=true

### Development
npm run dev
# Open http://localhost:3001 in your browser

### Build for Production
npm run build
npm start

## Project Structure
portal/
├── app/
├── components/
├── contexts/
├── lib/
└── public/

## Notes
- Mock data toggle: NEXT_PUBLIC_USE_MOCK_DATA
- Backend URL: NEXT_PUBLIC_API_URL (default http://localhost:3000)
- Portal dev port: PORT (set to 3001)
