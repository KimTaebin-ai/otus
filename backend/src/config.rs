use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::{Context, bail};

/// 42 Intra OAuth app (profile.intra.42.fr → Settings → API).
pub struct FortyTwo {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    /// Redirect URI registered for the admin subdomain, when admin login is enabled.
    pub admin_redirect_uri: Option<String>,
    /// only users with a campus_users entry for this campus may log in (42 Gyeongsan = 69)
    pub campus_id: i64,
    /// https://api.intra.42.fr; overridable so tests can point at a mock
    pub api_base: String,
}

pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub upload_dir: PathBuf,
    pub max_upload_bytes: usize,
    pub demo_login_enabled: bool,
    /// AES-256-GCM key (base64, 32 bytes) for bank account numbers. Losing it makes the
    /// stored account numbers unrecoverable, so back it up separately from the database.
    pub bank_account_key: String,
    pub bank_account_key_id: i16,
    /// AES-256-GCM key (base64, 32 bytes) for stored PDFs; separate from the bank key so one
    /// leaked key doesn't expose both. Back it up apart from the database and the files.
    pub file_encryption_key: String,
    pub file_encryption_key_id: i16,
    /// None (OAuth endpoints return 404) when FORTY_TWO_CLIENT_ID is unset or empty
    pub forty_two: Option<FortyTwo>,
    /// clamd's TCP address (`host:port`). Unset means uploads aren't scanned, which is only
    /// allowed with demo login on (local development).
    pub clamav_addr: Option<String>,
    /// Exact browser origin (scheme://host[:port]) allowed to send state-changing requests
    pub app_origin: String,
    /// All accepted origins: student app first, then admin app (issue #9).
    pub app_origins: Vec<String>,
    /// `(42 login, role)` pairs; the only way a staff role is granted at login.
    pub staff_allowlist: Vec<(String, crate::domain::Role)>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let config = Self::read()?;
        config.check_demo_exposure()?;
        if config.clamav_addr.is_none() && !config.demo_login_enabled {
            bail!("CLAMAV_ADDR must be set: uploads are scanned for malware outside local demos");
        }
        Ok(config)
    }

    /// Demo login has no password and its users can approve their own submissions, so it
    /// only runs on a local student/admin origin unless DEMO_LOGIN_ALLOW_PUBLIC=true says otherwise.
    fn check_demo_exposure(&self) -> anyhow::Result<()> {
        let local = self.app_origins.iter().all(|o| is_local_origin(o));
        if self.demo_login_enabled && !local && !bool_var("DEMO_LOGIN_ALLOW_PUBLIC", false)? {
            bail!(
                "DEMO_LOGIN_ENABLED=true with a public APP_ORIGIN ({}): anyone could log in without \
                 42. Turn demo login off, or set DEMO_LOGIN_ALLOW_PUBLIC=true to accept that.",
                self.app_origins.join(", ")
            );
        }
        Ok(())
    }

    fn read() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: secret("DATABASE_URL")?,
            bind_addr: parsed("BIND_ADDR", "127.0.0.1:3000")?,
            upload_dir: PathBuf::from(optional("UPLOAD_DIR", "./data/uploads")),
            max_upload_bytes: parsed("MAX_UPLOAD_BYTES", "20971520")?,
            demo_login_enabled: bool_var("DEMO_LOGIN_ENABLED", false)?,
            app_origin: app_origins()?
                .into_iter()
                .next()
                .expect("at least one origin"),
            app_origins: app_origins()?,
            staff_allowlist: staff_allowlist()?,
            bank_account_key: secret("BANK_ACCOUNT_KEY")?,
            bank_account_key_id: parsed("BANK_ACCOUNT_KEY_ID", "1")?,
            file_encryption_key: secret("FILE_ENCRYPTION_KEY")?,
            file_encryption_key_id: parsed("FILE_ENCRYPTION_KEY_ID", "1")?,
            forty_two: forty_two()?,
            clamav_addr: env::var("CLAMAV_ADDR")
                .ok()
                .filter(|a| !a.trim().is_empty()),
        })
    }
}

fn forty_two() -> anyhow::Result<Option<FortyTwo>> {
    let Some(client_id) = optional_secret("FORTY_TWO_CLIENT_ID")? else {
        return Ok(None);
    };
    Ok(Some(FortyTwo {
        client_id,
        client_secret: optional_secret("FORTY_TWO_CLIENT_SECRET")?
            .context("FORTY_TWO_CLIENT_SECRET must be set when FORTY_TWO_CLIENT_ID is")?,
        redirect_uri: required("FORTY_TWO_REDIRECT_URI")?,
        admin_redirect_uri: optional_secret("FORTY_TWO_ADMIN_REDIRECT_URI")?,
        campus_id: required("FORTY_TWO_CAMPUS_ID")?
            .parse()
            .context("invalid FORTY_TWO_CAMPUS_ID")?,
        api_base: optional("FORTY_TWO_API_BASE", "https://api.intra.42.fr")
            .trim_end_matches('/')
            .to_owned(),
    }))
}

/// Like `secret`, but unset or empty means None.
fn optional_secret(key: &str) -> anyhow::Result<Option<String>> {
    let value = match secret(key) {
        Ok(v) => v,
        Err(_) if env::var(key).is_err() && env::var(format!("{key}_FILE")).is_err() => {
            return Ok(None);
        }
        Err(e) => return Err(e),
    };
    Ok(Some(value).filter(|v| !v.trim().is_empty()))
}

