# Matter

![Matter Og Image](https://res.cloudinary.com/dor5uewzz/image/upload/v1739891450/matter-og-image_loyjsa.png)

Matter is open-source AI Code Reviewer Agent. This enables developers to review code changes and provide feedback on the code.

## Installation

### Kubernetes

#### Prerequisites
1. Create an internal Github App for your Organization
2. Fill the required values in the `matter-values.yaml` file. You can get the template here: [https://github.com/GravityCloudAI/helm/blob/main/charts/gravity-matter/values.yaml](https://github.com/GravityCloudAI/helm/blob/main/charts/gravity-matter/values.yaml)

#### Helm Chart
1. `helm repo add gravity https://gravitycloudai.github.io/helm`
2. `helm repo update`
3. `helm upgrade --install matter-ai gravity/gravity-matter -f matter-values.yaml -n matter-ai --create-namespace`

