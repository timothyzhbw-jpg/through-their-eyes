# infra/ — Azure setup, deploy and pre-warm (SPEC 8)

Scripts, not infrastructure as code (azd and Bicep were a stretch goal): two idempotent shell
scripts create the Azure resources, GitHub Actions redeploys on every green CI run on `main`, and
two Python tools check the model and Speech (`smoke`) and fill the deployed breakdown cache
(`prewarm`). Every name and endpoint the scripts create goes into `.env` (git-ignored); every
variable is documented in [`.env.example`](../.env.example).

## Files

| File | What it does |
|---|---|
| [`m0_provision.sh`](m0_provision.sh) | M0: a resource group with a Microsoft Foundry resource, project and one model deployment (picked with `pick_model.py`), an Azure AI Speech resource, and a data-plane role for you so calls are keyless; writes `.env` |
| [`deploy.sh`](deploy.sh) | `provision`: Log Analytics (daily cap) and Application Insights, Cosmos DB (serverless), Container Registry, the Container Apps environment and `tte-api` with its user-assigned identity, the GitHub Actions identity (OIDC from `main` only), the Storage static website. `api [tag]`: build the image with docker, push, roll out. `web`: build `web/` against `TTE_API_URL` and upload it. `github`: set the repo variables `deploy.yml` reads |
| [`pick_model.py`](pick_model.py) | the first candidate model a region offers with the wanted SKU, not retiring before judging ends, with quota left |
| [`smoke.py`](smoke.py) | the M0 smoke test: a structured output from the Foundry deployment through Agent Framework, and one `en` and one `zh` line from Azure AI Speech |
| [`prewarm.py`](prewarm.py) | asks the live API for every hero moment × persona × language, so judges get cached model breakdowns; new ones paced to the per-client limit and at most `--max-new` (20) of the daily cap of 40; `--tts` speaks every voice cue once; `--dry-run` sends GET requests only |

## How a change reaches Azure

1. A PR merges to `main`; [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs.
2. On success, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) logs in with OIDC
   (a user-assigned managed identity whose federated credential trusts only this repo's `main`;
   no stored Azure secret), builds the API image on the runner (ACR Tasks is not allowed on the
   student subscription), rolls it out to Container Apps and waits for `/health`, then builds
   `web/` with `VITE_API_URL` and uploads it to the static website.
3. After the last deploy of a change that touches the cache key (the moment card, prompts,
   pipeline version or model), run `prewarm` again: a new key means an empty cache.

## Invariants

- **Subscription guard.** Both scripts need an explicit `AZURE_SUBSCRIPTION_ID`, never the CLI's
  default, and check its offer before any call that changes something. `deploy.sh` accepts only
  Azure for Students, pay-as-you-go or free-trial offers, so Microsoft-internal and Enterprise
  Agreement subscriptions are refused. `m0_provision.sh` refuses them too unless
  `TTE_ALLOW_ANY_OFFER=1`, which is for a non-personal subscription whose owner approved the
  use.
- **No keys printed or stored in the repo.** Access is through Entra ID roles and managed
  identities (Foundry, Cosmos DB, image pulls, uploads with `--auth-mode login`); the scripts
  write names and endpoints to `.env`, never keys to the terminal.
- **Safe to re-run.** Existing resources are reused and their names kept in `.env`; variables set
  in the shell win over the file, which is read as plain `KEY=VALUE` (no `eval`).
- **Bounded spend.** `prewarm` never pushes past the daily model cap and leaves part of it to
  visitors; the API enforces the caps anyway (see [api/README.md](../api/README.md)).

## Run it

```bash
az login
AZURE_SUBSCRIPTION_ID=<id> infra/m0_provision.sh             # M0: Foundry + Speech, writes .env
uv run --env-file .env python -m infra.smoke                  # exit 0 only if every check passes
AZURE_SUBSCRIPTION_ID=<id> infra/deploy.sh provision          # then: api | web | github
uv run python -m infra.prewarm --api <API URL> --dry-run      # what it would ask, GET only
uv run python -m infra.prewarm --api <API URL> --tts          # fill the cache and the audio
```

`prewarm` exits 0 when every view is a clean model breakdown, 1 when some are missing or came
from a template, 3 when the daily cap was reached (run it again after 00:00 UTC).

## Tests

```bash
uv run pytest tests/test_infra.py tests/test_deploy_script.py tests/test_prewarm.py \
  tests/test_dockerfile.py tests/test_env_example.py
```

- [`test_deploy_script.py`](../tests/test_deploy_script.py): without an explicit subscription
  the script stops; internal and Enterprise Agreement subscriptions are refused; it never prints
  keys. CI also runs `bash -n infra/*.sh`.
- [`test_prewarm.py`](../tests/test_prewarm.py): every persona and language of every hero
  moment, pacing, the daily cap, `--max-new`, a template step counts as degraded.
- [`test_infra.py`](../tests/test_infra.py): model picking and the smoke test's SSML.
- [`test_dockerfile.py`](../tests/test_dockerfile.py), [`test_env_example.py`](../tests/test_env_example.py):
  the image and the documented environment.

## SPEC

[§8 platform and deploy](../docs/SPEC.md#8-platform-and-deploy) (budget, cost estimate,
subscription guard, each Azure service and why, what was provisioned and measured),
[§9 milestones](../docs/SPEC.md#9-milestones-and-cut-list).
