
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gbtgnaepcpadzazedsfw.supabase.co'
const supabaseKey = 'sb_publishable_BphC01-sQSdOmpB04kXyfg_iiRSkdgs'

export const supabase = createClient(supabaseUrl, supabaseKey)
