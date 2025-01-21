"use strict"
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import githubApp from './integrations/github'

const app = new Hono()

app.get('/health', (c) => c.text('OK'))

githubApp(app)

serve(app, () => {
    console.log('Server is running on http://localhost:3000')
})

export default app