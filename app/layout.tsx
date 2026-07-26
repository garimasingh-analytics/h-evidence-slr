import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'H Evidence AI SLR Tool',
  description: 'AI-assisted systematic literature review platform by H Evidence.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full" style={{ minHeight: '100vh' }}>
        <Sidebar />
        <main
          className="flex-1 overflow-auto"
          style={{ backgroundColor: '#f8fafc' }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
