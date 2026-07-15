import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createHeartbeatHandler } from './handler.ts'

Deno.serve(createHeartbeatHandler())
