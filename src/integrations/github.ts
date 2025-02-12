import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Webhooks } from '@octokit/webhooks';
import { Hono } from 'hono';
import { query, queryWParams } from "../db/psql";
import { analyzePullRequest } from "../ai/pullRequestAnalysis";

if (!process.env.GITHUB_WEBHOOK_SECRET) {
  throw new Error('GitHub webhook secret is not set');
}



export const REPO_COLORS = ['green', 'orange', 'red', 'yellow', 'limegreen', 'info', 'lightblue'];

const githubWebhookHandler = async (c: any) => {
  try {
    const body = await c.req.json();
    const signature = c.req.header('x-hub-signature-256');
    const matchesSignature = await webhooks.verify(
      JSON.stringify(body),
      signature
    );

    if (!matchesSignature) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    await webhooks.receive({
      id: c.req.header('x-github-delivery'),
      name: c.req.header('x-github-event'),
      payload: body,
    });

    return c.json({ status: 'received' });
  } catch (error) {
    console.error('Error handling webhook event:', error);
    return c.json({ error: 'Webhook handler failed' }, 500);
  }
};

export default function githubApp(app: Hono) {
  app.post('/github/webhook', githubWebhookHandler);
  app.get('/github/oauth/redirect', async (c) => {
    try {
      const code = c.req.query('code');
      if (!code) {
        return c.json({ error: 'No code provided' }, 400);
      }

      const octokit = new Octokit();
      const response = await octokit.request('POST /login/oauth/access_token', {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
        headers: {
          'Accept': 'application/json'
        }
      });

      return c.json(response.data);
    } catch (error) {
      console.error('Error handling OAuth redirect:', error);
      return c.json({ error: 'OAuth handler failed' }, 500);
    }
  });
}

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET,
});

webhooks.onAny(async (event: any) => {
  if (event.name === "installation" && event.payload?.action === "created") {
    await queryWParams(`INSERT INTO github_data (payload) VALUES ($1)`, [event.payload])
  } else {
    const githubData = await query(`SELECT * FROM github_data LIMIT 1`)
    await syncUpdatedEventAndStoreInDb(event, githubData?.rows[0]?.payload)
  }
});

export const getGithubInstallationToken = async (installationId: number) => {

  if (!process.env.GITHUB_PRIVATE_KEY || !process.env.GITHUB_APP_ID) {
    throw new Error('GitHub private key or app ID is not set in environment variables');
  }

  const appId = process.env.GITHUB_APP_ID
  const privateKey = Buffer.from(process.env.GITHUB_PRIVATE_KEY, 'base64').toString('utf8')

  const auth = createAppAuth({
    appId: appId,
    privateKey: privateKey,
    installationId: installationId,
  });

  const installationAuthentication = await auth({ type: "installation" });
  return installationAuthentication.token;
}

const listRepos = async (token: string, owner: string, repoName?: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "wave-self-hosted-github-agent v0.1"
    });

    // If repo name is provided, fetch only that repo
    if (repoName) {
      const { data: repo } = await octokit.repos.get({
        owner,
        repo: repoName
      });

      const languages = await octokit.repos.listLanguages({
        owner,
        repo: repoName,
      });

      return [{
        ...repo,
        languages: Object.keys(languages.data),
        primaryLanguage: Object.keys(languages.data)[0] || null
      }];
    }

    // Initialize array to store all repos
    let allRepos: any[] = [];
    let page = 1;

    while (true) {
      const repos = await octokit.repos.listForOrg({
        org: owner,
        type: "all",
        per_page: 100, // Max allowed per page
        page: page
      });

      // If no more repos, break the loop
      if (repos.data.length === 0) break;

      // Add this page's repos to our array
      allRepos = [...allRepos, ...repos.data];

      // If we got fewer repos than requested, we've hit the end
      if (repos.data.length < 100) break;

      page++;
    }

    // Process languages for all repos
    const reposWithLanguages = await Promise.all(
      allRepos.map(async (repo) => {
        const languages = await octokit.repos.listLanguages({
          owner,
          repo: repo.name,
        });

        return {
          ...repo,
          languages: Object.keys(languages.data),
          primaryLanguage: Object.keys(languages.data)[0] || null
        };
      })
    );

    return reposWithLanguages;

  } catch (error) {
    console.error("Error listing repositories:", error)
    return null
  }
}

const listAllBranches = async (token: string, repo: string, owner: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "wave-self-hosted-github-agent v0.1"
    })

    let allBranches: any[] = [];
    let page = 1;

    while (true) {
      const response = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100, // Max allowed per page
        page: page
      });

      // If no more branches, break the loop
      if (response.data.length === 0) break;

      // Add this page's branches to our array
      allBranches = [...allBranches, ...response.data.map(branch => branch.name)];

      // If we got fewer branches than requested, we've hit the end
      if (response.data.length < 100) break;

      page++;
    }

    return allBranches;
  } catch (error) {
    console.error("Error listing branches:", error)
    return null
  }
}

