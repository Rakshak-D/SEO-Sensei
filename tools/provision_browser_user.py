"""Provision one allowlisted browser account outside the repository."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import secrets
import stat
import sys
import tempfile
from pathlib import Path

from argon2 import PasswordHasher, Type

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
MAX_ACCOUNT_FILE_BYTES = 64 * 1024
MAX_ACCOUNTS = 64
MIN_PASSWORD_LENGTH = 15
MAX_PASSWORD_LENGTH = 256
MAX_PASSWORD_BYTES = 1_024

sys.path.insert(0, str(REPOSITORY_ROOT))
from backend.app.config import ConfigurationError  # noqa: E402
from backend.app.security.browser_accounts import USERNAME_PATTERN, load_accounts, normalize_username  # noqa: E402


class ProvisioningError(RuntimeError):
    """A safe operator-facing provisioning error without secret values."""


def _target_path(account_file: str | Path) -> Path:
    path = Path(account_file).expanduser()
    if not path.is_absolute():
        raise ProvisioningError("The account file path must be absolute.")
    if path.is_symlink():
        raise ProvisioningError("The account file must not be a symbolic link.")
    try:
        resolved = path.resolve(strict=False)
        resolved.relative_to(REPOSITORY_ROOT)
    except ValueError:
        pass
    except (OSError, RuntimeError) as exc:
        raise ProvisioningError("The account file path is invalid.") from exc
    else:
        raise ProvisioningError("The account file must be outside the repository.")

    if not resolved.parent.is_dir() or resolved.name in {"", ".", ".."}:
        raise ProvisioningError("The account file parent directory must already exist.")
    if resolved.exists() and resolved.is_symlink():
        raise ProvisioningError("The account file must not be a symbolic link.")
    return resolved


def _validate_password(password: str) -> None:
    try:
        encoded = password.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ProvisioningError("The password must be valid Unicode text.") from exc
    if (
        len(password) < MIN_PASSWORD_LENGTH
        or len(password) > MAX_PASSWORD_LENGTH
        or len(encoded) > MAX_PASSWORD_BYTES
        or not password.strip()
    ):
        raise ProvisioningError("Use a password with 15–256 characters and no more than 1,024 UTF-8 bytes.")


def _secure_mode(path: Path) -> None:
    if os.name == "posix":
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def _atomic_write(target: Path, contents: bytes) -> None:
    if target.exists() and target.is_symlink():
        raise ProvisioningError("The account file must not be a symbolic link.")
    descriptor = -1
    temporary_name: str | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.",
            suffix=".tmp",
            dir=target.parent,
        )
        if os.name == "posix":
            os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(descriptor, "wb") as temporary:
            descriptor = -1
            temporary.write(contents)
            temporary.flush()
            os.fsync(temporary.fileno())
        if target.exists() and target.is_symlink():
            raise ProvisioningError("The account file must not be a symbolic link.")
        os.replace(temporary_name, target)
        temporary_name = None
        _secure_mode(target)
        if os.name == "posix" and hasattr(os, "O_DIRECTORY"):
            directory_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    except ProvisioningError:
        raise
    except OSError as exc:
        raise ProvisioningError("The account file could not be safely written.") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def provision_user(username: str, password: str, account_file: str | Path) -> Path:
    normalized = normalize_username(username)
    if not USERNAME_PATTERN.fullmatch(normalized):
        raise ProvisioningError("Username must use 1–64 ASCII letters, digits, dots, underscores, or hyphens.")
    _validate_password(password)
    target = _target_path(account_file)

    lock_path = target.with_name(f".{target.name}.lock")
    lock_fd = -1
    lock_created = False
    try:
        try:
            lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError as exc:
            raise ProvisioningError(
                "Another provisioning operation may be active; inspect the lock file before retrying."
            ) from exc
        except OSError as exc:
            raise ProvisioningError("The account provisioning lock could not be created safely.") from exc
        lock_created = True
        os.close(lock_fd)
        lock_fd = -1

        if target.exists():
            try:
                accounts = load_accounts(str(target))
            except ConfigurationError as exc:
                raise ProvisioningError("The existing account file is invalid or cannot be read safely.") from exc
        else:
            accounts = {}
        if normalized in accounts:
            raise ProvisioningError("That username is already provisioned; this utility does not replace accounts.")
        if len(accounts) >= MAX_ACCOUNTS:
            raise ProvisioningError("The account allowlist is full.")

        hasher = PasswordHasher(
            time_cost=2,
            memory_cost=19_456,
            parallelism=1,
            hash_len=32,
            salt_len=16,
            type=Type.ID,
        )
        try:
            password_hash = hasher.hash(password)
        except Exception as exc:
            raise ProvisioningError("The password verifier could not be created.") from exc
        users = [
            {"username": account.username, "password_hash": account.password_hash} for account in accounts.values()
        ]
        users.append({"username": normalized, "password_hash": password_hash})
        document = json.dumps({"version": 1, "users": users}, ensure_ascii=True, indent=2).encode("utf-8") + b"\n"
        if len(document) > MAX_ACCOUNT_FILE_BYTES:
            raise ProvisioningError("The account allowlist would exceed its size limit.")
        _atomic_write(target, document)
        return target
    finally:
        if lock_fd >= 0:
            os.close(lock_fd)
        if lock_created:
            try:
                lock_path.unlink()
            except FileNotFoundError:
                pass
            except OSError as exc:
                raise ProvisioningError(
                    "The provisioning lock could not be removed; inspect it before retrying."
                ) from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Add one allowlisted browser-auth account.")
    parser.add_argument("username", help="Account identifier; passwords are never accepted as arguments.")
    parser.add_argument(
        "--accounts-file",
        default=os.environ.get("BROWSER_AUTH_ACCOUNTS_FILE"),
        help="Absolute path outside the repository (defaults to BROWSER_AUTH_ACCOUNTS_FILE).",
    )
    arguments = parser.parse_args()
    if not arguments.accounts_file:
        parser.error("--accounts-file or BROWSER_AUTH_ACCOUNTS_FILE is required")

    try:
        first = getpass.getpass("New browser-auth password: ")
        second = getpass.getpass("Confirm password: ")
        if not secrets.compare_digest(first.encode("utf-8"), second.encode("utf-8")):
            raise ProvisioningError("The password entries do not match.")
        target = provision_user(arguments.username, first, arguments.accounts_file)
    except (ProvisioningError, ConfigurationError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(f"Provisioned account {normalize_username(arguments.username)!r} in {target}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
