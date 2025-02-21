import * as dotenv from 'dotenv'
dotenv.config()
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Webhooks } from '@octokit/webhooks';
import { Hono } from 'hono';
import { query, queryWParams } from "../db/psql.js";
import { analyzePullRequest, analyzePullRequestStatic } from "../ai/pullRequestAnalysis.js";

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
  console.log("Event received", event?.name, event?.payload?.action)
  if (event.name === "installation" && event.payload?.action === "created") {
    await queryWParams(`INSERT INTO github_data (installation_id, payload) VALUES ($1, $2::jsonb)`, [event.payload?.installation?.id, event.payload])
  } else if (event.name === "installation" && event.payload?.action === "deleted") {
    await queryWParams(`DELETE FROM github_data WHERE installation_id = $1`, [event.payload?.installation?.id])
    await queryWParams(`DELETE FROM github_repositories WHERE installation_id = $1`, [event.payload?.installation?.id])
    await queryWParams(`DELETE FROM github_branches WHERE installation_id = $1`, [event.payload?.installation?.id])
    await queryWParams(`DELETE FROM github_pull_requests WHERE installation_id = $1`, [event.payload?.installation?.id])
    return
  }
  const githubData = await query(`SELECT * FROM github_data LIMIT 1`)
  await syncUpdatedEventAndStoreInDb(event, githubData?.rows[0]?.payload)
});

export const getGithubInstallationToken = async (installationId: number) => {
  try {
    if (!process.env.GITHUB_PRIVATE_KEY || !process.env.GITHUB_APP_ID) {
      throw new Error('GitHub private key or app ID is not set in environment variables');
    }

    const appId = process.env.GITHUB_APP_ID;
    const privateKey = Buffer.from(
      process.env.GITHUB_PRIVATE_KEY, 
      'base64'
    ).toString('utf8').trim();

    const auth = createAppAuth({
      appId: appId,
      privateKey: privateKey,
      installationId: installationId,
    });

    const installationAuthentication = await auth({ type: "installation" });
    return installationAuthentication.token;
  } catch (error: any) {
    if (error.status === 403) {
      console.error("Authentication failed - rate limit or permissions issue:", error.message);
      throw new Error("GitHub authentication failed - rate limit or permissions issue");
    }
    if (error.status === 401) {
      console.error("Invalid authentication credentials");
      throw new Error("Invalid GitHub authentication credentials");
    }
    console.error("Error getting installation token:", error);
    throw error;
  }
}

const listRepos = async (token: string, owner: string, repoName?: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "matter-self-hosted-github-agent v0.1",
      request: {
        timeout: 10000 // 10 second timeout
      }
    });

    // If repo name is provided, fetch only that repo
    if (repoName) {
      try {
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
      } catch (error: any) {
        if (error.status === 403) {
          console.error("Rate limit exceeded for repo fetch:", error.message);
          throw new Error("GitHub API rate limit exceeded");
        }
        if (error.status === 404) {
          console.error("Repository not found:", repoName);
          return null;
        }
        throw error;
      }
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

  } catch (error: any) {
    if (error.status === 403) {
      console.error("Rate limit exceeded:", error.message);
      throw new Error("GitHub API rate limit exceeded");
    }
    if (error.timeout) {
      console.error("Request timeout while fetching repositories");
      throw new Error("GitHub API request timeout");
    }
    console.error("Error listing repositories:", error);
    throw error;
  }
}