const updateRepoBranches = async (installationId: number, repoName: string, fullName: string, repoId: number, branches: string[]) => {
  const existingData = await queryWParams(`SELECT * FROM github_branches WHERE installation_id = $1`, [installationId])
  let repoBranches = existingData?.rows[0]?.branches || []

  const repoIndex = repoBranches.findIndex((r: any) => r.repo === repoName)
  if (repoIndex === -1) {
    repoBranches.push({
      repo: repoName,
      full_name: fullName,
      repoId: repoId,
      branches: branches
    })
  } else {
    repoBranches[repoIndex] = {
      repo: repoName,
      full_name: fullName,
      repoId: repoId,
      branches: branches
    }
  }

  await queryWParams(
    `INSERT INTO github_branches (installation_id, branches) 
     VALUES ($1, $2)
     ON CONFLICT (installation_id) 
     DO UPDATE SET branches = $2`,
    [installationId, repoBranches]
  )
}

const removeRepoBranches = async (installationId: number, repoName: string) => {
  const existingData = await queryWParams(`SELECT * FROM github_branches WHERE installation_id = $1`, [installationId])
  let repoBranches = existingData?.rows[0]?.branches || []

  repoBranches = repoBranches.filter((r: any) => r.repo !== repoName)

  await queryWParams(`INSERT INTO github_branches (installation_id, branches) VALUES ($1, $2)`, [installationId, repoBranches])
}

const listPullRequests = async (token: string, repo: string, owner: string, prNumber?: number) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "wave-self-hosted-github-agent v0.1"
    });

    // If PR number is provided, fetch only that PR
    if (prNumber) {
      const { data: pr } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100
      });

      return [{
        ...pr,
        changed_files: files.map(file => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch
        }))
      }];
    }

    // Initialize an array to store all PRs
    let allPullRequests: any = [];
    let page = 1;

    while (true) {
      const response = await octokit.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: 100, // Max allowed per page
        page: page
      });

      // If no more PRs, break the loop
      if (response.data.length === 0) break;

      // Add this page's PRs to our array
      allPullRequests = [...allPullRequests, ...response.data];

      // If we got fewer PRs than requested, we've hit the end
      if (response.data.length < 100) break;

      page++;
    }

    const pullRequestsWithFiles = await Promise.all(allPullRequests.map(async (pr: any) => {
      // Get files changed in the PR
      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100
      });

      return {
        ...pr,
        changed_files: files.map(file => ({
          filename: file.filename,
          status: file.status, // added, modified, removed
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch // The actual code diff
        }))
      };
    }));

    return pullRequestsWithFiles;

  } catch (error) {
    console.error("Error listing pull requests:", error);
    return null;
  }
}

