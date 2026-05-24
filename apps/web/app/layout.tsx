import type { Metadata } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/shared/Providers'

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'PatelRep — Hotel Operations AI',
  description: 'AI-powered hotel staff operations platform',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} ${instrumentSerif.variable}`}>
      <body className="font-sans bg-paper">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
