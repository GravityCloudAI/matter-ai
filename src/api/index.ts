import { Hono } from 'hono'
import { getGithubDataFromDb } from '../integrations/github.js'
import { getLogsFromDb } from '../ai/gateway.js'

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

  app.get('/llmLogs', authMiddleware, async (c) => {
    const logs = await getLogsFromDb()

    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>LLM Logs</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #1a1a1a;
            color: #e1e1e1;
        }
        h1 {
            color: #fff;
            margin-bottom: 24px;
        }
        table {
            border-collapse: separate;
            border-spacing: 0;
            width: 100%;
            background: #2d2d2d;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        th, td {
            padding: 12px 16px;
            text-align: left;
            border-bottom: 1px solid #404040;
        }
        th {
            background-color: #363636;
            font-weight: 600;
            color: #fff;
            white-space: nowrap;
        }
        tr:last-child td {
            border-bottom: none;
        }
        tr:hover {
            background-color: #363636;
        }
        .json-data {
            max-width: 300px;
            max-height: 150px;
            overflow: auto;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 12px;
            white-space: pre-wrap;
            background-color: #1a1a1a;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid #404040;
            color: #10b981;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        .timestamp {
            white-space: nowrap;
            color: #888;
        }
        /* Scrollbar styling for Webkit browsers */
        .json-data::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        .json-data::-webkit-scrollbar-track {
            background: #1a1a1a;
        }
        .json-data::-webkit-scrollbar-thumb {
            background: #404040;
            border-radius: 4px;
        }
        .json-data::-webkit-scrollbar-thumb:hover {
            background: #4a4a4a;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>LLM Logs</h1>
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Installation ID</th>
                    <th>Repository</th>
                    <th>PR ID</th>
                    <th>Request</th>
                    <th>Response</th>
                    <th>Created At</th>
                </tr>
            </thead>
            <tbody>
                ${logs.map(log => `
                    <tr>
                        <td>${log.id}</td>
                        <td>${log.installation_id}</td>
                        <td>${log.repo}</td>
                        <td>${log.pr_id}</td>
                        <td><div class="json-data">${JSON.stringify(log.request, null, 2)}</div></td>
                        <td><div class="json-data">${JSON.stringify(JSON.parse(log.response), null, 2)}</div></td>
                        <td class="timestamp">${new Date(log.created_at).toLocaleString()}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</body>
</html>`

    return c.html(html)
  })
}