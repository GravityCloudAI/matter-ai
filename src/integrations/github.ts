import * as dotenv from 'dotenv'
dotenv.config()
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Webhooks } from '@octokit/webhooks';
import { Hono } from 'hono';
import { query, queryWParams } from "../db/psql.js";
import { analyzePullRequest, analyzePullRequestStatic, getPRExplanation } from "../ai/pullRequestAnalysis.js";

if (!process.env.GITHUB_WEBHOOK_SECRET) {
  throw new Error('GitHub webhook secret is not set');
}

const USER_AGENT = "matter-self-hosted-github-agent v0.1"

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
    console.log('Error handling webhook event:', error);
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
      console.log('Error handling OAuth redirect:', error);
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
    try {
      await query(`DELETE FROM github_data`);
      await query(`DELETE FROM github_repositories`);
      await query(`DELETE FROM github_branches`);
      await query(`DELETE FROM github_pull_requests`);
      return
    } catch (error) {
      console.log("Error deleting installation data:", error)
    }
  }
  const githubData = await query(`SELECT * FROM github_data ORDER BY created_at DESC LIMIT 1`)
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
      console.log("Authentication failed - rate limit or permissions issue:", error.message);
      throw new Error("GitHub authentication failed - rate limit or permissions issue");
    }
    if (error.status === 401) {
      console.log("Invalid authentication credentials");
      throw new Error("Invalid GitHub authentication credentials");
    }
    console.log("Error getting installation token:", error);
    throw error;
  }
}

const listRepos = async (token: string, owner: string, repoName?: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: USER_AGENT,
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
          console.log("Rate limit exceeded for repo fetch:", error.message);
          throw new Error("GitHub API rate limit exceeded");
        }
        if (error.status === 404) {
          console.log("Repository not found:", repoName);
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
      console.log("Rate limit exceeded:", error.message);
      throw new Error("GitHub API rate limit exceeded");
    }
    if (error.timeout) {
      console.log("Request timeout while fetching repositories");
      throw new Error("GitHub API request timeout");
    }
    console.log("Error listing repositories:", error);
    throw error;
  }
}

