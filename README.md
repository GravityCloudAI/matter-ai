# Wave

Wave is open-source integration tool for Gravity Cloud. This enables developers to connect AWS, Github, Kubernetes, and more securily within their own infrastructure and sync actions and data with Gravity Cloud platform.

## Installation

1. Update the `values.yaml` file with the required values
```yaml
global:
  namespace: "gravity-cloud"
  storageClass: "standard"
  nodeSelector: []

components:
  gravityAgent:
    deployment:
      name: gravity-wave
      replicas: 1
      image:
        repository: gravitycloud/gravity-wave
        tag: latest
        pullPolicy: Always
      resources:
        requests:
          memory: "512Mi"
          cpu: "512m"
        limits:
          memory: "2048Mi"
          cpu: "1000m"
      env:
        GRAVITY_API_KEY: ""
        GRAVITY_API_URL: ""
        POSTGRES_HOST: "postgres-gravity-service"
        POSTGRES_USER: ""
        POSTGRES_PASSWORD: ""
        POSTGRES_DB: ""
        POSTGRES_PORT: "5432"
    service:
      name: gravity-wave-service
      type: ClusterIP
      port: 8080
      targetPort: 8080

  postgres:
    deployment:
      name: postgres-gravity
      replicas: 1
      image:
        repository: postgres
        tag: latest
        pullPolicy: IfNotPresent
      resources:
        requests:
          memory: "512Mi"
          cpu: "500m"
        limits:
          memory: "1024Mi"
          cpu: "1000m"
      env:
        POSTGRES_DB: ""
        POSTGRES_USER: ""
        POSTGRES_PASSWORD: ""
    service:
      name: postgres-gravity-service
      type: ClusterIP
      port: 5432
      targetPort: 5432

persistence:
  postgres:
    name: postgres-gravity-pvc
    size: "1Gi"
    accessMode: ReadWriteOnce
```

2. Add the helm repo `helm repo add gravity-cloud https://gravitycloudai.github.io/wave`

3. Update the helm repo `helm repo update`

4. Install the chart `helm upgrade --install  gravity-wave gravity-cloud/wave -f ./chart/values.yaml -n gravity-cloud --create-namespace`

5. Check the deployment `kubectl get pods -n gravity-cloud`