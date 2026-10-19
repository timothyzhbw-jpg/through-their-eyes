#!/usr/bin/env bash
# M0 (SPEC §8, §9): create the Azure resources the smoke test needs, then write .env.
#
# Creates, in one resource group:
#   - a Microsoft Foundry resource (kind AIServices) with one project and one model deployment;
#   - an Azure AI Speech resource (free F0 tier if the subscription still has one);
#   - an "Azure AI User" role assignment for you, so Agent Framework can call Foundry without keys.
# Safe to re-run: existing resources are reused and their names are kept in .env.
# Variables already set in the shell take precedence over .env (see .env.example).
#
# Usage: az login && infra/m0_provision.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=.env

# Load names from an earlier run without overriding the shell; plain KEY=VALUE only, no eval.
if [[ -f $ENV_FILE ]]; then
  while IFS='=' read -r key value; do
    [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    [[ -n ${!key:-} ]] && continue
    value=${value%\"}
    value=${value#\"}
    export "$key=$value"
  done <"$ENV_FILE"
fi

LOCATION=${AZURE_LOCATION:-eastus2}
RG=${AZURE_RESOURCE_GROUP:-rg-through-their-eyes}
SUFFIX=${TTE_SUFFIX:-$(openssl rand -hex 3)}
AI_ACCOUNT=${AZURE_AI_ACCOUNT:-tte-ai-$SUFFIX}
AI_PROJECT=${AZURE_AI_PROJECT:-through-their-eyes}
SPEECH_ACCOUNT=${AZURE_SPEECH_ACCOUNT:-tte-speech-$SUFFIX}
CANDIDATES=${MODEL_CANDIDATES:-gpt-4.1-mini gpt-5-mini gpt-5-nano gpt-4o-mini}
SKU=${DEPLOYMENT_SKU:-GlobalStandard}
CAPACITY=${DEPLOYMENT_CAPACITY:-20}
DEPLOYMENT=${FOUNDRY_MODEL:-}

step() { printf '\n==> %s\n' "$*"; }
exists() { "$@" --only-show-errors -o none 2>/dev/null; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

step "Subscription"
if ! az account show -o none 2>/dev/null; then
  echo "Not logged in. Run: az login" >&2
  exit 1
fi
# Never fall back to the CLI's default subscription: name the one to bill explicitly.
SUB_ID=${AZURE_SUBSCRIPTION_ID:-}
if [[ -z $SUB_ID ]]; then
  echo "Set AZURE_SUBSCRIPTION_ID to the subscription to use. Yours:" >&2
  az account list --query "[].{name:name, id:id, tenant:tenantDisplayName}" -o table >&2
  exit 1
fi
SUB_NAME=$(az account show --subscription "$SUB_ID" --query name -o tsv)
TENANT_ID=$(az account show --subscription "$SUB_ID" --query tenantId -o tsv)
QUOTA_ID=$(az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUB_ID?api-version=2022-12-01" \
  --query subscriptionPolicies.quotaId -o tsv 2>/dev/null || echo unknown)
echo "$SUB_NAME ($SUB_ID), offer $QUOTA_ID"
# Only offers billed to you personally. Internal (Microsoft-paid) and Enterprise Agreement
# (organisation-paid) subscriptions are refused: the rules exclude projects developed with
# financial support from the Sponsor, and an organisation's budget is not ours to spend.
case $QUOTA_ID in
  AzureForStudents* | PayAsYouGo* | FreeTrial*) ;;
  *)
    if [[ ${TTE_ALLOW_ANY_OFFER:-} != 1 ]]; then
      echo "Refusing offer '$QUOTA_ID'. Use an Azure for Students (or personal pay-as-you-go)" >&2
      echo "subscription; set TTE_ALLOW_ANY_OFFER=1 only if its owner approved this use." >&2
      exit 1
    fi
    echo "TTE_ALLOW_ANY_OFFER=1: continuing on offer '$QUOTA_ID'."
    ;;
esac
az account set --subscription "$SUB_ID"
echo "az default subscription is now $SUB_NAME."

step "Region policy"
ALLOWED=$(az policy assignment list --disable-scope-strict-match \
  --query "[].parameters.listOfAllowedLocations.value[]" -o tsv 2>/dev/null | sort -u | tr '\n' ' ')
if [[ -n ${ALLOWED// /} ]]; then
  echo "Allowed regions: $ALLOWED"
  if ! grep -qw -- "$LOCATION" <<<"$ALLOWED"; then
    echo "AZURE_LOCATION=$LOCATION is not allowed; set AZURE_LOCATION to one of the above." >&2
    exit 1
  fi
else
  echo "No allowed-locations policy found; using $LOCATION."
fi

step "Resource provider"
az provider register --namespace Microsoft.CognitiveServices --wait -o none

step "Resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

step "Foundry resource $AI_ACCOUNT"
if ! exists az cognitiveservices account show -g "$RG" -n "$AI_ACCOUNT"; then
  az cognitiveservices account create -g "$RG" -n "$AI_ACCOUNT" -l "$LOCATION" \
    --kind AIServices --sku S0 --custom-domain "$AI_ACCOUNT" --allow-project-management \
    --yes -o none
fi
AI_ID=$(az cognitiveservices account show -g "$RG" -n "$AI_ACCOUNT" --query id -o tsv)

step "Foundry project $AI_PROJECT"
if ! exists az cognitiveservices account project show -g "$RG" -n "$AI_ACCOUNT" \
  --project-name "$AI_PROJECT"; then
  az cognitiveservices account project create -g "$RG" -n "$AI_ACCOUNT" -l "$LOCATION" \
    --project-name "$AI_PROJECT" -o none
fi
PROJECT_ENDPOINT=$(az cognitiveservices account project show -g "$RG" -n "$AI_ACCOUNT" \
  --project-name "$AI_PROJECT" --query 'properties.endpoints."AI Foundry API"' -o tsv 2>/dev/null ||
  true)
[[ -n $PROJECT_ENDPOINT ]] ||
  PROJECT_ENDPOINT="https://$AI_ACCOUNT.services.ai.azure.com/api/projects/$AI_PROJECT"
echo "Endpoint: $PROJECT_ENDPOINT"

step "Model deployment ($SKU)"
if [[ -n $DEPLOYMENT ]] && exists az cognitiveservices account deployment show -g "$RG" \
  -n "$AI_ACCOUNT" --deployment-name "$DEPLOYMENT"; then
  echo "Reusing deployment $DEPLOYMENT"
else
  az cognitiveservices model list -l "$LOCATION" -o json >"$TMP/models.json"
  az cognitiveservices usage list -l "$LOCATION" -o json >"$TMP/usage.json"
  CHOICE=$(python3 infra/pick_model.py "$TMP/models.json" "$TMP/usage.json" "$CANDIDATES" \
    "$SKU" "$CAPACITY")
  read -r MODEL MODEL_VERSION MODEL_CAPACITY <<<"$CHOICE"
  DEPLOYMENT=$MODEL
  az cognitiveservices account deployment create -g "$RG" -n "$AI_ACCOUNT" \
    --deployment-name "$DEPLOYMENT" --model-name "$MODEL" --model-version "$MODEL_VERSION" \
    --model-format OpenAI --sku-name "$SKU" --sku-capacity "$MODEL_CAPACITY" -o none
  echo "Deployed $MODEL $MODEL_VERSION (${MODEL_CAPACITY}K tokens/min)"
fi

step "Role assignment: Azure AI User on $AI_ACCOUNT"
USER_ID=$(az ad signed-in-user show --query id -o tsv)
if [[ -z $(az role assignment list --assignee "$USER_ID" --role "Azure AI User" --scope "$AI_ID" \
  --query "[].id" -o tsv) ]]; then
  az role assignment create --assignee-object-id "$USER_ID" --assignee-principal-type User \
    --role "Azure AI User" --scope "$AI_ID" -o none
  echo "Assigned. It can take a few minutes before Foundry accepts your token."
else
  echo "Already assigned."
fi

step "Speech resource $SPEECH_ACCOUNT"
if ! exists az cognitiveservices account show -g "$RG" -n "$SPEECH_ACCOUNT"; then
  if ! az cognitiveservices account create -g "$RG" -n "$SPEECH_ACCOUNT" -l "$LOCATION" \
    --kind SpeechServices --sku F0 --yes -o none; then
    echo "F0 not available (one free Speech resource per subscription); using S0."
    az cognitiveservices account create -g "$RG" -n "$SPEECH_ACCOUNT" -l "$LOCATION" \
      --kind SpeechServices --sku S0 --yes -o none
  fi
fi
SPEECH_SKU=$(az cognitiveservices account show -g "$RG" -n "$SPEECH_ACCOUNT" --query sku.name -o tsv)
SPEECH_KEY=$(az cognitiveservices account keys list -g "$RG" -n "$SPEECH_ACCOUNT" \
  --query key1 -o tsv)

step "Write $ENV_FILE"
BLOCK_START="# >>> infra/m0_provision.sh (generated; edits inside this block are overwritten)"
BLOCK_END="# <<< infra/m0_provision.sh"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
awk -v s="$BLOCK_START" -v e="$BLOCK_END" '$0==s{skip=1} !skip{print} $0==e{skip=0}' \
  "$ENV_FILE" >"$TMP/env"
{
  cat "$TMP/env"
  echo "$BLOCK_START"
  echo "AZURE_SUBSCRIPTION_ID=$SUB_ID"
  echo "AZURE_TENANT_ID=$TENANT_ID"
  echo "AZURE_LOCATION=$LOCATION"
  echo "AZURE_RESOURCE_GROUP=$RG"
  echo "TTE_SUFFIX=$SUFFIX"
  echo "AZURE_AI_ACCOUNT=$AI_ACCOUNT"
  echo "AZURE_AI_PROJECT=$AI_PROJECT"
  echo "AZURE_SPEECH_ACCOUNT=$SPEECH_ACCOUNT"
  echo "FOUNDRY_PROJECT_ENDPOINT=$PROJECT_ENDPOINT"
  echo "FOUNDRY_MODEL=$DEPLOYMENT"
  echo "AZURE_SPEECH_REGION=$LOCATION"
  echo "AZURE_SPEECH_KEY=$SPEECH_KEY"
  echo "$BLOCK_END"
} >"$ENV_FILE"

step "Done"
echo "Foundry: $PROJECT_ENDPOINT (deployment $DEPLOYMENT)"
echo "Speech:  $SPEECH_ACCOUNT ($SPEECH_SKU, $LOCATION)"
echo "Next:    uv run --env-file .env python -m infra.smoke"
