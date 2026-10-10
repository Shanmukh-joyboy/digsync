import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_PUBLIC_SUPABASE_URL
const key = import.meta.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Missing VITE_PUBLIC_SUPABASE_URL or VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Check .env or the Vercel environment variables.')
export const supabase = createClient(url, key)