const listAllBranches = async (token: string, repo: string, owner: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "matter-self-hosted-github-agent v0.1"
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
     VALUES ($1, $2::jsonb)
     ON CONFLICT (installation_id) 
     DO UPDATE SET branches = $2::jsonb`,
    [installationId, JSON.stringify(repoBranches)]
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
      userAgent: "matter-self-hosted-github-agent v0.1",
      request: {
        timeout: 10000 // 10 second timeout
      }
    });

    // If PR number is provided, fetch only that PR
    if (prNumber) {
      try {
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
      } catch (error: any) {
        if (error.status === 403) {
          console.error("Rate limit exceeded for PR fetch:", error.message);
          throw new Error("GitHub API rate limit exceeded");
        }
        if (error.status === 404) {
          console.error("Pull request not found:", prNumber);
          return null;
        }
        if (error.timeout) {
          console.error("Request timeout while fetching PR details");
          throw new Error("GitHub API request timeout");
        }
        throw error;
      }
    }

    // Initialize an array to store all PRs
    let allPullRequests: any = [];
    let page = 1;

    while (true) {
      try {
        const response = await octokit.pulls.list({
          owner,
          repo,
          state: 'all',
          per_page: 100,
          page: page
        });

        if (response.data.length === 0) break;
        allPullRequests = [...allPullRequests, ...response.data];
        if (response.data.length < 100) break;
        page++;
      } catch (error: any) {
        if (error.status === 403) {
          console.error("Rate limit exceeded while listing PRs:", error.message);
          throw new Error("GitHub API rate limit exceeded");
        }
        if (error.timeout) {
          console.error("Request timeout while listing PRs");
          throw new Error("GitHub API request timeout");
        }
        throw error;
      }
    }

    const pullRequestsWithFiles = await Promise.all(
      allPullRequests.map(async (pr: any) => {
        try {
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
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
              patch: file.patch
            }))
          };
        } catch (error: any) {
          if (error.status === 403) {
            console.error(`Rate limit exceeded while fetching files for PR #${pr.number}:`, error.message);
            // Return PR without files rather than failing completely
            return {
              ...pr,
              changed_files: []
            };
          }
          if (error.timeout) {
            console.error(`Request timeout while fetching files for PR #${pr.number}`);
            return {
              ...pr,
              changed_files: []
            };
          }
          console.error(`Error fetching files for PR #${pr.number}:`, error);
          return {
            ...pr,
            changed_files: []
          };
        }
      })
    );

    return pullRequestsWithFiles;

  } catch (error: any) {
    if (error.status === 403) {
      console.error("Rate limit exceeded:", error.message);
      throw new Error("GitHub API rate limit exceeded");
    }
    if (error.timeout) {
      console.error("Request timeout while fetching pull requests");
      throw new Error("GitHub API request timeout");
    }
    console.error("Error listing pull requests:", error);
    return null;
  }
}

const getPullRequestTemplate = async (token: string, repo: string, owner: string): Promise<string | null> => {
  const octokit = new Octokit({
    auth: token,
    userAgent: "matter-self-hosted-github-agent v0.1",
    request: {
      timeout: 10000
    }
  })

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: '.github/pull_request_template.md'
    });

    if ('content' in data) {
      return Buffer.from(data.content, 'base64').toString();
    }
    return null;
  } catch (error: any) {
    if (error.status === 404) {
      // Template doesn't exist, which is fine
      return null;
    }
    console.error("Error fetching PR template:", error);
    return null;
  }
}

