#!/usr/bin/env bash
# SPEC 8: hosting for the public demo, on top of the M0 resources from infra/m0_provision.sh.
#
#   infra/deploy.sh provision   Log Analytics + Application Insights, Cosmos DB (serverless),
#                               Container Registry, Container Apps environment, the `tte-api` app
#                               with its user-assigned identity, and the GitHub Actions identity
#                               (OIDC, no stored secret), and the Storage static website for web/
#                               (Static Web Apps has no region the student policy allows).
#   infra/deploy.sh api [tag]   build the API image with docker, push it, and roll it out.
#   infra/deploy.sh web         build web/ against TTE_API_URL and upload it to the Storage
#                               static website.
#   infra/deploy.sh github      set the repo variables the deploy workflow reads (ids, no secrets).
#
# Same guard as m0_provision.sh: an explicit AZURE_SUBSCRIPTION_ID, personal offers only. Safe to
# re-run. Names and endpoints go into a managed block of .env; keys are never printed.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=${TTE_ENV_FILE:-.env}
PHASE=${1:-provision}

# Plain KEY=VALUE only, no eval; the shell wins over the file.
if [[ -f $ENV_FILE ]]; then
  while IFS='=' read -r key value; do
    [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    [[ -n ${!key:-} ]] && continue
    value=${value%\"}
    value=${value#\"}
    export "$key=$value"
  done <"$ENV_FILE"
fi

step() { printf '\n==> %s\n' "$*"; }
exists() { "$@" --only-show-errors -o none 2>/dev/null; }

# --- guard: before any call that changes something ------------------------------------------------
if ! az account show -o none 2>/dev/null; then
  echo "Not logged in. Run: az login" >&2
  exit 1
fi
SUB_ID=${AZURE_SUBSCRIPTION_ID:-}
if [[ -z $SUB_ID ]]; then
  echo "Set AZURE_SUBSCRIPTION_ID to the subscription to use. Yours:" >&2
  az account list --query "[].{name:name, id:id}" -o table >&2 || true
  exit 1
fi
SUB_NAME=$(az account show --subscription "$SUB_ID" --query name -o tsv)
TENANT_ID=$(az account show --subscription "$SUB_ID" --query tenantId -o tsv)
QUOTA_ID=$(az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUB_ID?api-version=2022-12-01" \
  --query subscriptionPolicies.quotaId -o tsv 2>/dev/null || echo unknown)
case $QUOTA_ID in
  AzureForStudents* | PayAsYouGo* | FreeTrial*) ;;
  *)
    echo "Refusing offer '$QUOTA_ID' on $SUB_NAME: deploy only to Azure for Students," >&2
    echo "pay-as-you-go or a free trial (see infra/m0_provision.sh)." >&2
    exit 1
    ;;
esac
az account set --subscription "$SUB_ID"

LOCATION=${AZURE_LOCATION:?run infra/m0_provision.sh first}
RG=${AZURE_RESOURCE_GROUP:?run infra/m0_provision.sh first}
SUFFIX=${TTE_SUFFIX:?run infra/m0_provision.sh first}
AI_ACCOUNT=${AZURE_AI_ACCOUNT:?run infra/m0_provision.sh first}
LOGS=${TTE_LOGS_WORKSPACE:-tte-logs-$SUFFIX}
APPI=${TTE_APP_INSIGHTS:-tte-appi-$SUFFIX}
COSMOS=${TTE_COSMOS_ACCOUNT:-tte-cosmos-$SUFFIX}
COSMOS_DB=${TTE_COSMOS_DATABASE:-tte}
ACR=${TTE_ACR:-ttecr$SUFFIX}
ACA_ENV=${TTE_ACA_ENV:-tte-env-$SUFFIX}
APP=${TTE_ACA_APP:-tte-api}
APP_ID=${TTE_API_IDENTITY:-tte-api-id-$SUFFIX}
GH_ID=${TTE_GITHUB_IDENTITY:-tte-gh-$SUFFIX}
SITE=${TTE_SITE_ACCOUNT:-ttesite$SUFFIX}
REPO=${TTE_GITHUB_REPO:-timothyzhbw-jpg/through-their-eyes}
LOG_CAP_GB=${TTE_LOG_DAILY_CAP_GB:-0.1}
# North Central US had no Cosmos DB capacity on 2026-10-20 ("high demand"); West US is the
# nearest region the Azure for Students policy allows.
COSMOS_LOCATION=${TTE_COSMOS_LOCATION:-westus}

write_env() {
  local start="# >>> infra/deploy.sh (generated; edits inside this block are overwritten)"
  local end="# <<< infra/deploy.sh"
  local tmp
  tmp=$(mktemp)
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  awk -v s="$start" -v e="$end" '$0==s{skip=1} !skip{print} $0==e{skip=0}' "$ENV_FILE" >"$tmp"
  {
    cat "$tmp"
    echo "$start"
    printf '%s\n' "$@"
    echo "$end"
  } >"$ENV_FILE"
  rm -f "$tmp"
}

provision() {
  step "Resource providers"
  for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.Insights Microsoft.DocumentDB \
    Microsoft.ContainerRegistry Microsoft.ManagedIdentity Microsoft.Storage; do
    az provider register --namespace "$ns" --wait -o none
  done

  step "Log Analytics $LOGS (daily cap ${LOG_CAP_GB} GB) and Application Insights $APPI"
  exists az monitor log-analytics workspace show -g "$RG" -n "$LOGS" ||
    az monitor log-analytics workspace create -g "$RG" -n "$LOGS" -l "$LOCATION" -o none
  az monitor log-analytics workspace update -g "$RG" -n "$LOGS" --quota "$LOG_CAP_GB" -o none
  LOGS_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LOGS" --query id -o tsv)
  exists az monitor app-insights component show -g "$RG" --app "$APPI" ||
    az monitor app-insights component create -g "$RG" --app "$APPI" -l "$LOCATION" \
      --workspace "$LOGS_ID" --kind web --application-type web -o none
  APPI_CONN=$(az monitor app-insights component show -g "$RG" --app "$APPI" \
    --query connectionString -o tsv)

  step "Cosmos DB $COSMOS (serverless, keyless, $COSMOS_LOCATION)"
  exists az cosmosdb show -g "$RG" -n "$COSMOS" ||
    az cosmosdb create -g "$RG" -n "$COSMOS" --capabilities EnableServerless \
      --locations regionName="$COSMOS_LOCATION" failoverPriority=0 isZoneRedundant=False \
      --default-consistency-level Session -o none
  az resource update -g "$RG" -n "$COSMOS" --resource-type Microsoft.DocumentDB/databaseAccounts \
    --set properties.disableLocalAuth=true -o none
  exists az cosmosdb sql database show -g "$RG" -a "$COSMOS" -n "$COSMOS_DB" ||
    az cosmosdb sql database create -g "$RG" -a "$COSMOS" -n "$COSMOS_DB" -o none
  for spec in cache:/kind claims_audit:/match_id; do
    exists az cosmosdb sql container show -g "$RG" -a "$COSMOS" -d "$COSMOS_DB" -n "${spec%%:*}" ||
      az cosmosdb sql container create -g "$RG" -a "$COSMOS" -d "$COSMOS_DB" -n "${spec%%:*}" \
        -p "${spec#*:}" -o none
  done
  COSMOS_ENDPOINT=$(az cosmosdb show -g "$RG" -n "$COSMOS" --query documentEndpoint -o tsv)

  step "Container Registry $ACR (Basic, no admin user)"
  exists az acr show -g "$RG" -n "$ACR" ||
    az acr create -g "$RG" -n "$ACR" -l "$LOCATION" --sku Basic --admin-enabled false -o none
  ACR_ID=$(az acr show -g "$RG" -n "$ACR" --query id -o tsv)

  step "Container Apps environment $ACA_ENV (Consumption) and app $APP"
  # Through ARM with an explicit mode: the CLI now creates *express* environments, whose apps
  # could not pull from ACR with a managed identity (BuildFailed, 2026-10-20).
  if ! exists az containerapp env show -g "$RG" -n "$ACA_ENV"; then
    az rest --method put -o none --url "https://management.azure.com/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.App/managedEnvironments/$ACA_ENV?api-version=2026-07-01" \
      --body "{\"location\": \"$LOCATION\", \"properties\": {\"environmentMode\": \"WorkloadProfiles\", \"workloadProfiles\": [{\"name\": \"Consumption\", \"workloadProfileType\": \"Consumption\"}]}}"
    for _ in $(seq 1 60); do
      [[ $(az containerapp env show -g "$RG" -n "$ACA_ENV" --query properties.provisioningState \
        -o tsv 2>/dev/null) == Succeeded ]] && break
      sleep 10
    done
  fi
  if ! exists az containerapp show -g "$RG" -n "$APP"; then
    # A placeholder image until `infra/deploy.sh api` builds ours.
    az containerapp create -g "$RG" -n "$APP" --environment "$ACA_ENV" \
      --image mcr.microsoft.com/k8se/quickstart:latest --target-port 80 --ingress external \
      --min-replicas 1 --max-replicas 1 --cpu 0.5 --memory 1.0Gi -o none
  fi
  # Single revision mode: a rollout deactivates the previous revision instead of leaving it
  # running (and billed) at zero traffic.
  az containerapp revision set-mode -g "$RG" -n "$APP" --mode single -o none
  # One user-assigned identity for Foundry, Cosmos and image pulls.
  exists az identity show -g "$RG" -n "$APP_ID" ||
    az identity create -g "$RG" -n "$APP_ID" -l "$LOCATION" -o none
  APP_ID_RES=$(az identity show -g "$RG" -n "$APP_ID" --query id -o tsv)
  APP_PRINCIPAL=$(az identity show -g "$RG" -n "$APP_ID" --query principalId -o tsv)
  APP_CLIENT_ID=$(az identity show -g "$RG" -n "$APP_ID" --query clientId -o tsv)
  az containerapp identity assign -g "$RG" -n "$APP" --user-assigned "$APP_ID_RES" -o none
  APP_FQDN=$(az containerapp show -g "$RG" -n "$APP" \
    --query properties.configuration.ingress.fqdn -o tsv)

  step "Roles for the app's identity"
  AI_ID=$(az cognitiveservices account show -g "$RG" -n "$AI_ACCOUNT" --query id -o tsv)
  assign "$APP_PRINCIPAL" ServicePrincipal "Cognitive Services User" "$AI_ID"
  assign "$APP_PRINCIPAL" ServicePrincipal AcrPull "$ACR_ID"
  cosmos_data_role "$APP_PRINCIPAL"
  cosmos_data_role "$(az ad signed-in-user show --query id -o tsv)"  # local runs against Cosmos
  az containerapp registry set -g "$RG" -n "$APP" --server "$ACR.azurecr.io" \
    --identity "$APP_ID_RES" -o none

  step "GitHub Actions identity $GH_ID (OIDC from $REPO main only)"
  exists az identity show -g "$RG" -n "$GH_ID" ||
    az identity create -g "$RG" -n "$GH_ID" -l "$LOCATION" -o none
  GH_PRINCIPAL=$(az identity show -g "$RG" -n "$GH_ID" --query principalId -o tsv)
  GH_CLIENT_ID=$(az identity show -g "$RG" -n "$GH_ID" --query clientId -o tsv)
  # GitHub's OIDC subject now carries immutable ids (owner@id/repo@id); keep the plain form too.
  local ids subject_ids
  ids=$(gh api "repos/$REPO" --jq '"\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"')
  subject_ids="repo:$ids:ref:refs/heads/main"
  for cred in "github-main:repo:$REPO:ref:refs/heads/main" "github-main-ids:$subject_ids"; do
    exists az identity federated-credential show -g "$RG" --identity-name "$GH_ID" -n "${cred%%:*}" ||
      az identity federated-credential create -g "$RG" --identity-name "$GH_ID" -n "${cred%%:*}" \
        --issuer https://token.actions.githubusercontent.com --subject "${cred#*:}" \
        --audiences api://AzureADTokenExchange -o none
  done
  RG_ID=$(az group show -n "$RG" --query id -o tsv)
  assign "$GH_PRINCIPAL" ServicePrincipal Contributor "$RG_ID"

  step "Storage static website $SITE (keyless uploads)"
  exists az storage account show -g "$RG" -n "$SITE" ||
    az storage account create -g "$RG" -n "$SITE" -l "$LOCATION" --sku Standard_LRS \
      --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false \
      --allow-shared-key-access false -o none
  SITE_ID=$(az storage account show -g "$RG" -n "$SITE" --query id -o tsv)
  assign "$(az ad signed-in-user show --query id -o tsv)" User "Storage Blob Data Contributor" \
    "$SITE_ID"
  assign "$GH_PRINCIPAL" ServicePrincipal "Storage Blob Data Contributor" "$SITE_ID"
  for attempt in 1 2 3 4 5 6 7 8 9 10; do  # new role assignments take a few minutes to apply
    if az storage blob service-properties update --account-name "$SITE" --auth-mode login \
      --static-website --index-document index.html --404-document index.html -o none 2>/dev/null; then
      break
    fi
    [[ $attempt == 10 ]] && { echo "Could not enable the static website on $SITE." >&2; exit 1; }
    sleep 30
  done
  WEB_URL=$(az storage account show -g "$RG" -n "$SITE" --query primaryEndpoints.web -o tsv)
  WEB_URL=${WEB_URL%/}

  step "Write $ENV_FILE"
  write_env "TTE_LOGS_WORKSPACE=$LOGS" "TTE_APP_INSIGHTS=$APPI" \
    "APPLICATIONINSIGHTS_CONNECTION_STRING=$APPI_CONN" "TTE_COSMOS_ACCOUNT=$COSMOS" \
    "TTE_COSMOS_ENDPOINT=$COSMOS_ENDPOINT" "TTE_COSMOS_DATABASE=$COSMOS_DB" "TTE_ACR=$ACR" \
    "TTE_ACA_ENV=$ACA_ENV" "TTE_ACA_APP=$APP" "TTE_API_URL=https://$APP_FQDN" \
    "TTE_API_IDENTITY=$APP_ID" "TTE_API_CLIENT_ID=$APP_CLIENT_ID" \
    "TTE_GITHUB_IDENTITY=$GH_ID" "TTE_GITHUB_CLIENT_ID=$GH_CLIENT_ID" "TTE_SITE_ACCOUNT=$SITE" \
    "TTE_WEB_URL=$WEB_URL" "TTE_WEB_ORIGIN=$WEB_URL"
  step "Done"
  echo "API (placeholder until 'infra/deploy.sh api'): https://$APP_FQDN"
  echo "Web (empty until 'infra/deploy.sh web'):        $WEB_URL"
}

assign() {  # principal, type, role, scope; idempotent
  local principal=$1 type=$2 role=$3 scope=$4
  if [[ -z $(az role assignment list --assignee "$principal" --role "$role" --scope "$scope" \
    --query "[].id" -o tsv) ]]; then
    az role assignment create --assignee-object-id "$principal" --assignee-principal-type "$type" \
      --role "$role" --scope "$scope" -o none
  fi
}

cosmos_data_role() {  # Cosmos DB Built-in Data Contributor (data plane), account scope
  local principal=$1
  local role=00000000-0000-0000-0000-000000000002
  if [[ -z $(az cosmosdb sql role assignment list -g "$RG" -a "$COSMOS" \
    --query "[?principalId=='$principal' && ends_with(roleDefinitionId, '$role')].id" -o tsv) ]]; then
    az cosmosdb sql role assignment create -g "$RG" -a "$COSMOS" --role-definition-id "$role" \
      --principal-id "$principal" --scope "/" -o none
  fi
}

api() {
  local tag=${1:-$(git rev-parse --short HEAD)}
  local image="$ACR.azurecr.io/tte-api:$tag"
  # ACR Tasks (`az acr build`) is not allowed on Azure for Students, so the image is built with
  # docker here or on the GitHub runner, for the platform Container Apps runs (linux/amd64).
  step "Build and push $image"
  az acr login -n "$ACR" -o none
  docker buildx build --platform linux/amd64 -t "$image" -t "$ACR.azurecr.io/tte-api:latest" \
    --push .
  step "Roll out $APP"
  local speech_key
  speech_key=$(az cognitiveservices account keys list -g "$RG" -n "${AZURE_SPEECH_ACCOUNT:?}" \
    --query key1 -o tsv)
  az containerapp secret set -g "$RG" -n "$APP" --secrets "speech-key=$speech_key" -o none
  unset speech_key
  az containerapp update -g "$RG" -n "$APP" --image "$image" --set-env-vars \
    "FOUNDRY_PROJECT_ENDPOINT=${FOUNDRY_PROJECT_ENDPOINT:?}" "FOUNDRY_MODEL=${FOUNDRY_MODEL:?}" \
    "AZURE_SPEECH_REGION=${AZURE_SPEECH_REGION:?}" "AZURE_SPEECH_KEY=secretref:speech-key" \
    "APPLICATIONINSIGHTS_CONNECTION_STRING=${APPLICATIONINSIGHTS_CONNECTION_STRING:?}" \
    "TTE_COSMOS_ENDPOINT=${TTE_COSMOS_ENDPOINT:?}" "TTE_COSMOS_DATABASE=$COSMOS_DB" \
    "AZURE_CLIENT_ID=${TTE_API_CLIENT_ID:?run provision first}" \
    "TTE_WEB_ORIGIN=${TTE_WEB_ORIGIN:-*}" "TTE_DAILY_MODEL_CAP=${TTE_DAILY_MODEL_CAP:-40}" \
    "TTE_MATCHES=${TTE_MATCHES:-blind_side_run:3,match:1,press_escape:0}" -o none
  az containerapp ingress update -g "$RG" -n "$APP" --target-port 8000 -o none
  echo "https://$(az containerapp show -g "$RG" -n "$APP" \
    --query properties.configuration.ingress.fqdn -o tsv)/health"
}

web() {
  step "Build web/ (API: ${TTE_API_URL:-none, bundled data only})"
  (cd web && npm ci --no-audit --no-fund && VITE_API_URL="${TTE_API_URL:-}" npm run build)
  step "Upload web/dist to $SITE"
  az storage blob upload-batch --account-name "$SITE" --auth-mode login -d '$web' -s web/dist \
    --overwrite --content-cache-control "public, max-age=300" -o none
  echo "${TTE_WEB_URL:-$(az storage account show -g "$RG" -n "$SITE" --query primaryEndpoints.web -o tsv)}"
}

github() {
  step "Repo variables for .github/workflows/deploy.yml ($REPO)"
  gh variable set AZURE_CLIENT_ID -R "$REPO" -b "${TTE_GITHUB_CLIENT_ID:?run provision first}"
  gh variable set AZURE_TENANT_ID -R "$REPO" -b "$TENANT_ID"
  gh variable set AZURE_SUBSCRIPTION_ID -R "$REPO" -b "$SUB_ID"
  gh variable set AZURE_RESOURCE_GROUP -R "$REPO" -b "$RG"
  gh variable set TTE_ACR -R "$REPO" -b "$ACR"
  gh variable set TTE_ACA_APP -R "$REPO" -b "$APP"
  gh variable set TTE_SITE_ACCOUNT -R "$REPO" -b "$SITE"
  # The web build's VITE_API_URL (SPEC 2); written to .env by `provision`.
  gh variable set TTE_API_URL -R "$REPO" -b "${TTE_API_URL:?run provision first}"
}

case $PHASE in
  provision) provision ;;
  api) api "${2:-}" ;;
  web) web ;;
  github) github ;;
  *) echo "usage: infra/deploy.sh provision | api [tag] | web | github" >&2; exit 2 ;;
esac
