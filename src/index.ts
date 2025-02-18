"use strict"
import * as dotenv from 'dotenv'
dotenv.config()

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import githubApp, { addReviewToPullRequest, getGithubInstallationToken } from './integrations/github.js'
import api from './api/index.js'
import { init } from './db/psql.js'
const app = new Hono()

app.get('/health', (c) => c.text('OK'))

serve({
    port: 8080,
    fetch: app.fetch,
}, () => {
    console.log('Server is running on http://localhost:8080')
    init()
    githubApp(app)
    api(app)

    // getGithubInstallationToken(61244807).then(token => {
    //     addReviewToPullRequest(
    //         token,
    //         'GravityCloudAI',
    //         'demo-svc-repo',
    //         5,
    //         'COMMENT',
    //         'This is a test comment'
    //     )
    // })
})