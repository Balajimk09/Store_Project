import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'StorePulse AI — AI-Powered Back Office for Convenience Stores',
  description:
    'StorePulse AI turns your POS data into real-time insight: sales trends, cashier audits, reorder alerts, and a built-in AI assistant for gas station operators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