/// Whether an origin (`scheme://host[:port]`) points at this machine.
fn is_local_origin(origin: &str) -> bool {
    let Some((_, rest)) = origin.split_once("://") else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or_default();
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']').next().unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or_default()
    };
    matches!(host, "localhost" | "admin.localhost" | "127.0.0.1" | "::1")
}

/// `APP_ORIGINS` (comma-separated) wins; otherwise the legacy single `APP_ORIGIN`.
/// Dev: `http://localhost:4200,http://localhost:4201` (student, admin).
pub fn parse_origins(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in raw.split(',') {
        let o = part.trim().trim_end_matches('/').to_owned();
        if !o.is_empty() && !out.contains(&o) {
            out.push(o);
        }
    }
    out
}

fn app_origins() -> anyhow::Result<Vec<String>> {
    let raw = match env::var("APP_ORIGINS") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => required("APP_ORIGIN")?,
    };
    let origins = parse_origins(&raw);
    if origins.is_empty() {
        bail!("APP_ORIGIN(S) must name at least one origin");
    }
    Ok(origins)
}

/// `STAFF_ROLE_ALLOWLIST=login=operator,other=accountant` — staff roles come only
/// from this list (issue #9). Anything else resolves to `student` at 42 login.
pub fn parse_staff_allowlist(raw: &str) -> anyhow::Result<Vec<(String, crate::domain::Role)>> {
    let mut out = Vec::new();
    for part in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let (login, role) = part.split_once('=').ok_or_else(|| {
            anyhow::anyhow!("STAFF_ROLE_ALLOWLIST entry {part:?} must be login=role")
        })?;
        let role: crate::domain::Role = role
            .trim()
            .parse()
            .map_err(|_| anyhow::anyhow!("unknown staff role in STAFF_ROLE_ALLOWLIST: {part:?}"))?;
        if role == crate::domain::Role::Student {
            bail!("STAFF_ROLE_ALLOWLIST must not grant student: {part:?}");
        }
        out.push((login.trim().to_owned(), role));
    }
    Ok(out)
}

fn staff_allowlist() -> anyhow::Result<Vec<(String, crate::domain::Role)>> {
    match env::var("STAFF_ROLE_ALLOWLIST") {
        Ok(v) => parse_staff_allowlist(&v),
        Err(_) => Ok(Vec::new()),
    }
}

/// The role a 42 login gets: the allowlisted staff role, else `student`.
/// Removing a login from the list therefore revokes the staff role at next login.
pub fn resolve_role(
    login: &str,
    allowlist: &[(String, crate::domain::Role)],
) -> crate::domain::Role {
    allowlist
        .iter()
        .find(|(l, _)| l == login)
        .map(|(_, r)| *r)
        .unwrap_or(crate::domain::Role::Student)
}

fn required(key: &str) -> anyhow::Result<String> {
    env::var(key).with_context(|| format!("{key} must be set"))
}

/// Reads `KEY_FILE` (a mounted Podman secret) if set, otherwise `KEY`.
/// The pod uses files so secret values never show up in `podman inspect`.
fn secret(key: &str) -> anyhow::Result<String> {
    if let Ok(path) = env::var(format!("{key}_FILE")) {
        let value = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {key}_FILE ({path})"))?;
        return Ok(value.trim_end().to_owned());
    }
    env::var(key).with_context(|| format!("{key} or {key}_FILE must be set"))
}

fn optional(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_owned())
}

fn parsed<T>(key: &str, default: &str) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    optional(key, default)
        .parse()
        .with_context(|| format!("invalid {key}"))
}

fn bool_var(key: &str, default: bool) -> anyhow::Result<bool> {
    match env::var(key).as_deref() {
        Err(_) => Ok(default),
        Ok("true" | "1") => Ok(true),
        Ok("false" | "0") => Ok(false),
        Ok(other) => bail!("invalid {key}: {other:?} (expected true/false)"),
    }
}

#[cfg(test)]
mod tests {
    use super::is_local_origin;

    #[test]
    fn local_origins() {
        for o in [
            "https://localhost:8443",
            "https://admin.localhost:8443",
            "http://localhost:4200",
            "http://127.0.0.1",
            "http://[::1]:3000",
        ] {
            assert!(is_local_origin(o), "{o}");
        }
        for o in [
            "https://otus.example.com",
            "https://[2001:db8::1]:8443",
            "https://localhost.evil.com",
            "https://admin.localhost.evil.com",
            "https://notadmin.localhost",
            "https://127.0.0.1.nip.io",
            "localhost",
            "",
        ] {
            assert!(!is_local_origin(o), "{o}");
        }
    }
}

#[cfg(test)]
mod origin_tests {
    use super::*;
    use crate::domain::Role;
    #[test]
    fn multiple_origins_parse() {
        assert_eq!(
            parse_origins("http://localhost:4200, http://localhost:4201/"),
            vec![
                "http://localhost:4200".to_string(),
                "http://localhost:4201".to_string()
            ]
        );
        assert_eq!(
            parse_origins("http://localhost:4200,http://localhost:4200").len(),
            1
        );
    }
    #[test]
    fn staff_allowlist_only_grants_staff() {
        let list = parse_staff_allowlist("ops1=operator,acct=accountant,boss=admin").unwrap();
        assert_eq!(resolve_role("ops1", &list), Role::Operator);
        assert_eq!(resolve_role("acct", &list), Role::Accountant);
        assert_eq!(resolve_role("student1", &list), Role::Student);
        assert!(parse_staff_allowlist("x=student").is_err());
        assert!(parse_staff_allowlist("x=ops").is_err());
        assert!(parse_staff_allowlist("noequals").is_err());
    }
}