const listAllBranches = async (token: string, repo: string, owner: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: USER_AGENT
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
    console.log("Error listing branches:", error)
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
      userAgent: USER_AGENT,
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
        console.log("[PULL_REQUEST] Error fetching PR #", prNumber)
        if (error.status === 403) {
          console.log("Rate limit exceeded for PR fetch:", error.message);
          throw new Error("GitHub API rate limit exceeded");
        }
        if (error.status === 404) {
          console.log("Pull request not found:", prNumber);
          return null;
        }
        if (error.timeout) {
          console.log("Request timeout while fetching PR details");
          return null
        }
        return null
      }
    }

    // Initialize an array to store all PRs
    let allPullRequests: any = [];
    let page = 1;

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    while (true) {
      try {
        // Add a delay between paginated requests to avoid rate limiting
        if (page > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const response = await octokit.pulls.list({
          owner,
          repo,
          state: 'all',
          per_page: 100,
          page: page
        });

        console.log("[PULL_REQUEST] Found", response.data.length, "PRs for", repo)

        if (response.data.length === 0) break;

        // Filter out PRs older than 3 months
        const recentPRs = response.data.filter(pr => {
          const updatedAt = new Date(pr.updated_at);
          return updatedAt >= threeMonthsAgo;
        });

        console.log(`[PULL_REQUEST] Keeping ${recentPRs.length} of ${response.data.length} PRs (filtered older than 3 months)`);

        allPullRequests = [...allPullRequests, ...recentPRs];

        // If we got fewer PRs than requested or all PRs in this page were filtered out, we've hit the end
        if (response.data.length < 100) break;

        page++;
      } catch (error: any) {
        if (error.status === 403) {
          console.log("Rate limit exceeded while listing PRs:", error.message);
          // Wait for 60 seconds and try again instead of failing completely
          console.log("Waiting 60 seconds before retrying...");
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue; // Try the same page again
        }
        if (error.timeout) {
          console.log("Request timeout while listing PRs");
          // Wait for 10 seconds and try again
          console.log("Waiting 10 seconds before retrying...");
          await new Promise(resolve => setTimeout(resolve, 10000));
          continue; // Try the same page again
        }
        return null
      }
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Process PRs in batches to respect rate limits
    const batchSize = 5; // Process 5 PRs at a time
    const pullRequestsWithFiles = [];

    for (let i = 0; i < allPullRequests.length; i += batchSize) {
      const batch = allPullRequests.slice(i, Math.min(i + batchSize, allPullRequests.length));

      // Process batch with a small delay between each PR
      const batchResults = await Promise.all(
        batch.map(async (pr: any, index: number) => {
          // Add a small delay between requests to avoid rate limiting
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          try {
            // Skip fetching files for PRs older than one week
            const prUpdatedAt = new Date(pr.updated_at);
            if (prUpdatedAt < oneWeekAgo) {
              return {
                ...pr,
                changed_files: []
              };
            }

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
              console.log(`Rate limit exceeded while fetching files for PR #${pr.number}:`, error.message);
              // If we hit rate limit, add a longer delay before continuing
              await new Promise(resolve => setTimeout(resolve, 30000));
              return {
                ...pr,
                changed_files: []
              };
            }
            console.log(`Error fetching files for PR #${pr.number}:`, error);
            return {
              ...pr,
              changed_files: []
            };
          }
        })
      );

      pullRequestsWithFiles.push(...batchResults);

      // Add a delay between batches to avoid rate limiting
      if (i + batchSize < allPullRequests.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return pullRequestsWithFiles;

  } catch (error: any) {
    if (error.status === 403) {
      console.log("Rate limit exceeded:", error.message);
    }
    if (error.timeout) {
      console.log("Request timeout while fetching pull requests");
    }
    console.log("Error listing pull requests:", error);
    return null;
  }
}

const getPullRequestTemplate = async (token: string, repo: string, owner: string): Promise<string | null> => {
  const octokit = new Octokit({
    auth: token,
    userAgent: USER_AGENT,
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
    console.log("Error fetching PR template:", error);
    return null;
  }
}

const addCommentToPullRequest = async (
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  comment: string
) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "gravitonAI v0.1",
    });

    const response = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment,
    });

    return response.data;
  } catch (error) {
    console.error("Error adding comment to PR:", error);
    throw error;
  }
};

const filterPRFiles = (files: any[]) => {
  return files.filter((file: any) => {
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

    return !skipPatterns.some(pattern => pattern.test(file.filename));
  });
};

const handleReviewRequest = async (
  githubToken: string,
  owner: string,
  repo: string,
  prNumber: number,
  installationId: number,
) => {
  try {
    // Add a comment acknowledging the request
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      "I'm reviewing this PR now. I'll provide feedback shortly."
    );

    // Get PR details to analyze
    const prDetails = await listPullRequests(githubToken, repo, owner, prNumber);

    if (!prDetails || !prDetails[0]) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't fetch the details of this PR. Please try again later."
      );
      return;
    }

    const prForAnalysis = {
      title: prDetails[0].title,
      body: prDetails[0].body,
      changed_files: filterPRFiles(prDetails[0].changed_files),
      requested_reviewers: prDetails[0].requested_reviewers
    };

    // Get PR template if it exists
    const pullRequestTemplate = await getPullRequestTemplate(githubToken, repo, owner);

    // Perform the analysis
    const analysis = await analyzePullRequest(installationId, repo, prNumber, prForAnalysis, {
      documentVector: null,
      pullRequestTemplate: pullRequestTemplate
    })

    if (!analysis) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't complete the analysis of this PR. Please try again later."
      );
      return;
    }

    // Process and store the analysis

    // Submit the review
    const reviewComments = analysis?.review?.reviewComments || [];
    const codeChangeComments = analysis?.codeChangeGeneration?.reviewComments || [];

    // Merge comments, prioritizing code change comments
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
      mergedComments
    );

  } catch (error) {
    try {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I encountered an error while trying to review this PR. Please try again later."
      );
    } catch (commentError) {
    }
  }
};

