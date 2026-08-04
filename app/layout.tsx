import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'StorePulse AI — AI-Powered Back Office for Convenience Stores',
  description:
    'StorePulse AI turns your POS data into real-time insight: sales trends, cashier audits, reorder alerts, and a built-in AI assistant for gas station operators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
