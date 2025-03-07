import { Hono } from 'hono';

interface BitbucketWebhookPayload {
  repository?: {
    name?: string;
    full_name?: string;
    owner?: {
      display_name?: string;
      username?: string;
    };
  };
  actor?: {
    display_name?: string;
    username?: string;
  };
  push?: {
    changes?: any[];
  };
  pullrequest?: any;
  issue?: any;
}

async function handlePushEvent(payload: BitbucketWebhookPayload) {
  // Process push event
  const changes = payload.push?.changes || [];
  console.log(`Processing push with ${changes.length} changes`);
  // Implement your push event handling logic here
}

async function handlePullRequestEvent(payload: BitbucketWebhookPayload, eventType: string) {
  // Process pull request event
  console.log(`Processing ${eventType} event`);
  // Implement your PR event handling logic here
}

const bitbucketWebhookHandler = async (c: any) => {
  const payload: BitbucketWebhookPayload = await c.req.json();

  const eventType = c.req.header('x-event-key') as string;

    // Extract repository and owner information
    const repoName = payload.repository?.name || 'unknown';
    const repoFullName = payload.repository?.full_name || 'unknown';
    const ownerName = payload.repository?.owner?.display_name || 
                      payload.repository?.owner?.username || 'unknown';
    
    // Log webhook event
    console.log(`Received Bitbucket webhook: ${eventType}`);
    console.log(`Repository: ${repoFullName}`);
    console.log(`Owner: ${ownerName}`);

    switch (eventType) {
      case 'repo:push':
        await handlePushEvent(payload);
        break;
      case 'pullrequest:created':
      case 'pullrequest:updated':
      case 'pullrequest:approved':
      case 'pullrequest:merged':
        await handlePullRequestEvent(payload, eventType);
        break;
      default:
        console.log(`Unhandled event type: ${eventType}`);
    }
    
    return c.json({ message: 'Webhook received' });
}

export default function bitbucketApp(app: Hono) {
  app.post('/bitbucket/webhook', bitbucketWebhookHandler);
}