// Function to handle summary requests
const handleSummaryRequest = async (
  githubToken: string,
  owner: string,
  repo: string,
  prNumber: number,
  installationId: number,
) => {
  try {
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      "I'm generating a summary for this PR. I'll post it shortly."
    );

    const prDetails = await listPullRequests(githubToken, repo, owner, prNumber);

    if (!prDetails || !prDetails[0]) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't fetch the details of this PR. Please try again later."
      );
      return;
    }

    const prForAnalysis = {
      title: prDetails[0].title,
      body: prDetails[0].body,
      changed_files: filterPRFiles(prDetails[0].changed_files),
      requested_reviewers: prDetails[0].requested_reviewers
    };

    // Get PR template if it exists
    const pullRequestTemplate = await getPullRequestTemplate(githubToken, repo, owner);

    // Perform the analysis
    const analysis = await analyzePullRequest(installationId, repo, prNumber, prForAnalysis, {
      documentVector: null,
      pullRequestTemplate: pullRequestTemplate
    })

    if (!analysis) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't generate a summary for this PR. Please try again later."
      );
      return;
    }

    // Simply use the existing summary description
    if (analysis?.summary?.description) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        analysis.summary.description
      );

    } else {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't generate a summary for this PR. No summary data was available."
      );
    }

  } catch (error) {
    console.log("Failed to generate summary:", error);
    try {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I encountered an error while trying to generate a summary for this PR. Please try again later."
      );
    } catch (commentError) {
      console.log("Failed to add error comment:", commentError);
    }
  }
}

