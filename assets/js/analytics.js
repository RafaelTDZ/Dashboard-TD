// Vercel Web Analytics initialization
// Import and inject analytics tracking
import { inject } from '../../vendor/vercel-analytics.mjs';

// Initialize Vercel Analytics
inject({
  mode: 'auto',
  debug: false
});
