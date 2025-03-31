import { Hono } from 'hono'
import { getGithubDataFromDb } from '../integrations/github.js'

// Middleware to check API key
const authMiddleware = async (c: any, next: any) => {
  const apiKey = c.req.header('Authorization')?.replace('Bearer ', '')  // Add Bearer token support

  if (!apiKey) {
    c.header('WWW-Authenticate', 'Basic realm="Restricted Access"')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (apiKey !== process.env.GRAVITY_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

export default function api(app: Hono) {
  app.get('/getData', authMiddleware, async (c) => {
    try {
      const res = c.req.query('res')

      if (res === 'github') {
        const data = await getGithubDataFromDb()
        return c.json(data)
      }

      // Handle other data sources or return default response
      return c.json({ message: 'Please specify a valid data source' })

    } catch (error) {
      return c.json({ error: 'Internal server error' }, 500)
    }
  })
}