export const handleExplainRequest = async (
  githubToken: string,
  owner: string,
  repo: string,
  prNumber: number,
  installationId: number,
) => {
  try {
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      "I'm generating a detailed explanation for this PR. I'll post it shortly."
    );

    const prDetails = await listPullRequests(githubToken, repo, owner, prNumber);

    if (!prDetails || !prDetails[0]) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't fetch the details of this PR. Please try again later."
      );
      return;
    }

    const prForAnalysis = {
      title: prDetails[0].title,
      body: prDetails[0].body,
      changed_files: filterPRFiles(prDetails[0].changed_files),
      requested_reviewers: prDetails[0].requested_reviewers
    };
    const explanationRes: any = await getPRExplanation(installationId, repo, prNumber, prForAnalysis);

    const explanationObj: any = JSON.parse(explanationRes);
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      explanationObj?.explanation || "I couldn't generate a detailed explanation for this PR. Please try again later."
    );
  } catch (error) {
    console.log(`Error handling explain request for PR #${prNumber}:`, error);
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

    console.log("[REPOSITORY] Syncing repository:", repo.name)

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
    console.log("[INSTALLATION] Syncing repositories:", allRepos.length)

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

    console.log("[PULL_REQUEST] Syncing pull request:", prNumber, "Action:", prAction)

    if (prAction === 'opened' || prAction === 'synchronize' || prAction === 'edited' || prAction === 'reopened' || prAction === 'closed') {
      const updatedPR = await listPullRequests(githubToken, repo, owner, prNumber)
      if (updatedPR && updatedPR[0]) {
        await queryWParams(
          `INSERT INTO github_pull_requests (installation_id, repo, pr_id, pr_data, pr_status) 
           VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT ON CONSTRAINT github_pull_requests_pkey 
           DO UPDATE SET pr_data = $4::jsonb, pr_status = $5, updated_at = NOW()`,
          [installationId, repo, prNumber, JSON.stringify(updatedPR[0]), prAction === 'closed' ? 'closed' : 'open']
        )

        // check if the pr is draft and if it is, skip the review
        if (updatedPR[0].draft) {
          console.log("[PULL_REQUEST] Pull request is a draft, skipping review")
          return
        }

        if (prAction === 'opened' || prAction === 'edited' || prAction === 'synchronize') {
          const prForAnalysis = {
            title: updatedPR[0].title,
            body: updatedPR[0].body,
            changed_files: filterPRFiles(updatedPR[0].changed_files),
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

              if (pullRequestTemplate) {
                await updatePRDescription(githubToken, owner, repo, prNumber, analysis?.checklist?.completedChecklist)
              } else {
                await updatePRDescription(githubToken, owner, repo, prNumber, analysis?.summary?.description)
              }
            } catch (error) {
              console.log("Error adding review to pull request:", error)
            }
          }
        } else if (prAction === 'deleted') {
          // For deleted PRs, we can either remove them or mark them as deleted
          await queryWParams(
            `UPDATE github_pull_requests 
             SET pr_status = 'deleted', updated_at = NOW()
             WHERE installation_id = $1 AND repo = $2 AND pr_id = $3`,
            [installationId, repo, prNumber]
          )
        }
      }
    } else if (eventType === 'installation') {
      // wait for 10s
      await new Promise(resolve => setTimeout(resolve, 10000));
      // For new installations, fetch all PRs
      const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1::integer limit 1`, [installationId]))?.rows[0]?.repositories
      if (allRepos) {
        // Process repos in batches to avoid overwhelming the database
        for (const repo of allRepos) {
          const prs = await listPullRequests(githubToken, repo.name, owner)
          console.log("[INSTALLATION] Found", prs?.length, "PRs for", repo.name)

          if (prs && prs.length > 0) {
            // Insert PRs in batches
            for (const pr of prs) {
              await queryWParams(
                `INSERT INTO github_pull_requests (installation_id, repo, pr_id, pr_data) 
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT ON CONSTRAINT github_pull_requests_pkey 
                 DO UPDATE SET pr_data = $4::jsonb, updated_at = NOW()`,
                [installationId, repo.name, pr.number, JSON.stringify(pr)]
              )
            }
            console.log("[INSTALLATION] Synced", prs.length, "PRs for", repo.name)
          }
        }
      }
    } else if (!eventType || eventType === 'installation' || eventType === 'member' || eventType === 'organization') {
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
              console.log(`Error processing repo ${repo.name}:`, error);
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

  if (eventType === 'issue_comment') {
    const action = eventPayload.action
    const issue = eventPayload.issue
    const comment = eventPayload.comment
    const repo = eventPayload.repository.name

    if (action === 'created') {
      // Check if this is a PR comment
      if (issue.pull_request) {
        // Check for app mentions in the comment
        const isMentioned = comment.body.includes('/ai');
        const hasReviewCommand = comment.body.includes('review');
        const hasSummaryCommand = comment.body.includes('summary');
        const hasExplainCommand = comment.body.includes('explain');

        if (isMentioned) {
          if (hasReviewCommand) {
            // Call the dedicated function to handle the review request
            await handleReviewRequest(
              githubToken,
              owner,
              repo,
              issue.number,
              installationId
            );
          } else if (hasSummaryCommand) {
            // Call the dedicated function to handle the summary request
            await handleSummaryRequest(
              githubToken,
              owner,
              repo,
              issue.number,
              installationId
            );
          } else if (hasExplainCommand) {
            // Pass the comment ID to the handler
            await handleExplainRequest(
              githubToken,
              owner,
              repo,
              issue.number,
              installationId
            );
          }
        }

      }
    }
  }
}

export const getGithubDataFromDb = async () => {
  try {
    const githubData = await query(`SELECT * FROM github_data ORDER BY created_at DESC LIMIT 1`)
    const installationId = githubData?.rows[0]?.installation_id
    const repositories = await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId])
    const pullRequests = await queryWParams(`
      SELECT repo, pr_id, pr_data, pr_status, updated_at 
      FROM github_pull_requests 
      WHERE installation_id = $1 AND pr_status != 'deleted'
      ORDER BY updated_at DESC`, [installationId])
    const users = await queryWParams(`SELECT * FROM github_users WHERE installation_id = $1`, [installationId])
    const branches = await queryWParams(`SELECT * FROM github_branches WHERE installation_id = $1`, [installationId])
    const pullRequestAnalysis = await queryWParams(`SELECT * FROM github_pull_request_analysis WHERE installation_id = $1`, [installationId])

    // Group PRs by repo
    const groupedPRs = pullRequests?.rows?.reduce((acc: any, pr: any) => {
      if (!acc[pr.repo]) {
        acc[pr.repo] = [];
      }
      acc[pr.repo].push({
        ...pr.pr_data,
        status: pr.pr_status
      });
      return acc;
    }, {});

    // Convert to the expected format
    const formattedPRs = Object.keys(groupedPRs || {}).map(repo => ({
      repo,
      prs: groupedPRs[repo].map((pr: any) => {
        const analysis = pullRequestAnalysis?.rows?.find((a: any) => a.pr_id === pr.number && a.repo === repo);

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
      })
    }));

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
      pullRequests: formattedPRs,
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
    console.log('Error getting github data from db:', error);
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

    const pendingReviews = reviews.filter(review => review.state === 'PENDING' && review?.user?.login === `${process.env.GITHUB_APP_NAME}[bot]`);

    for (const review of pendingReviews) {
      try {
        await octokit.pulls.deletePendingReview({
          owner,
          repo,
          pull_number: prNumber,
          review_id: review.id
        });

      } catch (error) {
        console.log(`Failed to dismiss review ${review.id}:`, error);
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

    console.log(
      `Review submitted to PR #${prNumber} in repo ${repo}: ${response.data.html_url}`
    );
    return response.data;

  } catch (error) {
    console.log('Error adding review to PR:', error);
    throw error;
  }
};

