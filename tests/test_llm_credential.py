"""The Foundry client logs in with the app's managed identity in Container Apps, else with az."""

from azure.identity.aio import AzureCliCredential, ManagedIdentityCredential

from agents.llm import credential_from_env


def test_inside_container_apps_the_user_assigned_identity_is_used(monkeypatch):
    monkeypatch.setenv("IDENTITY_ENDPOINT", "http://localhost:42356/msi/token")
    monkeypatch.setenv("AZURE_CLIENT_ID", "00000000-0000-0000-0000-000000000001")
    assert isinstance(credential_from_env(), ManagedIdentityCredential)


def test_elsewhere_the_azure_cli_login_is_used(monkeypatch):
    monkeypatch.delenv("IDENTITY_ENDPOINT", raising=False)
    monkeypatch.setenv("AZURE_CLIENT_ID", "00000000-0000-0000-0000-000000000001")
    assert isinstance(credential_from_env(), AzureCliCredential)


def test_the_sync_credential_for_cosmos_follows_the_same_rule(monkeypatch):
    from azure.identity import AzureCliCredential as SyncCli
    from azure.identity import ManagedIdentityCredential as SyncMI

    from agents.llm import sync_credential_from_env

    monkeypatch.setenv("AZURE_CLIENT_ID", "00000000-0000-0000-0000-000000000001")
    monkeypatch.setenv("IDENTITY_ENDPOINT", "http://localhost:42356/msi/token")
    assert isinstance(sync_credential_from_env(), SyncMI)
    monkeypatch.delenv("IDENTITY_ENDPOINT")
    assert isinstance(sync_credential_from_env(), SyncCli)


def test_with_a_cosmos_endpoint_the_app_creates_its_own_credential(monkeypatch, tmp_path):
    import api.main as main
    from api.settings import Settings

    made = []
    monkeypatch.setattr(main, "sync_credential_from_env", lambda: made.append(1) or object())
    monkeypatch.setattr(
        main,
        "open_storage",
        lambda s, cred, client: (
            (_ for _ in ()).throw(AssertionError("no credential")) if cred is None else _Storage()
        ),
    )
    settings = Settings(cache_dir=tmp_path, cosmos_endpoint="https://x.documents.azure.com:443/")
    main.create_app(settings, model_id="offline")
    assert made == [1]


class _Storage:
    breakdowns = answers = None
    audit = None

    def close(self):
        pass
