"use strict"
import * as dotenv from 'dotenv'
dotenv.config()

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import githubApp from './integrations/github.js'
import { GravitySocketManager } from './syncer/index.js'
const app = new Hono()

app.get('/health', (c) => c.text('OK'))

serve({
    port: 8080,
    fetch: app.fetch,
}, () => {
    console.log('Server is running on http://localhost:8080')
    githubApp(app)
    new GravitySocketManager(process.env.GRAVITY_SOCKET_URL!!);
})