export const forceReSync = async (resource: 'repositories' | 'pullRequests' | 'users' | 'branches') => {
  const installation = await query(`SELECT * FROM github_data ORDER BY created_at DESC LIMIT 1`)
  const installationId = installation?.rows[0]?.installation_id
  const owner = installation?.rows[0]?.payload?.installation?.account?.login

  const githubToken = await getGithubInstallationToken(installationId)

  if (resource === 'pullRequests') {

    await query(`DELETE FROM github_pull_requests`)

    const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1::integer limit 1`, [installationId]))?.rows[0]?.repositories
    if (allRepos) {
      for (const repo of allRepos) {
        const prs = await listPullRequests(githubToken, repo.name, owner)
        if (prs && prs.length > 0) {
          console.log(`[FORCE_RESYNC] Syncing ${prs.length} PRs for ${repo.name}`)

          for (const pr of prs) {
            await queryWParams(
              `INSERT INTO github_pull_requests (installation_id, repo, pr_id, pr_data) 
               VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT ON CONSTRAINT github_pull_requests_pkey 
               DO UPDATE SET pr_data = $4::jsonb, updated_at = NOW()`,
              [installationId, repo.name, pr.number, JSON.stringify(pr)]
            )
          }
        }
      }
    }
  }
}

const updatePRDescription = async (githubToken: string, owner: string, repo: string, prId: number, description: string) => {
  try {
    const octokit = new Octokit({
      auth: githubToken,
      userAgent: USER_AGENT,
    });

    const response = await octokit.pulls.update({
      owner,
      repo,
      pull_number: prId,
      body: description
    });

    console.log(`Updated PR #${prId} description in repo ${repo}`);
    return response.data;
  } catch (error) {
    console.log('Error updating PR description:', error);
    throw error;
  }
}
