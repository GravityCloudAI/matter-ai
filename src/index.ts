"use strict"
import * as dotenv from 'dotenv'
dotenv.config()

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import api from './api/index.js'
import { init } from './db/psql.js'
import githubApp from './integrations/github.js'
import bitbucketApp from './integrations/bitbucket.js'
const app = new Hono()

app.get('/health', (c) => c.text('OK'))

serve({
    port: 8080,
    fetch: app.fetch,
}, () => {
    console.log('Server is running on http://localhost:8080')
    init()
    githubApp(app)
    bitbucketApp(app)
    api(app)
})