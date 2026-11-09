import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PulseGuard — Real-Time Synthetic Uptime & Incident Monitoring',
  description: 'Enterprise multi-tenant synthetic uptime monitoring and incident management SaaS.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-brand-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}

