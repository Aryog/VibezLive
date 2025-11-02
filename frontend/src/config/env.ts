// Environment configuration
export const env = {
  // Server configuration
  serverUrl: import.meta.env.VITE_SERVER_URL || 'http://localhost:3000',
  
  // App configuration
  appName: import.meta.env.VITE_APP_NAME || 'VibezLive',
  appVersion: import.meta.env.VITE_APP_VERSION || '1.0.0',
  
  // Feature flags
  enableScreenShare: import.meta.env.VITE_ENABLE_SCREEN_SHARE === 'true' || true,
  enableChat: import.meta.env.VITE_ENABLE_CHAT === 'true' || false,
  maxParticipants: parseInt(import.meta.env.VITE_MAX_PARTICIPANTS || '50'),
  
  // Development mode
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD,
} as const;

// Type for environment variables
export type Env = typeof env;
