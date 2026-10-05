from __future__ import annotations

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_deployment_helper_is_secret_safe_and_idempotent() -> None:
    script = (ROOT / "scripts" / "deploy.sh").read_text(encoding="utf-8")

    assert "set -Eeuo pipefail" in script
    assert "set -x" not in script
    assert "docker compose" in script
    assert "config --quiet" in script
    assert "build --pull api dashboard" in script
    assert "wait_for_health" in script
    assert "chmod 600" in script
    assert "echo $" not in script
    assert "AWS_SECRET_ACCESS_KEY" not in script
    assert "GEMINI_API_KEY=" not in script
    assert "API_ACCESS_TOKEN=" not in script


def test_deployment_secrets_are_ignored_but_example_is_tracked() -> None:
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")

    assert ".env" in gitignore
    assert "!.env.example" in gitignore
    tracked_env = subprocess.run(
        ["git", "ls-files", "--error-unmatch", ".env"],
        cwd=ROOT,
        capture_output=True,
        check=False,
        text=True,
    )
    assert tracked_env.returncode != 0
