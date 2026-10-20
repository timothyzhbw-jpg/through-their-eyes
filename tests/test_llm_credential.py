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
