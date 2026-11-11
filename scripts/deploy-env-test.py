#!/usr/bin/env python3
"""Render deploy/.env in temporary directories; no Podman, network or real secrets.

Run with python3 scripts/deploy-env-test.py (requires PyYAML).
"""

import base64
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "deploy/start-podman.sh").read_text()
RENDERER = SCRIPT.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
EXAMPLE = (ROOT / "deploy/.env.example").read_text().replace(
    "FORTY_TWO_CLIENT_ID=\n", "FORTY_TWO_CLIENT_ID=synthetic-client-id\n"
).replace(
    "FORTY_TWO_CLIENT_SECRET=\n", "FORTY_TWO_CLIENT_SECRET=synthetic-client-secret\n"
)
SMTP = {
    "MAIL_RECIPIENT_DOMAIN": "students.example.test",
    "SMTP_HOST": "smtp.example.test",
    "SMTP_PORT": "587",
    "SMTP_TLS": "starttls",
    "SMTP_FROM": "OTUS <noreply@example.test>",
    "SMTP_USERNAME": "noreply@example.test",
    "SMTP_PASSWORD": "synthetic $HOME $(false) `false` # literal password",
}


class DeployEnvTests(unittest.TestCase):
    def render(self, config=None, saved=None, legacy_env=None, error=None):
        with tempfile.TemporaryDirectory(prefix="otus-deploy-env-test-") as directory:
            root = Path(directory)
            deploy = root / "deploy"
            deploy.mkdir()
            output = root / "rendered"
            output.mkdir()
            for name in ("otus-pod.yaml", "Caddyfile"):
                shutil.copyfile(ROOT / "deploy" / name, deploy / name)
            if legacy_env:
                pod = yaml.safe_load((deploy / "otus-pod.yaml").read_text())
                backend = next(c for c in pod["spec"]["containers"] if c["name"] == "backend")
                backend["env"].extend({"name": key, "value": value} for key, value in legacy_env.items())
                (deploy / "otus-pod.yaml").write_text(yaml.safe_dump(pod))
            config = config or {}
            example = "\n".join(line for line in EXAMPLE.splitlines()
                                if line.partition("=")[0].strip() not in config)
            (deploy / ".env").write_text(example + "\n" + "\n".join(
                f"{key}={shlex.quote(value)}" for key, value in config.items()
            ))
            if saved is not None:
                (deploy / "secrets.yaml").write_text(saved)
            result = subprocess.run(
                [sys.executable, "-", str(output)], input=RENDERER, text=True,
                capture_output=True, cwd=root, timeout=10,
                env={"OTUS_REQUIRE_OAUTH": "true", "OTUS_DEPLOY_HOST": ""},
            )
            if error is not None:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(error, result.stderr)
                self.assertEqual(list(output.iterdir()), [])
                return
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = (output / "pod.yaml").read_text()
            pod = yaml.safe_load(manifest)
            backend = next(c for c in pod["spec"]["containers"] if c["name"] == "backend")
            env = {entry["name"]: entry.get("value") for entry in backend["env"]}
            secrets_text = (output / "secrets.yaml").read_text()
            secrets = {doc["metadata"]["name"]: doc["stringData"]
                       for doc in yaml.safe_load_all(secrets_text)}
            password = secrets["otus-backend"].get("smtp-password")
            if password:
                for public in (manifest, result.stdout, result.stderr):
                    self.assertNotIn(password, public)
                self.assertNotIn("smtp-password", secrets["otus-db"])
            self.assertNotIn("SMTP_PASSWORD", env)
            return env, secrets, secrets_text

    def test_example_without_smtp_preserves_production_defaults(self):
        env, secrets, _ = self.render()
        self.assertNotIn("SMTP_PASSWORD_FILE", env)
        self.assertNotIn("smtp-password", secrets["otus-backend"])
        self.assertEqual(env["DEMO_LOGIN_ENABLED"], "false")
        self.assertEqual(env["DEMO_LOGIN_ALLOW_PUBLIC"], "false")
        self.assertEqual(env["APP_ORIGINS"],
                         "https://otus.example.com:8443,https://admin.otus.example.com:8443")
        self.assertEqual(env["FORTY_TWO_ADMIN_REDIRECT_URI"],
                         "https://admin.otus.example.com:8443/api/auth/42/callback")

    def test_local_env_without_admin_site_allows_caddys_default_admin_origin(self):
        env, _, _ = self.render({
            "APP_ORIGIN": "https://localhost:8443",
            "ADMIN_SITE_ADDRESS": "",
            "FORTY_TWO_REDIRECT_URI": "https://localhost:8443/api/auth/42/callback",
        })
        self.assertEqual(env["APP_ORIGINS"],
                         "https://localhost:8443,https://admin.localhost:8443")

    def test_explicit_origins_must_include_the_admin_site(self):
        self.render({"APP_ORIGINS": "https://otus.example.com:8443"},
                    error="APP_ORIGINS must include the admin origin")

    def test_explicit_origins_preserve_the_configured_admin_https_port(self):
        env, _, _ = self.render({
            "ADMIN_SITE_ADDRESS": "https://admin.otus.example.com",
            "APP_ORIGINS": "https://otus.example.com:8443,https://admin.otus.example.com",
        })
        self.assertEqual(env["APP_ORIGINS"],
                         "https://otus.example.com:8443,https://admin.otus.example.com")

    def test_public_env_without_admin_site_does_not_allow_localhost(self):
        env, _, _ = self.render({"ADMIN_SITE_ADDRESS": ""})
        self.assertEqual(env["APP_ORIGINS"], "https://otus.example.com:8443")

    def test_smtp_values_and_literal_password_reach_backend(self):
        env, secrets, _ = self.render(SMTP, legacy_env={
            "SMTP_PASSWORD": "legacy-plaintext-password",
            "SMTP_PASSWORD_FILE": "/legacy/password",
        })
        for key, value in SMTP.items():
            if key != "SMTP_PASSWORD":
                self.assertEqual(env[key], value)
        self.assertEqual(env["SMTP_PASSWORD_FILE"], "/run/secrets/otus-backend/smtp-password")
        self.assertEqual(secrets["otus-backend"]["smtp-password"], SMTP["SMTP_PASSWORD"])

    def test_existing_deployment_can_enable_smtp(self):
        _, old, saved = self.render()
        _, new, _ = self.render(SMTP, saved=saved)
        self.assertEqual(new["otus-db"], old["otus-db"])
        self.assertEqual(new["otus-backend"], {**old["otus-backend"],
                                             "smtp-password": SMTP["SMTP_PASSWORD"]})

    def test_password_rotation_and_omission_preserve_other_secrets(self):
        _, old, saved = self.render(SMTP)
        changed = {**SMTP, "SMTP_PASSWORD": "synthetic-new-password", "SMTP_PORT": "465", "SMTP_TLS": "tls"}
        env, new, saved = self.render(changed, saved=saved)
        self.assertEqual(env["SMTP_PORT"], "465")
        self.assertEqual(env["SMTP_TLS"], "tls")
        self.assertEqual(new["otus-db"], old["otus-db"])
        self.assertEqual(new["otus-backend"], {**old["otus-backend"],
                                             "smtp-password": changed["SMTP_PASSWORD"]})
        del changed["SMTP_PASSWORD"]
        env, reused, _ = self.render(changed, saved=saved)
        self.assertEqual(reused, new)
        self.assertEqual(env["SMTP_PASSWORD_FILE"], "/run/secrets/otus-backend/smtp-password")

    def test_empty_password_clears_saved_password_and_legacy_env(self):
        _, _, saved = self.render(SMTP)
        config = {**SMTP, "SMTP_PASSWORD": "", "SMTP_USERNAME": ""}
        env, secrets, _ = self.render(config, saved=saved, legacy_env={
            "SMTP_PASSWORD": "legacy-plaintext-password",
            "SMTP_PASSWORD_FILE": "/run/secrets/otus-backend/smtp-password",
        })
        self.assertEqual(secrets["otus-backend"]["smtp-password"], "")
        self.assertNotIn("SMTP_PASSWORD_FILE", env)

    def test_unauthenticated_local_smtp_needs_no_password_file(self):
        config = {key: value for key, value in SMTP.items()
                  if key not in {"SMTP_USERNAME", "SMTP_PASSWORD"}}
        config.update(SMTP_HOST="127.0.0.1", SMTP_PORT="2525", SMTP_TLS="none")
        env, _, _ = self.render(config)
        self.assertEqual(env["SMTP_HOST"], "127.0.0.1")
        self.assertNotIn("SMTP_PASSWORD_FILE", env)

    def test_encryption_keys_still_cannot_rotate_during_deployment(self):
        _, _, saved = self.render(SMTP)
        self.render({**SMTP, "BANK_ACCOUNT_KEY": base64.b64encode(bytes(32)).decode()},
                    saved=saved, error="BANK_ACCOUNT_KEY differs from saved secrets")

    def test_password_file_path_is_managed_by_deployer(self):
        self.render({"SMTP_PASSWORD_FILE": "/host/password"},
                    error="Unsupported .env variables: SMTP_PASSWORD_FILE")


if __name__ == "__main__":
    unittest.main()