const syncUpdatedEventAndStoreInDb = async (event: any, githubPayload: any) => {

  const installationId = githubPayload?.installation?.id
  const githubToken = await getGithubInstallationToken(installationId)
  const owner = githubPayload?.installation?.account?.login
  const eventType = event?.name
  const eventPayload = event?.payload

  if (eventType?.startsWith('repository')) {
    const repoAction = eventPayload?.action
    const repo = eventPayload?.repository

    const existingData = await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId])
    let allRepos = existingData?.rows[0]?.repositories || []

    if (repoAction === 'created' || repoAction === 'edited' || repoAction === 'publicized' || repoAction === 'privatized') {
      const updatedRepo = await listRepos(githubToken, owner, repo.name)
      if (updatedRepo && updatedRepo[0]) {
        const repoIndex = allRepos.findIndex((r: any) => r.name === repo.name)
        if (repoIndex === -1) {
          const existingColors = new Set(allRepos.map((r: any) => r.color));
          const availableColors = REPO_COLORS.filter(c => !existingColors.has(c));
          const nextColor = availableColors.length > 0 ?
            availableColors[0] :
            REPO_COLORS[allRepos.length % REPO_COLORS.length];

          allRepos.push({
            ...updatedRepo[0],
            color: nextColor
          });
        } else {
          allRepos[repoIndex] = {
            ...updatedRepo[0],
            color: allRepos[repoIndex].color || REPO_COLORS[repoIndex % REPO_COLORS.length]
          };
        }

        const branches = await listAllBranches(githubToken, repo.name, owner)
        if (branches) {
          await updateRepoBranches(installationId, repo.name, repo.full_name, repo.id, branches)
        }
      }
    } else if (repoAction === 'deleted') {
      allRepos = allRepos.filter((r: any) => r.name !== repo.name)
      await removeRepoBranches(installationId, repo.name)
    }

    await queryWParams(
      `INSERT INTO github_repositories (installation_id, repositories) 
       VALUES ($1, $2)
       ON CONFLICT (installation_id) 
       DO UPDATE SET repositories = $2`,
      [installationId, allRepos]
    )
  } else if (eventType === 'installation') {
    // For new installations, fetch all repos and their branches
    const allRepos: any = await listRepos(githubToken, owner)
    await queryWParams(
      `INSERT INTO github_repositories (installation_id, repositories) 
       VALUES ($1, $2)
       ON CONFLICT (installation_id) 
       DO UPDATE SET repositories = $2`,
      [installationId, allRepos]
    )

    for (const repo of allRepos) {
      const branches = await listAllBranches(githubToken, repo.name, owner)
      if (branches) {
        await updateRepoBranches(installationId, repo.name, repo.full_name, repo.id, branches)
      }
    }
  }

  if (eventType?.startsWith('pull_request')) {
    const prAction = eventPayload?.action
    const repo = eventPayload?.repository?.name
    const prNumber = eventPayload?.pull_request?.number

    const existingData = await queryWParams(`SELECT * FROM github_pull_requests WHERE installation_id = $1`, [installationId])
    let allPullRequests = existingData?.rows[0]?.pullRequests || []

    if (prAction === 'opened' || prAction === 'synchronize' || prAction === 'edited' || prAction === 'reopened' || prAction === 'closed') {
      const updatedPR = await listPullRequests(githubToken, repo, owner, prNumber)
      if (updatedPR) {
        const repoIndex = allPullRequests.findIndex((r: any) => r.repo === repo)
        if (repoIndex === -1) {
          allPullRequests.push({
            repo,
            prs: [updatedPR[0]]
          })
        } else {
          const prIndex = allPullRequests[repoIndex].prs.findIndex((pr: any) => pr.number === prNumber)
          if (prIndex === -1) {
            allPullRequests[repoIndex].prs.push(updatedPR[0])
          } else {
            allPullRequests[repoIndex].prs[prIndex] = updatedPR[0]
          }
        }

        if (prAction === 'opened' || prAction === 'edited' || prAction === 'synchronize') {

          const prForAnalysis = {
            title: updatedPR[0].title,
            body: updatedPR[0].body,
            changed_files: updatedPR[0].changed_files.filter((file: any) => {
              if (!file?.filename) return false;

              const skipPatterns = [
                /package-lock\.json$/,
                /package\.json$/,
                /yarn\.lock$/,
                /pnpm-lock\.yaml$/,
                /dist\//,
                /build\//,
                /\.min\.js$/,
                /\.min\.css$/
              ];

              // Return false if the filename matches any of the skip patterns
              return !skipPatterns.some(pattern => pattern.test(file.filename));
            }),
            requested_reviewers: updatedPR[0].requested_reviewers
          };

          const analysis = await analyzePullRequest(prForAnalysis)
          if (analysis) {
            await queryWParams(
              `INSERT INTO github_pull_request_analysis (installation_id, repo, pr_id, analysis) 
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (installation_id, repo, pr_id) 
               DO UPDATE SET analysis = $4`,
              [installationId, repo, prNumber, analysis]
            )
          }

          if (process.env.ENABLE_PR_REVIEW_COMMENT === "true") {
            try {
              const parsedAnalysis = JSON.parse(analysis)
              console.log("analysis", JSON.stringify(parsedAnalysis, null, 2))

              const reviewComments = parsedAnalysis?.review?.reviewComments || [];
              const codeChangeComments = parsedAnalysis?.codeChangeGeneration?.reviewComments || [];

              // Keep codeChangeComments and only add reviewComments that don't have conflicting positions
              const mergedComments = [
                ...codeChangeComments,
                ...reviewComments.filter((review: any) =>
                  !codeChangeComments.some((change: any) =>
                    change.path === review.path && change.position === review.position
                  )
                )
              ];

              await addReviewToPullRequest(
                githubToken,
                owner,
                repo,
                prNumber,
                parsedAnalysis?.codeChangeGeneration?.event as "REQUEST_CHANGES" | "APPROVE" | "COMMENT",
                parsedAnalysis?.codeChangeGeneration?.reviewBody,
                mergedComments)
            } catch (error) {
              console.error("Error adding review to pull request:", error)
            }
          }
        }

      }
    }

    await queryWParams(
      `INSERT INTO github_pull_requests (installation_id, pullRequests) 
       VALUES ($1, $2)
       ON CONFLICT (installation_id) 
       DO UPDATE SET "pullRequests" = $2`,
      [installationId, allPullRequests]
    )
  } else if (eventType === 'installation') {
    // For new installations, fetch all PRs
    const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId]))?.rows[0]?.repositories
    if (allRepos) {
      let allPullRequests: any[] = [];
      // fetch all PRs for all repos
      for (const repo of allRepos) {
        const prs = await listPullRequests(githubToken, repo.name, owner)
        if (prs) {
          allPullRequests.push({
            repo: repo.name,
            prs: prs
          });
        }
      }
      // Insert all PRs at once after collecting them
      await queryWParams(
        `INSERT INTO github_pull_requests (installation_id, pullRequests) 
         VALUES ($1, $2)
         ON CONFLICT (installation_id) 
         DO UPDATE SET "pullRequests" = $2`,
        [installationId, allPullRequests]
      )
    }
  }

  if (!eventType || eventType === 'installation' || eventType === 'member' || eventType === 'organization') {
    const octokit = new Octokit({
      auth: githubToken,
      userAgent: "wave-self-hosted-github-agent v0.1"
    });

    const users = await octokit.paginate(octokit.orgs.listMembers, {
      org: owner,
      per_page: 100
    });

    if (!eventType || eventType === 'installation' || eventType === 'member') {
      const userEmails = new Map<string, string | null>(users.map(user => [user.login, null]));
      const userNames = new Map<string, string | null>(users.map(user => [user.login, null]));

      // Only fetch commit data if we need user details
      const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId]))?.rows[0]?.repositories
      if (allRepos) {
        // Process repos in parallel with a limit
        const processRepo = async (repo: any) => {
          try {
            // Only fetch commits if we still need user info
            if ([...userEmails.values()].some(email => email === null) ||
              [...userNames.values()].some(name => name === null)) {
              const commits = await octokit.paginate(octokit.repos.listCommits, {
                owner,
                repo: repo.name,
                per_page: 100
              });

              for (const commit of commits) {
                const authorLogin = commit.author?.login;
                if (authorLogin && userEmails.has(authorLogin)) {
                  if (!userEmails.get(authorLogin)) {
                    userEmails.set(authorLogin, commit.commit?.author?.email || null);
                  }
                  if (!userNames.get(authorLogin)) {
                    userNames.set(authorLogin, commit.commit?.author?.name || null);
                  }
                }
              }
            }
          } catch (error) {
            console.error(`Error processing repo ${repo.name}:`, error);
          }
        };

        // Process repos in batches of 3
        for (let i = 0; i < allRepos.length; i += 3) {
          const batch = allRepos.slice(i, i + 3);
          await Promise.all(batch.map(processRepo));
        }
      }

      const usersWithDetails = users.map(user => ({
        ...user,
        email: userEmails.get(user.login) || null,
        name: userNames.get(user.login) || null
      }));

      await queryWParams(
        `INSERT INTO github_users (installation_id, users) 
         VALUES ($1, $2)
         ON CONFLICT (installation_id) 
         DO UPDATE SET users = $2`,
        [installationId, usersWithDetails || users]
      )
    } else {
      await queryWParams(
        `INSERT INTO github_users (installation_id, users) 
         VALUES ($1, $2)
         ON CONFLICT (installation_id) 
         DO UPDATE SET users = $2`,
        [installationId, users]
      )
    }
  }
}

