mod account;
mod admin;
mod admin_archive;
mod admin_cycles;
pub(crate) mod admin_notices;
mod admin_review;
mod admin_submissions;
mod admin_supplements;
mod auth;
mod cycles;
mod dev;
mod files;
mod health;
pub mod me;
pub mod notifications;
mod oauth;
pub mod submissions;
pub mod time_requirements;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, patch, post};

use crate::AppState;
use crate::config::Config;

/// Room for multipart boundaries and the doc_type field on top of the file itself.
const MULTIPART_OVERHEAD: usize = 64 * 1024;

pub fn router(config: &Config) -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health::health))
        .route("/api/auth/demo-login", post(auth::demo_login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/methods", get(oauth::methods))
        .route("/api/auth/42/login", get(oauth::login))
        .route("/api/auth/42/callback", get(oauth::callback))
        .route("/api/me", get(me::me))
        .route("/api/me/time-requirements", get(time_requirements::list))
        .route("/api/notifications", get(notifications::list))
        .route(
            "/api/notifications/unread-count",
            get(notifications::unread_count),
        )
        .route("/api/notifications/read-all", post(notifications::read_all))
        .route(
            "/api/notifications/{id}/read",
            post(notifications::read_one),
        )
        .route(
            "/api/dev/time-requirements/decide",
            post(dev::decide_time_requirement),
        )
        .route("/api/me/employment", patch(account::set_employment))
        .route("/api/me/profile", patch(me::set_profile))
        .route(
            "/api/me/bank-account",
            get(account::get_bank_account)
                .put(account::request_change)
                .layer(DefaultBodyLimit::max(
                    config.max_upload_bytes + MULTIPART_OVERHEAD,
                )),
        )
        .route("/api/cycles/current", get(cycles::current))
        .route("/api/admin/cycles", get(admin_cycles::list))
        .route(
            "/api/admin/cycles/{month}",
            axum::routing::put(admin_cycles::save),
        )
        .route(
            "/api/admin/cycles/{month}/history",
            get(admin_cycles::history),
        )
        .route("/api/files/{id}", get(files::download))
        .route("/api/admin/users", get(admin::list_users))
        .route("/api/admin/users/{id}", get(admin::get_user))
        .route(
            "/api/admin/users/{id}/bank-account",
            get(admin::get_user_bank_account),
        )
        .route(
            "/api/admin/users/{id}/bank-account/review",
            post(admin::review_user_bank_account),
        )
        .route("/api/admin/activity", get(admin::activity))
        .route("/api/admin/submissions", get(admin_submissions::list))
        .route(
            "/api/admin/submissions/{id}",
            get(admin_supplements::detail),
        )
        .route(
            "/api/admin/submissions/{id}/history",
            get(admin_supplements::history),
        )
        .route(
            "/api/admin/submissions/{id}/events",
            get(admin_supplements::events),
        )
        .route("/api/admin/review-queue", get(admin_review::queue))
        .route(
            "/api/admin/submissions/{id}/navigation",
            get(admin_review::navigation),
        )
        .route(
            "/api/admin/submissions/{id}/review",
            post(admin_review::review),
        )
        .route(
            "/api/admin/notices/submission-reminder",
            get(admin_notices::preview).post(admin_notices::send),
        )
        .route("/api/admin/notices/{id}", get(admin_notices::status))
        .route("/api/admin/notices/{id}/retry", post(admin_notices::retry))
        .route("/api/admin/archive/{month}", get(admin_archive::list))
        .route(
            "/api/admin/archive/{month}/exports",
            post(admin_archive::create),
        )
        .route(
            "/api/admin/archive/{month}/exports/{id}",
            get(admin_archive::status),
        )
        .route(
            "/api/admin/archive/{month}/exports/{id}/file",
            get(admin_archive::download),
        )
        .route(
            "/api/submissions",
            get(submissions::list).post(submissions::create),
        )
        .route(
            "/api/submissions/{id}/finalize",
            post(submissions::finalize),
        )
        .route("/api/dev/submissions/{id}/status", post(dev::set_status))
        .route(
            "/api/dev/me/bank-account/review",
            post(dev::review_bank_account),
        )
        .route(
            "/api/submissions/{id}/files",
            post(submissions::upload_file).layer(DefaultBodyLimit::max(
                config.max_upload_bytes + MULTIPART_OVERHEAD,
            )),
        )
}