const syncUpdatedEventAndStoreInDb = async (event: any, githubPayload: any) => {

  const installationId: number = githubPayload?.installation?.id
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
       VALUES ($1, $2::jsonb)
       ON CONFLICT (installation_id) 
       DO UPDATE SET repositories = $2::jsonb`,
      [installationId, JSON.stringify(allRepos)]
    )
  } else if (eventType === 'installation') {
    // For new installations, fetch all repos and their branches
    const allRepos: any = await listRepos(githubToken, owner)
    await queryWParams(
      `INSERT INTO github_repositories (installation_id, repositories) 
       VALUES ($1, $2::jsonb)
       ON CONFLICT (installation_id) 
       DO UPDATE SET repositories = $2::jsonb`,
      [installationId, JSON.stringify(allRepos)]
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
    let allPullRequests = existingData?.rows[0]?.pull_requests || []

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

          // check the ./github/pull_request_template.md from the repo branch
          const pullRequestTemplate = await getPullRequestTemplate(githubToken, repo, owner)

          const analysis = await analyzePullRequest(installationId, repo, prNumber, prForAnalysis, {
            documentVector: null,
            pullRequestTemplate: pullRequestTemplate
          })
          if (analysis) {
            await queryWParams(
              `INSERT INTO github_pull_request_analysis (installation_id, repo, pr_id, analysis) 
               VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT ON CONSTRAINT github_pull_request_analysis_pkey 
               DO UPDATE SET analysis = $4::jsonb`,
              [installationId, repo, prNumber, JSON.stringify(analysis)]
            )
          }

          if (process.env.ENABLE_PR_REVIEW_COMMENT === "true") {
            try {

              const reviewComments = analysis?.review?.reviewComments || [];
              const codeChangeComments = analysis?.codeChangeGeneration?.reviewComments || [];

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
                analysis?.codeChangeGeneration?.event as "REQUEST_CHANGES" | "APPROVE" | "COMMENT",
                analysis?.codeChangeGeneration?.reviewBody,
                mergedComments)
            } catch (error) {
              console.error("Error adding review to pull request:", error)
            }
          }
        }

      }
    }

    await queryWParams(
      `INSERT INTO github_pull_requests (installation_id, pull_requests) 
       VALUES ($1, $2::jsonb)
       ON CONFLICT (installation_id) 
       DO UPDATE SET pull_requests = $2::jsonb`,
      [installationId, JSON.stringify(allPullRequests)]
    )
  } else if (eventType === 'installation') {
    // wait fpr 10s
    await new Promise(resolve => setTimeout(resolve, 10000));
    // For new installations, fetch all PRs
    const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1::integer limit 1`, [installationId]))?.rows[0]?.repositories
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
        `INSERT INTO github_pull_requests (installation_id, pull_requests) 
         VALUES ($1, $2::jsonb)
         ON CONFLICT (installation_id) 
         DO UPDATE SET pull_requests = $2::jsonb`,
        [installationId, JSON.stringify(allPullRequests)]
      )
    }
  }

  if (!eventType || eventType === 'installation' || eventType === 'member' || eventType === 'organization') {
    const octokit = new Octokit({
      auth: githubToken,
      userAgent: "matter-self-hosted-github-agent v0.1"
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
         VALUES ($1, $2::jsonb)
         ON CONFLICT (installation_id) 
         DO UPDATE SET users = $2::jsonb`,
        [installationId, JSON.stringify(usersWithDetails || users)]
      )
    } else {
      await queryWParams(
        `INSERT INTO github_users (installation_id, users) 
         VALUES ($1, $2::jsonb)
         ON CONFLICT (installation_id) 
         DO UPDATE SET users = $2`,
        [installationId, JSON.stringify(users)]
      )
    }
  }
}

export const getGithubDataFromDb = async () => {
  try {
    const githubData = await queryWParams(`SELECT * FROM github_data limit 1`, [])
    const installationId = githubData?.rows[0]?.installation_id

    const repositories = await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId])
    const pullRequests = await queryWParams(`SELECT * FROM github_pull_requests WHERE installation_id = $1`, [installationId])
    const users = await queryWParams(`SELECT * FROM github_users WHERE installation_id = $1`, [installationId])
    const branches = await queryWParams(`SELECT * FROM github_branches WHERE installation_id = $1`, [installationId])
    const pullRequestAnalysis = await queryWParams(`SELECT * FROM github_pull_request_analysis WHERE installation_id = $1`, [installationId])

    const responseData = {
      repositories: repositories?.rows[0]?.repositories ? repositories?.rows[0]?.repositories?.map((repo: any) => {

        // clean owner data
        delete repo.owner.followers_url;
        delete repo.owner.following_url;
        delete repo.owner.gists_url;
        delete repo.owner.starred_url;
        delete repo.owner.subscriptions_url;
        delete repo.owner.organizations_url;
        delete repo.owner.repos_url;
        delete repo.owner.events_url;
        delete repo.owner.received_events_url;
        delete repo.owner.url;

        // clean links
        // clean links
        delete repo.svn_url
        delete repo.ssh_url
        delete repo.clone_url
        delete repo.git_url
        delete repo.mirror_url
        delete repo.hooks_url
        delete repo.issue_events_url
        delete repo.events_url
        delete repo.assignees_url
        delete repo.branches_url
        delete repo.tags_url
        delete repo.blobs_url
        delete repo.git_refs_url
        delete repo.trees_url
        delete repo.statuses_url
        delete repo.languages_url
        delete repo.stargazers_url
        delete repo.contributors_url
        delete repo.subscribers_url
        delete repo.subscription_url

        // Add these additional URL deletions
        delete repo.forks_url
        delete repo.keys_url
        delete repo.collaborators_url
        delete repo.teams_url
        delete repo.git_tags_url
        delete repo.commits_url
        delete repo.git_commits_url
        delete repo.comments_url
        delete repo.issue_comment_url
        delete repo.contents_url
        delete repo.compare_url
        delete repo.merges_url
        delete repo.archive_url
        delete repo.downloads_url
        delete repo.issues_url
        delete repo.pulls_url
        delete repo.milestones_url
        delete repo.notifications_url
        delete repo.labels_url
        delete repo.releases_url
        delete repo.deployments_url

        delete repo.permissions

        if (!repo.color) {
          const existingColors = new Set(repositories?.rows[0]?.repositories.map((r: any) => r.color));
          const availableColors = REPO_COLORS.filter(c => !existingColors.has(c));
          const nextColor = availableColors.length > 0 ?
            availableColors[0] :
            REPO_COLORS[repositories?.rows[0]?.repositories.length % REPO_COLORS.length];
          repo.color = nextColor
        }

        return repo
      }) : [],
      repoBranches: branches?.rows[0]?.branches ? branches?.rows[0]?.branches : [],
      pullRequests: pullRequests?.rows[0]?.pull_requests ? await Promise.all(pullRequests?.rows[0]?.pull_requests?.map(async (prData: any) => {
        return {
          repo: prData.repo,
          prs: await Promise.all(prData.prs?.map(async (pr: any) => {

            const analysis = pullRequestAnalysis?.rows?.find((analysis: any) => analysis.pr_id === pr.number)

            // clean user data
            delete pr.user.followers_url;
            delete pr.user.following_url;
            delete pr.user.gists_url;
            delete pr.user.starred_url;
            delete pr.user.subscriptions_url;
            delete pr.user.organizations_url;
            delete pr.user.repos_url;
            delete pr.user.events_url;
            delete pr.user.received_events_url;
            delete pr.user.url;

            delete pr.diff_url
            delete pr.commits_url
            delete pr.patch_url
            delete pr.url
            delete pr.statuses_url

            delete pr.commits_url
            delete pr.review_comments_url
            delete pr.review_comment_url
            delete pr.comments_url

            //clean head, base and links
            const head = pr.head
            delete pr.head
            delete pr.base;
            delete pr._links;

            pr.head = { repo: { name: head?.repo?.name }, ref: head?.ref }

            return {
              ...pr,
              checks: analysis?.analysis ?? analyzePullRequestStatic(pr)
            }
          }))
        }
      })) : [],
      users: users?.rows[0]?.users ? users?.rows[0]?.users?.map((user: any) => {
        delete user.followers_url;
        delete user.following_url;
        delete user.gists_url;
        delete user.starred_url;
        delete user.subscriptions_url;
        delete user.organizations_url;
        delete user.repos_url;
        delete user.events_url;
        delete user.received_events_url;
        delete user.url;
        return user
      }) : [],
    }

    return responseData
  } catch (error) {
    console.error('Error getting github data from db:', error);
    throw error;
  }
}

export const addReviewToPullRequest = async (
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

    // Fetch the pull request to get the latest commit id
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

    // Find any pending reviews
    const pendingReviews = reviews.filter(review => review.state === 'PENDING' && review?.user?.login === `${process.env.GITHUB_APP_NAME}[bot]`);

    // Dismiss any pending reviews
    for (const review of pendingReviews) {
      try {
        await octokit.pulls.deletePendingReview({
          owner,
          repo,
          pull_number: prNumber,
          review_id: review.id
        });

      } catch (error) {
        console.error(`Failed to dismiss review ${review.id}:`, error);
      }
    }

    // Submit review directly with all data
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

    console.log(
      `Review submitted to PR #${prNumber} in repo ${repo}: ${response.data.html_url}`
    );
    return response.data;

  } catch (error) {
    console.error('Error adding review to PR:', error);
    throw error;
  }
};

export const forceReSync = async (resource: 'repositories' | 'pullRequests' | 'users' | 'branches') => {
  const installation = await queryWParams(`SELECT * FROM github_data limit 1`, [])
  const installationId = installation?.rows[0]?.installation_id
  const owner = installation?.rows[0]?.payload?.installation?.account?.login

  const githubToken = await getGithubInstallationToken(installationId)

  if (resource === 'pullRequests') {
    const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1::integer limit 1`, [installationId]))?.rows[0]?.repositories
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
        `INSERT INTO github_pull_requests (installation_id, pull_requests) 
         VALUES ($1, $2::jsonb)
         ON CONFLICT (installation_id) 
         DO UPDATE SET pull_requests = $2::jsonb`,
        [installationId, JSON.stringify(allPullRequests)]
      )
    }
  }
}

