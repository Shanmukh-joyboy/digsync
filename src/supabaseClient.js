import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
    import.meta.env.VITE_PUBLIC_SUPABASE_UR,
    import.meta.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)