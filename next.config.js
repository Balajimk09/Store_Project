/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  async redirects() {
    return [
      { source: '/dashboard', destination: '/app/dashboard', permanent: false },
      { source: '/products', destination: '/app/products', permanent: false },
      { source: '/transactions', destination: '/app/transactions', permanent: false },
      { source: '/upload', destination: '/app/upload', permanent: false },
      { source: '/fuel', destination: '/app/fuel', permanent: false },
      { source: '/store-settings', destination: '/app/store-settings', permanent: false },
      { source: '/cashier-audit', destination: '/app/cashier-audit', permanent: false },
      { source: '/ai-assistant', destination: '/app/ai-assistant', permanent: false },
      { source: '/reports', destination: '/app/reports', permanent: false },
      { source: '/support', destination: '/app/support', permanent: false },
      { source: '/setup', destination: '/app/setup', permanent: false },
      { source: '/account', destination: '/app/account', permanent: false },
      { source: '/admin/stores', destination: '/superadmin/stores', permanent: false },
      { source: '/admin/products', destination: '/superadmin/products', permanent: false },
      { source: '/admin/vendors', destination: '/superadmin/vendors', permanent: false },
      { source: '/admin/audit-logs', destination: '/superadmin/audit-logs', permanent: false },
      { source: '/admin/settings', destination: '/superadmin/settings', permanent: false },
      { source: '/admin/users', destination: '/superadmin/users', permanent: false },
    ];
  },
};

module.exports = nextConfig;
