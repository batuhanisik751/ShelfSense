/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.cache = { type: 'memory' };
    }
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, canvas: false };
    }
    return config;
  },
};

export default nextConfig;