export const getGithubDataFromDb = async (installationId: number) => {
  const repositories = await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId])
  const pullRequests = await queryWParams(`SELECT * FROM github_pull_requests WHERE installation_id = $1`, [installationId])
  const users = await queryWParams(`SELECT * FROM github_users WHERE installation_id = $1`, [installationId])
  const branches = await queryWParams(`SELECT * FROM github_branches WHERE installation_id = $1`, [installationId])

  return {
    repositories: repositories?.rows[0]?.repositories,
    pullRequests: pullRequests?.rows[0]?.pullRequests,
    users: users?.rows[0]?.users,
    branches: branches?.rows[0]?.branches,
  }
}

const addReviewToPullRequest = async (
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  reviewBody?: string,
  reviewComments?: { path: string; body: string; position: number }[]
) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "gravitonAI v0.1",
    });

    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const { data: reviews } = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    const pendingReviews = reviews.filter(review => review.state === 'PENDING' && review?.user?.login === "gravity-cloud[bot]");

    for (const review of pendingReviews) {
      try {
        await octokit.pulls.deletePendingReview({
          owner,
          repo,
          pull_number: prNumber,
          review_id: review.id
        });

      } catch (error) {
        console.error("Error dismissing pending review:", error)
      }
    }

    const response = await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: pr.head.sha,
      body: reviewBody,
      comments: reviewComments?.map(comment => ({
        path: comment.path,
        body: comment.body,
        line: comment.position,
        side: 'RIGHT'
      })),
      event,
    });

    return response.data;

  } catch (error) {
    console.error("Error adding review to pull request:", error)
    return null
  }
};