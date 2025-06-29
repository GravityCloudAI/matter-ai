<div align="center">
  <a href="https://matterai.so">
    <img
      src="https://matterai.so/favicon.png"
      alt="Matter AI Logo"
      height="64"
    />
  </a>
  <br />
  <p>
    <h3>
      <b>
        Matter AI
      </b>
    </h3>
  </p>
  <p>
    <b>
      Release Code with Confidence. Everytime.
    </b>
  </p>
  <p>

![GitHub Workflow Status (with event)](https://github.com/GravityCloudAI/matter-ai/actions/workflows/main.yml/badge.svg?branch=main)
![Docker Pulls](https://img.shields.io/docker/pulls/gravitycloud/matter.svg?maxAge=604800)
[![GitHub License](https://img.shields.io/github/license/GravityCloudAI/matter-ai)](https://github.com/GravityCloudAI/matter-ai/blob/matter-ai/LICENSE)
![Security Compliance](https://img.shields.io/badge/Compliance-SOC2_Type_II-818aff)
![contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen?logo=github) 
[![Tweet](https://img.shields.io/twitter/url?url=https%3A%2F%2Fmatterai.so%2F)](https://twitter.com/intent/tweet?url=&text=Check%20out%20%40matteraidev)

![Matter Og Image](https://res.cloudinary.com/dxvbskvxm/image/upload/v1751168720/ph-header_cy8iqj.png)

  </p>
</div>

# Matter AI
Matter is open-source AI Code Reviewer Agent. This enables developers to review code changes and provide feedback on the code.

## Features

### AI Generated Summaries
- Automatically generates AI Summaries and updates the PR description.
- If you are using any PR template, the PR template will be used and updated accordingly with summary.
- Generate static AI Summary as a comment by using <kbd>/matter summary</kbd> command in the PR.

![Matter AI Generated Summary](https://res.cloudinary.com/dor5uewzz/image/upload/v1740649715/generate-ai-summary_fmzjie.png)

### AI Review
- Code quality and Bug fix recommendation in the PR
- Code change suggestion patches in the PR
- Generate static AI Review by using <kbd>/matter review</kbd> command in the PR.

![Matter AI Code Review](https://res.cloudinary.com/dor5uewzz/image/upload/v1740649715/generate-ai-review_mqz3gy.png)

### AI Explanation
- Get a quick explanation of the Pull Request
- Use the command <kbd>/matter explain</kbd>

![Matter AI Explanation](https://res.cloudinary.com/dor5uewzz/image/upload/v1741598521/generate-ai-explain_ceovuu.png)

### Supported Platforms
- [X] Github
- [ ] Gitlab
- [ ] Bitbucket
- [ ] Azure DevOps

### Features

| Feature | Status | Pricing |
|---------|--------|---------|
| AI Pull Request Summary | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI Code Review Comments | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI Code Suggestions | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI PR Explanation | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI Code Quality score and Suggestions | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| Internal Documentation Support | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |
| Generate AI Release Notes | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |
| Generate AI Security Vulnerability | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |
| Generate AI Tests | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |

## Differentiators
1. 1-click installation for all(or selected) org-level repositories. No need to integrate for each one.
2. Runs a stack of generation from Summary, Reviews, Bugs, Security and Tests together.
3. Day-0 ready self-hosted Helm Charts.

## Installation

### 1. Cloud Hosted
- You can signup on the Cloud Hosted version here: https://app.gravitycloud.ai

### 2. Docker

#### Prerequisites
1. Generate a Github Personal Access Token(Classic) here: https://github.com/settings/tokens/new

#### Steps
1. Download the docker-compose.yaml file from here: [https://github.com/GravityCloudAI/matter-ai/blob/main/docker-compose.yaml](https://github.com/GravityCloudAI/matter-ai/blob/main/docker-compose.yaml)
2. Update the ENV for the backend service in the docker-compose.yaml file. You can get your Gravity API key here: https://app.matterai.so/settings
3. Run `docker compose up -d`
4. The app will start syncing with your Github Repositories and store the data.
5. Create a new PR or update a PR to see the AI analysis.
6. You can connect your hosted backend URL also in https://app.matterai.so/home?tab=Settings to view the PRs in the UI. 

### 3. Local Installation

#### Prerequisites
1. Node.js
2. Update .env file with the required values. You can get the template here: [https://github.com/GravityCloudAI/matter-ai/blob/main/.env.example](https://github.com/GravityCloudAI/matter-ai/blob/main/.env.example)

#### Installation
1. `npm install`
2. `npm run dev`
3. Tunnel the local server to the cloud using [ngrok](https://ngrok.com/)
4. Update the webhook url in the Github App settings with the ngrok url

### Community
- Join our Discord Server here: https://discord.gg/fJU5DvanU3
