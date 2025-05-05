"use strict"
import * as dotenv from 'dotenv'
dotenv.config()

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { initGithubPolling } from './integrations/github.js'
const app = new Hono()

app.get('/health', (c) => c.text('OK'))

serve({
    port: 8080,
    fetch: app.fetch,
}, () => {
    console.log('Server is running on http://localhost:8080')
    initGithubPolling()
})